/**
 * Turn arbitrary pasted / extracted text into import records.
 * Handles many entries at once: stat blocks, labeled item entries, and gear tables.
 */
import { normalizeText, tidyName, toNumber } from './common.js';
import { parseLabeledLine } from './fields.js';
import { resolveType, sectionHeading, isBioware } from './types.js';
import { parseStatBlock, isAttributeHeader, isVehicleHeader, sectionOf } from './statblock.js';
import { parseTable, parseTableHeader, parseLooseRow } from './tables.js';
import { findHostBlocks, parseHostBlock } from './host.js';
import { findContactCards } from './contact-card.js';

const SEPARATOR = /^\s*(?:-{3,}|={3,}|\*{3,}|_{3,}|#{3,}|—{2,})\s*$/;
const DESCRIPTOR_WORDS = /^(direct|indirect|elemental|active|passive|directional|area|psychic|realistic|obvious|single[- ]sense|multi[- ]sense|mental|physical|environmental|damaging|essence|extended|sense|anchored|material link|minion|spell|spotter|mana|blood|contractual)$/i;
const ACTOR_HINT_LINE = /^(initiative|init|condition monitor|limits|skills|armor\s*\d|knowledge skills|languages|augmentations|weapons|gear|spells|powers|qualities)\b/i;

/**
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.defaultType]  system type for unidentified entries (default 'equipment')
 * @param {string} [opts.forceType]    force every entry to this system type
 * @param {string} [opts.sourceLabel]  e.g. file name, used for warnings
 * @returns {{records: object[], skipped: string[]}}
 */
export function parseText(text, opts = {}) {
    const clean = joinSplitParens(normalizeText(text));
    const chunks = splitChunks(clean);
    const records = [];
    const skipped = [];
    const context = { section: null };

    for (const chunk of chunks) {
        const lines = chunk.split('\n');
        parseChunk(lines, context, opts, records, skipped);
    }
    for (const r of records) {
        if (opts.forceType) applyForcedType(r, opts.forceType);
        r.source = opts.sourceLabel ?? 'text';
    }
    return { records: mergeReprints(dedupe(records)), skipped };
}

/** Identical entries printed more than once (handout cards, a vehicle repeated in two scenes) import once. */
function dedupe(records) {
    const seen = new Set();
    return records.filter(r => {
        const key = JSON.stringify([r.documentName, r.type, r.name, r.fields, r.children ?? null, r.skills ?? null]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * The same NPC printed twice (in a scene and again in the cast pages at the back), with small typos
 * between the copies, imports once. Copies count as the same when the name and type match and every
 * attribute both print is the same. The fuller copy is kept, and anything only the other one has
 * (an item, a skill, a missing attribute, a longer description) is added to it.
 */
function mergeReprints(records) {
    const norm = s => String(s ?? '').toLowerCase().replace(/[“”"'’‘]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const out = [];
    for (const r of records) {
        const twin = r.documentName === 'Actor' && out.find(o => o.documentName === 'Actor' && o.type === r.type
            && norm(o.name) === norm(r.name) && sameStats(o, r));
        if (!twin) { out.push(r); continue; }
        const merged = mergeTwo(twin, r, norm);
        out[out.indexOf(twin)] = merged;
    }
    return out;
}

function sameStats(a, b) {
    const A = a.fields?.attributes ?? {}, B = b.fields?.attributes ?? {};
    const shared = Object.keys(A).filter(k => k in B);
    if (shared.length < 3 && a.type !== 'vehicle') return false;
    if (!shared.every(k => A[k]?.base === B[k]?.base && (A[k]?.augmented ?? A[k]?.base) === (B[k]?.augmented ?? B[k]?.base))) return false;
    const va = a.fields?.vehicle, vb = b.fields?.vehicle;
    if (va || vb) return !!va && !!vb && ['handling', 'speed', 'body', 'armor', 'pilot', 'sensor'].every(k => va[k] === vb[k]);
    return true;
}

function mergeTwo(a, b, norm) {
    const score = r => (r.skills?.length ?? 0) + (r.children?.length ?? 0) + (r.fields?.description ? 3 : 0);
    const [keep, other] = score(b) > score(a) ? [b, a] : [a, b];
    const r = structuredClone(keep);
    const f = r.fields, o = other.fields;
    for (const [k, v] of Object.entries(o.attributes ?? {})) f.attributes[k] ??= v;
    for (const [k, v] of Object.entries(o)) {
        if (k === 'attributes' || k === 'description' || k === 'notes') continue;
        if (f[k] === undefined) f[k] = v;
    }
    // Scenes that use the same NPC in different numbers: keep both counts.
    if (o.perRunner && f.perRunner && o.perRunner !== f.perRunner) f.perRunner = `${f.perRunner} or ${o.perRunner}`;
    if ((o.description?.length ?? 0) > (f.description?.length ?? 0)) f.description = o.description;
    if (o.notes && !(f.notes ?? '').includes(o.notes)) f.notes = [f.notes, o.notes].filter(Boolean).join('\n\n');
    // One name inside the other ("Commlink" / "Implanted Transys Avalon commlink") is the same thing.
    const covered = (list, name) => list.some(x => { const a1 = norm(x.name), b1 = norm(name); return a1 === b1 || a1.includes(b1) || b1.includes(a1); });
    r.skills = r.skills ?? [];
    for (const s of other.skills ?? []) if (!covered(r.skills, s.name)) r.skills.push(s);
    r.children = r.children ?? [];
    for (const c of other.children ?? []) if (!covered(r.children.filter(x => x.type === c.type), c.name)) r.children.push(c);
    r.raw = [keep.raw, other.raw].filter(Boolean).join('\n\n');
    r.warnings = [...new Set([...(keep.warnings ?? []), ...(other.warnings ?? []),
        'Printed twice in the source; the two copies were merged. Check the sheet for differences.'])];
    return r;
}

/** "(HIGH-LEVEL INITIATE; HUMAN," + "PROFESSIONAL RATING 5)" → one line. */
function joinSplitParens(text) {
    const lines = text.split('\n');
    for (let i = 0; i + 1 < lines.length; i++) {
        const a = lines[i].trim(), b = lines[i + 1].trim();
        if (/^\([^)]*$/.test(a) && /^[^(]*\)$/.test(b) && (a + b).length <= 90 && /rating|force|level/i.test(a + b)) {
            lines[i] = `${a} ${b}`;
            lines.splice(i + 1, 1);
        }
    }
    return lines.join('\n');
}

function splitChunks(text) {
    const out = [];
    let cur = [];
    for (const line of text.split('\n')) {
        if (SEPARATOR.test(line)) { if (cur.join('').trim()) out.push(cur.join('\n')); cur = []; continue; }
        cur.push(line);
    }
    if (cur.join('').trim()) out.push(cur.join('\n'));
    return out;
}

function applyForcedType(record, forceType) {
    const resolved = resolveType(forceType);
    if (!resolved) return;
    if (resolved.documentName !== record.documentName) {
        record.warnings = [...(record.warnings ?? []), `Type forced to ${resolved.type}; fields were parsed as ${record.type}.`];
    }
    record.documentName = resolved.documentName;
    record.type = resolved.type;
}

/* ------------------------------------------------------------------ */

function parseChunk(lines, context, opts, records, skipped) {
    // 0. Matrix hosts ("HOST: NAME" and its Rating/Attack/Sleaze/Data Proc./Firewall table) and contact
    //    cards ("NAME" / role / "Connection Rating: 2") are items printed among an adventure's NPCs;
    //    cut them out first, then read what is around them.
    const special = [
        ...findHostBlocks(lines, { isStart: l => isAttributeHeader(l) || isVehicleHeader(l) || !!parseTableHeader(l) })
            .map(b => ({ ...b, make: () => parseHostBlock(lines.slice(b.start, b.end)) })),
        ...findContactCards(lines).map(c => ({ ...c, make: () => c.record })),
    ].sort((a, b) => a.start - b.start).filter((b, i, all) => i === 0 || b.start >= all[i - 1].end);
    if (special.length) {
        let pos = 0;
        for (const b of special) {
            if (b.start > pos) parseChunk(lines.slice(pos, b.start), context, opts, records, skipped);
            records.push(b.make());
            pos = b.end;
        }
        if (pos < lines.length && lines.slice(pos).some(l => l.trim())) parseChunk(lines.slice(pos), context, opts, records, skipped);
        return;
    }
    // 1. Actor stat blocks take the whole region they cover.
    const actorStarts = findActorStarts(lines);
    if (actorStarts.length) {
        if (actorStarts[0] > 0) parseItemRegion(lines.slice(0, actorStarts[0]), context, opts, records, skipped);
        actorStarts.forEach((start, n) => {
            const regionEnd = n + 1 < actorStarts.length ? actorStarts[n + 1] : lines.length;
            const end = actorBlockEnd(lines, start, regionEnd);
            const block = lines.slice(start, end).join('\n');
            const forced = context.section?.documentName === 'Actor' ? context.section.type : undefined;
            const rec = parseStatBlock(block, { forceType: opts.forceType && resolveType(opts.forceType)?.documentName === 'Actor' ? resolveType(opts.forceType).type : forced });
            if (context.section?.hint?.critter) rec.fields.critter = true;
            records.push(rec);
            if (end < regionEnd) parseItemRegion(lines.slice(end, regionEnd), context, opts, records, skipped);
        });
        return;
    }
    // 2. Labeled stat block without a table ("Initiative ...", "Skills ...").
    const hintLines = lines.filter(l => ACTOR_HINT_LINE.test(l.trim())).length;
    const wantsActor = opts.forceType && resolveType(opts.forceType)?.documentName === 'Actor';
    if (hintLines >= 3 || (wantsActor && hintLines >= 1)) {
        records.push(parseStatBlock(lines.join('\n'), { forceType: wantsActor ? resolveType(opts.forceType).type : undefined }));
        return;
    }
    parseItemRegion(lines, context, opts, records, skipped);
}

/** Standard section headings in adventures (Shadowrun Missions and others): never an NPC's name. */
const ADVENTURE_HEADING = /^(?:characters(?: (?:&|and) critters)?|& critters|critters|the opposition|nonplayer characters|people|npcs and critters|cast of shadows|behind the scenes|pushing the envelope|debugging|scan this|tell it to them straight|legwork|picking up the pieces|player handouts|introduction|mission synopsis|debriefing log|gamemaster reward|reputation|contacts|money|karma|hooks?|plot synopsis|setup|adventure background|scene \d+\b.*|scene:.*|grunts and moving targets|npcs?)$/i;

const isCaps = t => /[A-Z]{2}/.test(t) && !/[a-z]/.test(t);

/** "FEMALE HUMAN", "Male Elf", "ORK": a metatype line under a name, not a name. */
export function isMetatypeTag(t) {
    return /^(?:(?:male|female|androgynous)\s+)?(?:human|elf|dwarf|ork|orc|troll|nartaki|gnome|hobgoblin|satyr|dryad|cyclops|fomori|giant|minotaur|oni|wakyambi|night one|menehune|koborokuru|ogre|nocturna|xapiri thepe)s?(?:\s+(?:male|female))?$/i.test(String(t).trim());
}

/** The nearest capitalised name line above i, passing over description text. */
function capsTitleAbove(lines, i, floor, reach = 60) {
    for (let j = i, seen = 0; j >= floor && seen < reach; j--, seen++) {
        const t = lines[j].trim();
        if (!t) continue;
        if (/[[\]|]/.test(t) || isAttributeHeader(t) || sectionOf(t)) return -1;
        if (isCaps(t) && isActorTitle(t) && !isMetatypeTag(t)) {
            let top = j;
            while (top - 1 >= floor && lines[top - 1].trim() && isCaps(lines[top - 1].trim()) && isActorTitle(lines[top - 1])) top--;
            return top;
        }
    }
    return -1;
}

/** A line that can be an NPC name: short, no sentence punctuation, not a stat or label line. */
function isActorTitle(line) {
    const t = line.trim();
    if (!t || t.length > 70 || /^[a-z(]/.test(t) || /[.,;:!?-]$/.test(t)) return false;
    // A stat label on its own ("Notes", "Critter Powers") is not a name.
    if (sectionOf(`${t}:`)?.rest === '') return false;
    // Sentences ("…since 2066. Loveland is forty-two") and running headers with a page number.
    if (/[a-z0-9][.!?]\s+[A-Za-z]/.test(t) && !/^(mr|mrs|ms|dr|st)\./i.test(t)) return false;
    if (/^[^a-z]*\s\d{1,3}$|^\d{1,3}\s+[^a-z]*$/.test(t) && isCaps(t)) return false;
    // Weapon or gear stats ("Natural weapons (unarmed, Acc 12, DV 7P, AP -1)") are not names.
    if (/\b(?:acc|dv|ap|reach|rc)\s*[-–—+(]?\s*\d/i.test(t)) return false;
    if (ADVENTURE_HEADING.test(t)) return false;
    // Letter-spaced display text ("B LO OD Y B US IN ESS", a running header) is not a name.
    const toks = t.split(/\s+/);
    if (toks.length >= 4 && toks.filter(w => w.length <= 2).length / toks.length >= 0.6) return false;
    if (/[[\]|]/.test(t) || ACTOR_HINT_LINE.test(t) || sectionOf(t) || isAttributeHeader(t) || isVehicleHeader(t)) return false;
    if (parseLabeledLine(t) && !/^name\s*:/i.test(t)) return false;
    return t.replace(/\(.*?\)/g, '').trim().split(/\s+/).length <= 7 && /[A-Za-z]/.test(t);
}

/**
 * Where each stat block starts: its name line. Walking up from the attribute table, description
 * lines are passed over; the name is the top of the run of name-like lines found first.
 */
function findActorStarts(lines) {
    const headers = [];
    lines.forEach((line, i) => {
        if (isAttributeHeader(line) || (isVehicleHeader(line) && !parseTableHeader(line)?.columns.includes('avail'))) headers.push(i);
    });
    // Stat lines of the block above (a wrapped description line ending in a comma is not one).
    const belongsToBlock = l => /[[\]|]/.test(l) || ACTOR_HINT_LINE.test(l) || (/[,;]$/.test(l) && l.split(/\s+/).length < 6)
        || (!!sectionOf(l) && !/^(description|background|notes)\s*:/i.test(l));
    const starts = [];
    headers.forEach((h, n) => {
        // Don't reach back into the previous stat block.
        let floor = 0;
        if (n > 0) {
            const prevEnd = actorBlockEnd(lines, starts[n - 1], h);
            floor = prevEnd < h ? prevEnd : headers[n - 1] + 2;
        }
        let title = -1;
        for (let j = h - 1; j >= floor; j--) {
            const t = lines[j].trim();
            if (!t) continue;
            if (/^name\s*:/i.test(t)) { title = j; break; }
            if (isActorTitle(t) && isMetatypeTag(t)) {
                // "FEMALE HUMAN" above the table: the name is further up, above the description.
                const name = capsTitleAbove(lines, j - 1, floor);
                if (name >= 0) { title = name; break; }
            }
            if (isActorTitle(t)) {
                // Take the top of a run of name-like lines ("Halloweener Ganger" above "Ork enforcer").
                // An all-caps name ("DOCWAGON" / "RESPONSE TEAM") only continues upward in capitals.
                const caps = isCaps(t);
                title = j;
                while (title - 1 >= floor && lines[title - 1].trim() && isActorTitle(lines[title - 1])
                    && (!caps || isCaps(lines[title - 1].trim()))) title--;
                break;
            }
            if (belongsToBlock(t)) break;
        }
        if (title < 0) {
            // A long description: the capitalised name further up.
            const name = capsTitleAbove(lines, h - 1, floor, 150);
            if (name >= 0) title = name;
        }
        if (title < 0) {
            title = h;
            for (let j = floor; j < h; j++) if (lines[j].trim() && !belongsToBlock(lines[j].trim())) { title = j; break; }
        }
        // "PILAR CARRILLO," above "A.K.A. MOSAIC".
        if (/^a\.?k\.?a\.?\s/i.test(lines[title]?.trim() ?? '') && title - 1 >= floor && isCaps(lines[title - 1].trim())) title--;
        starts.push(title);
    });
    return starts;
}

/** Where an actor block stops: the next labeled item entry, table or section heading. */
function actorBlockEnd(lines, start, end) {
    let sawHeader = false;
    let skipValues = false;
    for (let j = start; j < end; j++) {
        const t = lines[j].trim();
        if (isAttributeHeader(t) || isVehicleHeader(t)) { sawHeader = true; skipValues = true; continue; }
        if (!sawHeader) continue;
        if (skipValues) { if (t) skipValues = false; continue; }
        // A blank line ends the block only when what follows is neither a stat section nor the
        // continuation of a list (PDF copies put blank lines inside skill and gear lists).
        if (!t) {
            let k = j + 1;
            while (k < end && !lines[k].trim()) k++;
            if (k >= end) continue;
            const next = lines[k].trim();
            let p = j - 1;
            while (p >= start && !lines[p].trim()) p--;
            const prev = p >= start ? lines[p].trim() : '';
            // An adventure heading ("Scene 6 (Optional): Hoofing It", "Debugging") always ends the block.
            if (ADVENTURE_HEADING.test(next) || /^scene\s+\d+\b/i.test(next)) return j;
            const continues = sectionOf(next) || /^[a-z(]/.test(next) || /[,;\-(\[]$/.test(prev)
                || (/[[(]/.test(next) && /\d|\]|\)/.test(next) && !/[.!?]$/.test(next))
                || /,\s*\S/.test(next) && /\d/.test(next) && !/[.!?]$/.test(next) && next.length < 120;
            if (!continues) return j;
            continue;
        }
        if (/^name\s*:/i.test(t)) return j;
        if (parseTableHeader(t) && !isVehicleHeader(t)) return j;
        const heading = sectionHeading(t);
        // A stat block label on its own line ("Critter Powers" with the powers below) is not a heading.
        if (heading && heading.documentName === 'Item' && !sectionOf(t) && !/^(weapons?|armor|spells?|powers?|gear)$/i.test(t)) return j;
        if (!t && j + 1 < end && isTitleLike(lines[j + 1]) && looksLikeEntryStart(lines, j + 1)) return j;
    }
    return end;
}

/* ------------------------------------------------------------------ */

function isTitleLike(line) {
    const t = line.trim();
    if (!t || t.length > 80) return false;
    if (/:/.test(t.replace(/\(.*?\)/g, ''))) return false;
    if (/[.!?,;]$/.test(t)) return false;
    if (/^[a-z]/.test(t)) return false;
    if (t.split(/\s+/).length > 9) return false;
    if (/^\(.*\)$/.test(t)) return false;
    if (/^[•\-*]/.test(t)) return false;
    return /[A-Za-z]/.test(t);
}

function isDescriptorLine(line) {
    const m = /^\(([^)]+)\)$/.exec(line.trim());
    return !!m && m[1].split(/\s*,\s*/).every(w => DESCRIPTOR_WORDS.test(w.trim()));
}

function parseItemRegion(lines, context, opts, records, skipped) {
    const heads = [];
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (!t) continue;

        if (parseTableHeader(t)) {
            const { records: rows, end, skipped: sk } = parseTable(lines, i, { sub: context.section?.sub, hint: context.section?.hint });
            if (rows.length) {
                // Close any open entry before the table.
                heads.push({ index: i, table: true, end, rows });
                skipped.push(...sk);
                i = end - 1;
                continue;
            }
        }

        const heading = sectionHeading(t);
        const next = nextContent(lines, i);
        if (heading && !(next && parseLabeledLine(next.text) && !sectionHeading(next.text) && looksLikeEntryStart(lines, i))) {
            heads.push({ index: i, heading });
            continue;
        }
        if (/^name\s*:/i.test(t)) { heads.push({ index: i, named: true }); continue; }
        if (isTitleLike(t) && looksLikeEntryStart(lines, i)) heads.push({ index: i });
    }

    if (!heads.length) {
        fallback(lines, context, opts, records, skipped);
        return;
    }
    if (heads[0].index > 0) fallback(lines.slice(0, heads[0].index), context, opts, records, skipped);

    heads.forEach((h, n) => {
        const nextIndex = n + 1 < heads.length ? heads[n + 1].index : lines.length;
        if (h.table) {
            records.push(...h.rows);
            if (h.end < nextIndex) fallback(lines.slice(h.end, nextIndex), context, opts, records, skipped);
            return;
        }
        if (h.heading) {
            context.section = h.heading;
            // Lines between a heading and the next entry: header-less rows or a list of names.
            if (h.index + 1 < nextIndex) fallback(lines.slice(h.index + 1, nextIndex), context, opts, records, skipped);
            return;
        }
        const end = n + 1 < heads.length ? heads[n + 1].index : lines.length;
        const rec = parseEntry(lines.slice(h.index, end), context, opts);
        if (rec) records.push(rec);
    });
}

function nextContent(lines, i) {
    for (let j = i + 1; j < lines.length && j <= i + 3; j++) if (lines[j].trim()) return { index: j, text: lines[j].trim() };
    return null;
}

function looksLikeEntryStart(lines, i) {
    let seen = 0;
    for (let j = i + 1; j < lines.length && seen < 3; j++) {
        const t = lines[j].trim();
        if (!t) continue;
        seen++;
        if (isDescriptorLine(t)) continue;
        const labeled = parseLabeledLine(t);
        if (labeled && !labeled.name) return true;
        if (seen === 1 && !labeled) return false;
    }
    return false;
}

/* ------------------------------------------------------------------ */

function parseEntry(lines, context, opts) {
    const fields = {};
    const descriptionLines = [];
    let name = '';
    let descriptors = [];
    const rawText = lines.join('\n');

    lines.forEach((line, idx) => {
        const t = line.trim();
        if (idx === 0) {
            if (/^name\s*:/i.test(t)) { name = t.replace(/^name\s*:\s*/i, ''); return; }
            name = t;
            return;
        }
        if (!t) { descriptionLines.push(''); return; }
        if (idx <= 2 && isDescriptorLine(t)) { descriptors.push(...t.slice(1, -1).split(/\s*,\s*/)); return; }
        const labeled = parseLabeledLine(t);
        if (labeled && !descriptionLines.some(Boolean)) { mergeFields(fields, labeled); return; }
        if (labeled && Object.keys(labeled).length >= 2) { mergeFields(fields, labeled); return; }
        descriptionLines.push(t);
    });

    // Descriptors inside the title: "ACID STREAM (INDIRECT, ELEMENTAL)".
    const titleParen = /\(([^)]+)\)\s*$/.exec(name);
    if (titleParen && titleParen[1].split(/\s*,\s*/).every(w => DESCRIPTOR_WORDS.test(w.trim()))) {
        descriptors.push(...titleParen[1].split(/\s*,\s*/));
        name = name.slice(0, titleParen.index).trim();
    }
    if (descriptors.length && !fields.descriptors) fields.descriptors = descriptors.join(', ');

    const description = joinParagraphs(descriptionLines);
    if (description && !fields.description) fields.description = description;
    else if (description) fields.description = `${fields.description}\n\n${description}`;

    const target = decideItemType(fields, context, opts, rawText);
    const hint = { ...(context.section?.hint ?? {}) };
    if (target.qualityType) hint.qualityType = target.qualityType;
    if (/^\s*bonus\s*:/im.test(rawText) && target.type === 'quality') hint.qualityType = 'negative';
    if (context.section?.sub && !fields.category) fields.category = context.section.sub;

    return {
        documentName: target.documentName,
        type: target.type,
        name: tidyName(name) || 'Unnamed',
        fields: sanitizeFields(fields, target.type),
        hint,
        warnings: target.guessed ? [`Type guessed as "${target.type}". Change it in the preview if wrong.`] : [],
        raw: rawText,
    };
}

function mergeFields(target, src) {
    for (let [k, v] of Object.entries(src)) {
        // "DV: F - 3" is drain, "FV: L + 1" / "DV: L + 1" is fade.
        if (k === 'damage' && /^\s*F\s*([+-]\s*\d+)?\s*$/i.test(v)) k = 'drain';
        if (k === 'damage' && /^\s*L\s*([+-]\s*\d+)?\s*$/i.test(v)) k = 'fade';
        if (target[k] === undefined || target[k] === '') target[k] = v;
        else if (k === 'type' && target.type && target.type !== v) target.subtype ??= v;
    }
}

function joinParagraphs(lines) {
    const paragraphs = [];
    let cur = '';
    for (const l of lines) {
        if (!l) { if (cur) paragraphs.push(cur); cur = ''; continue; }
        if (cur && /-$/.test(cur) && /^[a-z]/.test(l)) cur = cur.slice(0, -1) + l;
        else cur = cur ? `${cur} ${l}` : l;
    }
    if (cur) paragraphs.push(cur);
    return paragraphs.join('\n\n');
}

function sanitizeFields(fields, type) {
    // Adept power cost is in PP, quality cost in karma.
    if (type === 'adept_power' && fields.cost !== undefined && fields.pp === undefined) { fields.pp = fields.cost; delete fields.cost; }
    if (type === 'quality' && fields.cost !== undefined && fields.karma === undefined) { fields.karma = fields.cost; delete fields.cost; }
    if (type === 'spell' && fields.damage !== undefined && fields.drain === undefined && /F/i.test(fields.damage)) { fields.drain = fields.damage; delete fields.damage; }
    // Spells and complex forms: "DV" means drain / fade.
    if (type === 'complex_form' && fields.damage && /L/i.test(fields.damage)) { fields.fade = fields.damage; delete fields.damage; }
    return fields;
}

/**
 * Work out the system type for a labeled entry.
 */
export function decideItemType(fields, context, opts, rawText = '') {
    if (opts.forceType) {
        const forced = resolveType(opts.forceType);
        if (forced) return forced;
    }
    const typeField = String(fields.type ?? '').trim();
    if (typeField && !/^[MP]$/i.test(typeField) && !/^(mana|physical)$/i.test(typeField)) {
        const resolved = resolveType(typeField);
        if (resolved) {
            if (resolved.sub && !fields.category && !/^(gear|equipment|item|contact)s?$/i.test(resolved.sub)) fields.category = resolved.sub;
            // The type word chose the document type; don't also store it as a field (e.g. contact archetype).
            delete fields.type;
            if (resolved.type === 'quality' && /neg/i.test(typeField)) return { ...resolved, qualityType: 'negative' };
            if (resolved.type === 'quality' && /pos/i.test(typeField)) return { ...resolved, qualityType: 'positive' };
            return resolved;
        }
    }
    const has = k => fields[k] !== undefined && String(fields[k]).trim() !== '';
    const raw = rawText.toLowerCase();

    if (has('damage') && (has('accuracy') || has('ap') || has('mode') || has('reach') || has('ammo') || has('rc'))) return { documentName: 'Item', type: 'weapon' };
    if (has('fade') || (has('target') && /\bl\s*[+-]\s*\d/.test(raw))) return { documentName: 'Item', type: 'complex_form' };
    if (/^[MP]$/i.test(typeField) && has('activation')) return { documentName: 'Item', type: 'critter_power' };
    if (has('drain') || (/^[MP]$/i.test(typeField) && has('range') && has('duration'))) {
        if (context.section?.type === 'ritual') return { documentName: 'Item', type: 'ritual' };
        return { documentName: 'Item', type: 'spell' };
    }
    if (has('pp') || /\bpp\b|power points?/.test(String(fields.cost ?? '').toLowerCase())) return { documentName: 'Item', type: 'adept_power' };
    if (has('karma') || /karma/i.test(String(fields.cost ?? '')) || /^\s*bonus\s*:/im.test(rawText)) return { documentName: 'Item', type: 'quality' };
    if (has('essence')) return { documentName: 'Item', type: context.section?.type === 'bioware' || isBioware(fields.name ?? '') ? 'bioware' : 'cyberware' };
    if (has('connection') || has('loyalty')) return { documentName: 'Item', type: 'contact' };
    if (has('attack') || has('sleaze') || has('data_processing') || has('firewall') || has('attributearray')) return { documentName: 'Item', type: 'device' };
    if (has('armor') && !has('damage') && !has('handling')) return { documentName: 'Item', type: 'armor' };
    if (has('activation') && /power/.test(context.section?.type ?? 'adept_power')) return { documentName: 'Item', type: context.section?.type ?? 'adept_power' };
    if (context.section) return { documentName: context.section.documentName, type: context.section.type };
    if (/\b(?:ammunition|ammo)\b/i.test(rawText.split('\n')[0] ?? '')) return { documentName: 'Item', type: 'ammo' };
    const fallbackType = resolveType(opts.defaultType ?? 'equipment') ?? { documentName: 'Item', type: 'equipment' };
    return { ...fallbackType, guessed: true };
}

/** Entries with no structure at all. */
function fallback(lines, context, opts, records, skipped = []) {
    const content = lines.map(l => l.trim()).filter(Boolean);
    if (!content.length) return;
    const labeledCount = content.filter(l => parseLabeledLine(l)).length;
    const shortList = content.every(l => l.length <= 60 && !/[.!?]$/.test(l));
    const listType = opts.forceType ?? context.section?.type;
    const target = listType ? resolveType(listType) ?? { documentName: 'Item', type: 'equipment' } : null;
    // One-line entries: "Toughness (9 Karma)", "Toughness: 9 Karma", "TOUGHNESS COST: 9 KARMA", "Medkit Rating: 6 Cost: 1,500¥".
    if (!target || target.documentName === 'Item') {
        const singles = content.map(l => parseOneLineEntry(l, context, opts, target));
        if (singles.every(Boolean)) { records.push(...singles); return; }
    }
    // Gear rows without a header line: "Combat axe 4 2 (STR + 5)P -4 12R 4,000¥".
    if (!labeledCount && (!target || target.documentName === 'Item')) {
        const rows = content.map(l => parseLooseRow(l, target?.type));
        if (rows.some(Boolean)) {
            content.forEach((l, n) => {
                const row = rows[n];
                if (row) {
                    records.push({
                        documentName: 'Item', type: target?.type && target.type !== 'equipment' ? target.type : row.type,
                        name: tidyName(row.name), fields: { ...row.fields, ...(context.section?.sub && !row.fields.category ? { category: context.section.sub } : {}) },
                        hint: { ...(context.section?.hint ?? {}) }, warnings: [], raw: l,
                    });
                } else if (target) {
                    records.push(nameOnlyRecord(l, target, context));
                } else {
                    skipped.push(l.slice(0, 80));
                }
            });
            return;
        }
    }
    if (!labeledCount && !listType) {
        // Unstructured text (story text, credits, page headers) is not imported. It is expected in
        // adventures and rulebooks, so it is not reported either; only unreadable table rows are.
        return;
    }
    // Story text after a heading such as CRITTER POWERS ends that heading's list: it is not a list of
    // names, and the heading must not carry on into the rest of the book.
    if (!labeledCount && !opts.forceType && isProse(content)) {
        context.section = null;
        return;
    }
    if (!labeledCount && shortList && listType) {
        // A plain list of names ("Manabolt\nStunbolt\nHeal").
        for (const l of content) records.push(nameOnlyRecord(l, target, context));
        return;
    }
    const rec = parseEntry(content, context, opts);
    if (rec) records.push(rec);
}

/** Sentences rather than a list: long lines, or lines that end like sentences. */
function isProse(content) {
    const words = content.map(l => l.split(/\s+/).length);
    const avg = words.reduce((a, b) => a + b, 0) / content.length;
    const sentences = content.filter(l => /[.!?”"]$/.test(l) && l.split(/\s+/).length >= 6).length;
    return avg >= 8 || sentences / content.length >= 0.4;
}

function nameOnlyRecord(line, target, context) {
    const m = /^(.*?)\s*(?:\((?:rating\s*)?(\d+)\)|\s(\d+))?$/i.exec(line);
    const n = m?.[2] ?? m?.[3];
    // In a quality list the number after the name is its Karma cost ("Toughness 9").
    const fields = target.type === 'quality' ? { karma: n } : { rating: n };
    return {
        documentName: target.documentName, type: target.type, name: tidyName(m?.[1] || line),
        fields, hint: { ...(context.section?.hint ?? {}) }, warnings: [], raw: line,
    };
}

const KARMA_LINE = /^(.+?)\s*(?:[:(–—-]\s*|\s)(?:(cost|bonus)\s*:?\s*)?([+-]?\d+(?:\s*(?:to|-|–)\s*\d+)?)\s*karma(?:\s*(?:per|\/)\s*(?:level|rating))?\)?\s*$/i;

/**
 * A whole entry on one line, or null.
 */
function parseOneLineEntry(line, context, opts, target) {
    // Qualities: "Toughness (9 Karma)", "Toughness: 9 Karma", "Allergy (Bonus: 5 to 25 Karma)".
    const k = KARMA_LINE.exec(line);
    if (k && (!target || target.type === 'quality')) {
        const negative = /bonus/i.test(k[2] ?? '') || /^-/.test(k[3]) || context.section?.hint?.qualityType === 'negative';
        return {
            documentName: 'Item', type: 'quality', name: tidyName(k[1].replace(/[:(–—-]\s*$/, '').trim()),
            fields: { karma: k[3].replace(/^-/, '') }, hint: { ...(context.section?.hint ?? {}), ...(negative ? { qualityType: 'negative' } : {}) },
            warnings: [], raw: line,
        };
    }
    // Name followed by labels on the same line: "TOUGHNESS COST: 9 KARMA", "Medkit Rating: 6 Avail: 6 Cost: 1,500¥".
    const m = /^(.+?)\s+((?:Cost|Bonus|Rating|Avail|Availability|Type|Armor|Essence|Capacity|Acc|Accuracy|DV|Damage|AP|Karma|Activation|Range|Duration|Drain|FV|Target|PP)\s*:.*)$/i.exec(line);
    if (m) {
        const labeled = parseLabeledLine(m[2]);
        if (labeled) {
            const fields = {};
            mergeFields(fields, labeled);
            const t = decideItemType(fields, context, { ...opts, forceType: opts.forceType ?? target?.type }, line);
            const hint = { ...(context.section?.hint ?? {}) };
            if (/\bbonus\s*:/i.test(line) && t.type === 'quality') hint.qualityType = 'negative';
            return { documentName: t.documentName, type: t.type, name: tidyName(m[1]), fields: sanitizeFields(fields, t.type), hint, warnings: [], raw: line };
        }
    }
    return null;
}

export { toNumber };
