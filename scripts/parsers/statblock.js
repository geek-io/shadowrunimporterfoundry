/**
 * Parse Shadowrun 5e stat blocks (NPCs, grunts, critters, spirits, sprites, IC, vehicles)
 * from plain text into a normalized actor record.
 */
import {
    ATTRIBUTE_ALIASES, SKILL_GROUPS, skillKey, splitList, parseAugmented, toNumber, tidyName,
} from './common.js';
import { parseStatTokens } from './fields.js';
import { parseLooseRow } from './tables.js';
import {
    METATYPES, spiritTypeFromName, spriteTypeFromName, icTypeFromName, vehicleTypeFromText,
    weaponProfile, isBioware,
} from './types.js';

/* ------------------------------------------------------------------ */
/* Attribute tables                                                   */
/* ------------------------------------------------------------------ */

const HEADER_TOKENS = new Set([
    'B', 'A', 'R', 'S', 'W', 'L', 'I', 'C', 'EDG', 'EDGE', 'ESS', 'M', 'MAG', 'RES', 'BOD', 'AGI', 'REA', 'STR',
    'WIL', 'LOG', 'INT', 'CHA', 'INIT', 'INI', 'AC', 'CM', 'D', 'MOVE', 'F',
]);
const IGNORED_COLUMNS = new Set(['INIT', 'INI', 'AC', 'CM', 'D', 'MOVE']);

const VALUE_TOKEN = /[FL]\s*\/\s*2|\(?\s*[FL]\s*(?:[x×*]\s*\d+)?\s*\)?\s*[+-]\s*\d+\s*D\s*6|\d+\s*\+\s*\d+\s*D\s*6|[FL]\s*[+-]\s*\d+|[FL](?![a-z])|\d+(?:\.\d+)?\s*\(\s*\d+(?:\.\d+)?\s*\)|\d+(?:\.\d+)?|[-–—](?=\s|$)/gi;

/** Is this line an attribute header ("B A R S W L I C ESS")? */
export function isAttributeHeader(line) {
    const tokens = String(line ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (tokens.length < 5) return false;
    const known = tokens.filter(t => HEADER_TOKENS.has(t)).length;
    const anchored = ['B', 'BOD', 'W', 'WIL'].some(t => tokens.includes(t));
    return anchored && known >= 5 && known / tokens.length >= 0.8;
}

/** Is this line a vehicle stat header ("Handl Speed Accel Bod Armor Pilot Sensor Seats")? */
export function isVehicleHeader(line) {
    const s = String(line ?? '').toLowerCase();
    return /\bhand(l|ling)?\b/.test(s) && /\bspeed\b/.test(s) && /\b(bod|body)\b/.test(s) && /\bpilot\b/.test(s);
}

function parseAttributeValue(token) {
    const t = String(token).replace(/\s+/g, '').toUpperCase();
    if (/^[FL]$/.test(t)) return { relative: 0 };
    if (/^[FL]\/2$/.test(t)) return { half: true };
    const rel = /^[FL]([+-]\d+)$/.exec(t);
    if (rel) return { relative: Number(rel[1]) };
    if (/^[-–—]$/.test(t)) return null;
    const aug = parseAugmented(t);
    return { base: aug.base, augmented: aug.augmented };
}

function readAttributeTable(header, valueLine) {
    const heads = header.trim().toUpperCase().split(/\s+/);
    const values = String(valueLine ?? '').match(VALUE_TOKEN) ?? [];
    const attributes = {};
    let initiative;
    const n = Math.min(heads.length, values.length);
    for (let i = 0; i < n; i++) {
        const h = heads[i];
        if (h === 'INIT' || h === 'INI') { initiative = values[i]; continue; }
        if (IGNORED_COLUMNS.has(h)) continue;
        const key = ATTRIBUTE_ALIASES[h.toLowerCase()];
        if (!key) continue;
        const v = parseAttributeValue(values[i]);
        if (v) attributes[key] = v;
    }
    return { attributes, initiative, mismatch: heads.length !== values.length };
}

/** "Body 4, Agility 5 (7)", "BOD 4 AGI 3", "Attack L, Sleaze L+3" */
function readAttributePairs(text) {
    const attributes = {};
    const re = /\b(body|bod|agility|agi|reaction|rea|strength|str|willpower|wil|logic|log|intuition|int|charisma|cha|edge|edg|essence|ess|magic|mag|resonance|res|force|attack|sleaze|data\s*processing|data\s*proc|firewall|level)\b\s*:?\s*(\(?[FL]\s*[+-]\s*\d+\)?|[FL](?![a-z])|\d+(?:\.\d+)?\s*(?:\(\s*\d+(?:\.\d+)?\s*\))?)/gi;
    for (const m of String(text ?? '').matchAll(re)) {
        const key = ATTRIBUTE_ALIASES[m[1].toLowerCase().replace(/\s+/g, ' ')] ?? ATTRIBUTE_ALIASES[m[1].toLowerCase().replace(/\s+/g, '')];
        if (!key) continue;
        const v = parseAttributeValue(m[2].replace(/[()]/g, m[2].includes('+') || m[2].includes('-') ? '' : '$&'));
        if (v && attributes[key] === undefined) attributes[key] = v;
    }
    return attributes;
}

const GROUP_LINE = /^\(\s*(?:(\d+)\s*[,;]\s*)?(professional\s+rating|pr|force|level|rating)\s*:?\s*(\d+)\s*\)$/i;

/** An all-caps name line: "DOCWAGON", "RESPONSE TEAM". */
function isCapsTitle(t) {
    return !!t && t.length <= 40 && /[A-Z]{2}/.test(t) && !/[a-z]/.test(t) && !/[:\[\]|(),.;]/.test(t)
        && t.split(/\s+/).length <= 5 && !isAttributeHeader(t) && !isVehicleHeader(t);
}

/* ------------------------------------------------------------------ */
/* Sections                                                           */
/* ------------------------------------------------------------------ */

const SECTIONS = [
    ['astral_initiative', /^astral\s+init(?:iative)?\b/i],
    ['matrix_initiative', /^(?:matrix|vr|ar)\s+init(?:iative)?\b/i],
    ['initiative', /^(?:initiative|init)\b(?!\s*\w+\s+(?:test|score))/i],
    ['condition', /^(?:condition\s+monitors?(?:\s*\(\s*p\s*\/\s*s\s*\))?|cm)\b/i],
    ['limits', /^limits?\b/i],
    ['armor', /^armou?r\b(?=\s*:|\s*\d)/i],
    ['knowledge', /^knowledge(?:\s+skills?)?\b/i],
    ['languages', /^languages?(?:\s+skills?)?\b/i],
    ['skills', /^(?:active\s+)?skills?\b/i],
    ['qualities', /^(?:positive\s+|negative\s+)?qualit(?:y|ies)\b/i],
    ['augmentations', /^(?:augmentations?|cyberware|bioware|ware|implants|cyberware\s*\/\s*bioware)\b/i],
    ['weapons', /^weapons?\b/i],
    ['gear', /^(?:gear|equipment)\b/i],
    ['spells', /^(?:spells?|known\s+spells)\b/i],
    ['adept_powers', /^adept\s+powers?\b/i],
    ['optional_powers', /^optional\s+powers?\b/i],
    ['weaknesses', /^weakness(?:es)?\b/i],
    ['powers', /^(?:critter\s+|spirit\s+|sprite\s+)?powers?\b/i],
    ['complex_forms', /^complex\s+forms?\b/i],
    ['programs', /^(?:programs?|autosofts?)\b/i],
    ['contacts', /^contacts?\b/i],
    ['metamagics', /^metamagics?\b/i],
    ['echoes', /^echoes\b/i],
    ['initiate', /^initiat(?:e|ion)(?:\s+grade)?\b(?=\s*:?\s*\d)/i],
    ['submersion', /^submersion(?:\s+grade)?\b(?=\s*:?\s*\d)/i],
    ['tradition', /^tradition\b/i],
    ['metatype', /^(?:metatype|race)\b/i],
    ['force', /^force\b(?=\s*:?\s*\d)/i],
    ['level', /^level\b(?=\s*:?\s*\d)/i],
    ['host_rating', /^host\s+rating\b/i],
    ['rating', /^(?:professional\s+rating|rating|pr)\b(?=\s*:?\s*\d)/i],
    ['essence', /^essence\b(?=\s*:?\s*\d)/i],
    ['movement', /^movement\b/i],
    ['matrix', /^(?:matrix\s+attributes|device\s+rating)\b/i],
    ['notes', /^(?:notes|special|description|tactics|background)\b\s*:/i],
    ['lifestyle', /^lifestyle\b/i],
    ['nuyen', /^nuyen\b/i],
    ['karma', /^karma\b(?=\s*:?\s*\d)/i],
    ['vehicle_stats', /^(?:handling|handl)\b(?=.*speed)/i],
];

export function sectionOf(line) {
    const s = line.replace(/^[•\-*\s]+/, '');
    for (const [key, re] of SECTIONS) {
        const m = re.exec(s);
        if (m) return { key, rest: s.slice(m[0].length).replace(/^\s*[:\-–]?\s*/, ''), colon: /^\s*:/.test(s.slice(m[0].length)) };
    }
    return null;
}

/**
 * Join section lines into one string, inserting list separators where one item clearly ends on a line.
 */
function joinListLines(lines) {
    let out = '';
    let depth = 0;
    lines.forEach((line, i) => {
        const t = line.trim();
        if (!t) return;
        if (i > 0 && out) {
            const prev = out.trimEnd();
            if (/[A-Za-z]-$/.test(prev)) {
                // Word broken across lines: "frighten-" + "ing" → "frightening", "Semi-" + "Automatics" → "Semi-Automatics".
                out = /^[a-z]/.test(t) ? prev.slice(0, -1) : prev;
            } else {
                const endsItem = depth === 0 && (/[\])]$/.test(prev) || (/[A-Za-z0-9]$/.test(prev) && /^[A-Z]/.test(t) && /\d$|\]$|\)$/.test(prev)));
                out += (depth === 0 && (prev.endsWith(',') || prev.endsWith(';'))) ? ' ' : endsItem ? ', ' : ' ';
            }
        }
        out += t;
        for (const ch of t) {
            if ('([{'.includes(ch)) depth++;
            if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
        }
    });
    return out.trim();
}

/** Lines → paragraphs: wrapped lines joined with spaces, blank lines separate paragraphs. */
function joinParagraphs(lines) {
    const out = [];
    let cur = '';
    for (const l of lines) {
        // A blank line only ends a paragraph after a finished sentence (PDF copies add stray blank lines).
        if (!l) { if (cur && /[.!?:"')\]]$/.test(cur)) { out.push(cur); cur = ''; } continue; }
        cur = cur ? (/[a-z]-$/.test(cur) && /^[a-z]/.test(l) ? cur.slice(0, -1) + l : `${cur} ${l}`) : l;
    }
    if (cur) out.push(cur);
    return out.join('\n\n');
}

/* ------------------------------------------------------------------ */
/* Entries                                                            */
/* ------------------------------------------------------------------ */

/** "Pistols (Semi-Automatics) 6 (+2)", "Automatics 5", "Firearms group 4", "English N", "Assensing" */
export function parseSkillEntry(entry, { defaultRating } = {}) {
    let s = entry.trim().replace(/\.$/, '');
    if (!s) return null;
    const out = { name: '', rating: undefined, specs: [], group: false, native: false };

    if (/\bnative\b|\bN$/.test(s) || /\s+N\s*(\(|$)/.test(s)) {
        out.native = true;
        s = s.replace(/\bnative\b|\s+N(?=\s*(\(|$))/i, '').trim();
    }
    if (/\b(skill\s+)?group\b/i.test(s)) { out.group = true; s = s.replace(/\(?\s*\b(skill\s+)?group\b\s*\)?/i, ' ').trim(); }

    // Specializations in parentheses or brackets containing letters.
    s = s.replace(/[([]\s*([^()[\]]*[A-Za-z][^()[\]]*)\s*[)\]]/g, (m, inner) => {
        if (/^\+?\d+$/.test(inner.trim())) return m;
        inner.split(/[,/]| or /).map(x => x.replace(/\+\d+/, '').trim()).filter(Boolean).forEach(x => out.specs.push(x));
        return ' ';
    });
    const rating = /(?:^|\s)(\d+)(?:\s*\(\s*\+?\d+\s*\))?\s*$/.exec(s) ?? /(?:^|\s)(\d+)\b/.exec(s);
    if (rating) {
        out.rating = Number(rating[1]);
        s = (s.slice(0, rating.index) + ' ' + s.slice(rating.index + rating[0].length)).trim();
    }
    // Specialization written as "Blades 4 (Swords +2)" was removed above; also "Pistols: Semi-Automatics".
    const colon = /^(.+?):\s*(.+)$/.exec(s);
    if (colon && !/\d/.test(colon[2])) { s = colon[1]; out.specs.push(colon[2].trim()); }

    out.name = s.replace(/\s+/g, ' ').replace(/[,;:]$/, '').trim();
    if (out.rating === undefined && defaultRating !== undefined) out.rating = defaultRating;
    if (!out.name) return null;
    return out;
}

/** First top-level "( … )" group, allowing nested parentheses. */
function firstParenGroup(s) {
    const start = s.indexOf('(');
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')' && --depth === 0) return { index: start, 0: s.slice(start, i + 1), 1: s.slice(start + 1, i) };
    }
    return null;
}

/** "Wired Reflexes 2", "cybereyes (Rating 3) [smartlink, flare comp]", "Improved Reflexes (2)" */
function parseNamedEntry(entry) {
    let s = entry.trim().replace(/\.$/, '');
    const out = { name: s, rating: undefined, bracket: '', paren: '' };
    const bracket = /\[([^\]]*)\]/.exec(s);
    if (bracket) { out.bracket = bracket[1].trim(); s = (s.slice(0, bracket.index) + s.slice(bracket.index + bracket[0].length)).trim(); }
    const paren = firstParenGroup(s);
    if (paren) {
        const inner = paren[1].trim();
        const r = /^(?:rating\s*|r\s*|level\s*|force\s*)?(\d+)$/i.exec(inner) ?? /(?:rating|level|force)\s*:?\s*(\d+)/i.exec(inner);
        if (r) out.rating = Number(r[1]);
        out.paren = inner;
        const removable = /^(?:device\s+)?(?:rating|r|level|force)?\s*:?\s*\d+$/i.test(inner)
            || /^(?:alpha|beta|delta|gamma|used|standard|grey)(?:ware)?(?:\s+grade)?$/i.test(inner)
            || /^x?\s*\d+\s*(?:doses?|rounds?|clips?|uses?|units?|meters?|m)?$/i.test(inner);
        if (removable) s = (s.slice(0, paren.index) + s.slice(paren.index + paren[0].length)).trim();
    }
    const trailing = /\s+(\d+(?:\.\d+)?)$/.exec(s);
    if (trailing && out.rating === undefined) { out.rating = Number(trailing[1]); s = s.slice(0, trailing.index).trim(); }
    out.name = s.replace(/\s+/g, ' ').trim();
    return out;
}

const ARMOR_WORDS = /armor|armour|jacket|vest|lined coat|coat|clothing|helmet|shield|form-?fitting|bodysuit|urban explorer|chameleon suit|ballistic|security suit|riot|ffbs|full body|mortimer|zoe|vashon|actioneer|victory|camouflage|camo|heavy military|milspec|suit|uniform/i;

function gearType(name, bracket) {
    const n = name.toLowerCase();
    if (/\bDV\b|\b\d+[PS]\b/.test(bracket ?? '')) return 'weapon';
    if (/\bfake\s+sin\b|\bsin\b/.test(n)) return 'sin';
    if (/fake license|license\b/.test(n)) return 'sin';
    if (/commlink|cyberdeck|\brcc\b|rigger command console|cyberterminal/.test(n)) return 'device';
    if (/lifestyle/.test(n)) return 'lifestyle';
    if (/rounds?\b|ammo|ammunition|\bclips?\b|magazine|\bdarts?\b|\barrows?\b|\bbolts?\b/.test(n)) return 'ammo';
    if (/grenade|minigrenade/.test(n)) return 'weapon';
    if ((/^\+?\d+$/.test(bracket.trim()) && ARMOR_WORDS.test(n)) || /\barmou?r\b/.test(n)) return 'armor';
    if (ARMOR_WORDS.test(n) && /^\+?\d+/.test(bracket.trim())) return 'armor';
    if (/^(agent|browse|configurator|edit|encryption|signal scrub|toolbox|virtual machine|armor|baby monitor|biofeedback|biofeedback filter|blackout|decryption|defuse|demolition|exploit|fork|guard|hammer|lockdown|mugger|shell|sneak|stealth|track|wrapper)\b/.test(n) && /program/.test(n)) return 'program';
    return 'equipment';
}

function item(type, name, fields = {}, hint = {}) {
    const n = tidyName(name);
    return { documentName: 'Item', type, name: n.charAt(0).toUpperCase() + n.slice(1), fields, hint, lookup: true };
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

/**
 * @param {string} text   a single stat block
 * @param {object} [opts]
 * @param {string} [opts.forceType] actor type override ('character','spirit','sprite','vehicle','ic')
 * @returns {object} actor record
 */
export function parseStatBlock(text, opts = {}) {
    const lines = String(text ?? '').split('\n').map(l => l.replace(/\s+$/, ''));
    const warnings = [];
    const record = {
        documentName: 'Actor',
        type: opts.forceType ?? 'character',
        name: '',
        fields: { attributes: {}, initiative: {}, npc: true },
        skills: [],
        children: [],
        warnings,
        raw: text,
    };
    const f = record.fields;

    // ---- Attribute table and name ----
    let headerIndex = lines.findIndex(isAttributeHeader);
    let vehicleHeaderIndex = lines.findIndex(isVehicleHeader);
    const firstContentIndex = lines.findIndex(l => l.trim());
    const stop = [headerIndex, vehicleHeaderIndex].filter(i => i >= 0).reduce((a, b) => Math.min(a, b), lines.length);
    // The first line is the name ("Name:" label allowed). Everything else before the stat table is the
    // NPC's description, kept as written (paragraphs separated by blank lines).
    const consumed = new Set();
    let title = 'Unnamed';
    const descLines = [];
    if (firstContentIndex >= 0 && firstContentIndex < stop) {
        title = lines[firstContentIndex].trim().replace(/^name\s*:\s*/i, '');
        consumed.add(firstContentIndex);
        // "Lieutenant: Gangers who've threatened…" – a short name, then the description on the same line.
        const inline = /^([^:]{2,40}):\s+(.+)$/.exec(title);
        if (inline && inline[1].trim().split(/\s+/).length <= 5 && !sectionOf(title)) {
            title = inline[1].trim();
            descLines.push(inline[2].trim());
        }
        // Names printed over two all-caps lines ("HYBRID ANT" / "SPIRIT SOLDIERS").
        let i0 = firstContentIndex + 1;
        if (isCapsTitle(title)) {
            while (i0 < stop && isCapsTitle(lines[i0].trim()) && !sectionOf(lines[i0].trim())) {
                title = `${title} ${lines[i0].trim()}`;
                consumed.add(i0);
                i0++;
            }
        }
        for (let i = i0; i < stop; i++) {
            const t = lines[i].trim();
            // "(4, PROFESSIONAL RATING 3)", "(2, FORCE 5)": how many appear, and their rating.
            const group = GROUP_LINE.exec(t);
            if (group) {
                if (group[1]) f.groupSize = Number(group[1]);
                const kind = group[2].toLowerCase();
                const n = Number(group[3]);
                if (/force/.test(kind)) f.force = n;
                else if (/level/.test(kind)) f.level = n;
                else f.professionalRating = n;
                consumed.add(i);
                continue;
            }
            const sec = t ? sectionOf(t) : null;
            if (sec && sec.key !== 'notes') break;
            // "Body 4, Agility 3, ..." or "Attack L, Sleaze L+3, ..." – labeled attributes, not description.
            if (t.length < 200 && Object.keys(readAttributePairs(t)).length >= 3) break;
            consumed.add(i);
            descLines.push(t.replace(/^(?:description|background|notes)\s*:\s*/i, ''));
        }
    }
    const description = joinParagraphs(descLines);
    if (description) f.description = description;
    // Rank, metatype, Force and Level are read from the name and a short tag line under it.
    const tagLine = descLines.find(Boolean) ?? '';
    const titleExtra = tagLine.length <= 60 ? tagLine : '';

    const pr = /professional\s+rating\s*:?\s*(\d+)|\bPR\s*:?\s*(\d+)/i.exec(`${title} ${titleExtra}`);
    if (pr) f.professionalRating = Number(pr[1] ?? pr[2]);
    if (/\bgrunts?\b/i.test(`${title} ${titleExtra}`)) f.grunt = true;
    const forceInTitle = /\(\s*force\s*(\d+)\s*\)|\bforce\s+(\d+)\b/i.exec(`${title} ${titleExtra}`);
    if (forceInTitle) f.force = Number(forceInTitle[1] ?? forceInTitle[2]);
    const levelInTitle = /\(\s*level\s*(\d+)\s*\)|\blevel\s+(\d+)\b/i.exec(`${title} ${titleExtra}`);
    if (levelInTitle) f.level = Number(levelInTitle[1] ?? levelInTitle[2]);
    const meta = /\b(human|elf|ork|orc|dwarf|troll)\b/i.exec(`${title} ${titleExtra}`);
    if (meta) f.metatype = METATYPES[meta[1].toLowerCase()];
    title = title.replace(/\(\s*(professional\s+rating|pr|force|level|rating)\s*:?\s*\d+\s*\)/ig, '').replace(/\s*[-:–]\s*$/, '').trim();
    record.name = tidyName(title);

    if (headerIndex >= 0) {
        let vi = headerIndex + 1;
        while (vi < lines.length && !lines[vi].trim()) vi++;
        const table = readAttributeTable(lines[headerIndex], lines[vi]);
        Object.assign(f.attributes, table.attributes);
        if (table.initiative) f.initiative.meatspace = parseInitiative(table.initiative);
        if (table.mismatch) warnings.push('Attribute header and value counts differ; check attributes.');
        consumed.add(headerIndex); consumed.add(vi);
    }
    if (vehicleHeaderIndex >= 0) {
        let vi = vehicleHeaderIndex + 1;
        while (vi < lines.length && !lines[vi].trim()) vi++;
        Object.assign(f, { vehicle: parseVehicleRow(lines[vehicleHeaderIndex], lines[vi]) });
        consumed.add(vehicleHeaderIndex); consumed.add(vi);
        if (!opts.forceType) record.type = 'vehicle';
    }

    // ---- Sections ----
    const sections = [];
    let current = null;
    // Books that write "Skills:" with a colon: a list line that merely starts with a section word
    // ("Throwing" / "Weapons 4, Unarmed Combat 5") continues the list above it.
    const colonStyle = lines.filter((l, i) => !consumed.has(i) && sectionOf(l.trim())?.colon).length >= 3;
    const LIST_SECTIONS = new Set(['skills', 'knowledge', 'languages', 'qualities', 'augmentations', 'gear', 'weapons', 'spells', 'powers', 'adept_powers', 'complex_forms', 'programs', 'contacts', 'optional_powers', 'weaknesses']);
    lines.forEach((line, i) => {
        if (consumed.has(i)) return;
        const t = line.trim();
        if (!t) return;
        let sec = sectionOf(t);
        if (sec && colonStyle && !sec.colon && current && LIST_SECTIONS.has(current.key)
            && !/[.!?]$/.test(current.lines[current.lines.length - 1] ?? '')) sec = null;
        if (sec) {
            current = { key: sec.key, lines: [sec.rest] };
            sections.push(current);
        } else if (current) {
            current.lines.push(t);
        } else {
            // Flavour text before the first section.
            (f._preamble ??= []).push(t);
        }
    });

    // Attribute pairs anywhere ("Body 4, Agility 5") when no table was found.
    if (headerIndex < 0) {
        const pairs = readAttributePairs((f._preamble ?? []).join('\n') + '\n' + sections.filter(s => !['skills', 'knowledge', 'languages', 'gear', 'weapons', 'notes'].includes(s.key)).map(s => s.lines.join(' ')).join('\n'));
        Object.assign(f.attributes, pairs);
    }

    for (const sec of sections) handleSection(record, sec.key, sec.lines, warnings);
    dedupeSkills(record);

    // ---- Type detection ----
    if (!opts.forceType) record.type = detectActorType(record);
    finalizeByType(record);

    if (f._preamble) f._preamble = f._preamble.filter(l => !(l.length < 200 && Object.keys(readAttributePairs(l)).length >= 3));
    if (f._preamble?.length) f.notes = [f.notes, f._preamble.join('\n')].filter(Boolean).join('\n\n');
    delete f._preamble;

    if (!Object.keys(f.attributes).length && record.type !== 'vehicle' && !f.vehicle) {
        warnings.push('No attributes found. Expected a header like "B A R S W L I C ESS" followed by values, or "Body 4, Agility 3 ...".');
    }
    return record;
}

/** A skill named on its own beats the same skill from a group. */
function dedupeSkills(record) {
    const seen = new Map();
    for (const sk of record.skills) {
        const id = `${sk.category}|${sk.key || sk.name.toLowerCase()}`;
        const prev = seen.get(id);
        if (!prev || (prev.fromGroup && !sk.fromGroup)) seen.set(id, sk);
    }
    record.skills = [...seen.values()];
}

function detectActorType(record) {
    const f = record.fields;
    const name = record.name.toLowerCase();
    const attrs = Object.values(f.attributes);
    const relative = attrs.some(a => a.relative !== undefined);
    if (f.vehicle) return 'vehicle';
    if (/\bsprite\b/.test(name) || (relative && (f.attributes.attack || f.attributes.sleaze || f.level !== undefined))) return 'sprite';
    if (/\bic\b|intrusion countermeasure/.test(name) && !f.attributes.body) return 'ic';
    if (/\bspirit\b|elemental|guardian spirit|watcher/.test(name) || (relative && f.force !== undefined) || (relative && !f.attributes.attack)) return 'spirit';
    return 'character';
}

function finalizeByType(record) {
    const f = record.fields;
    // Critters: weaknesses, or creature powers on something with no metatype, professional rating or gear.
    if (record.type === 'character' && !f.critter) {
        const hasGear = record.children.some(c => ['weapon', 'armor', 'equipment', 'device', 'cyberware', 'bioware'].includes(c.type));
        if (f._weaknesses || (f._powers && !f.metatype && f.professionalRating === undefined && !hasGear)) f.critter = true;
    }
    const genericPower = record.type === 'sprite' ? 'sprite_power'
        : record.type === 'character' && !f.critter ? 'adept_power' : 'critter_power';
    for (const c of record.children) if (c.type === '_power') c.type = genericPower;
    delete f._weaknesses; delete f._powers;

    if (record.type === 'spirit') {
        f.spiritType = spiritTypeFromName(record.name);
        if (!f.spiritType) record.warnings.push('Spirit type not recognised from the name; set it on the sheet.');
        if (f.force === undefined) {
            record.warnings.push('Force not found (e.g. "Force 4" in the title). Defaulting to Force 6.');
            f.force = 6;
        }
        // Children listed as "powers" are critter powers for spirits.
        for (const c of record.children) if (c.type === 'adept_power') c.type = 'critter_power';
    } else if (record.type === 'sprite') {
        f.spriteType = spriteTypeFromName(record.name);
        if (f.level === undefined) { f.level = 6; record.warnings.push('Level not found; defaulting to Level 6.'); }
        for (const c of record.children) if (['adept_power', 'critter_power'].includes(c.type)) c.type = 'sprite_power';
    } else if (record.type === 'ic') {
        f.icType = icTypeFromName(record.name);
    } else if (record.type === 'vehicle') {
        f.vehicle ??= {};
        f.vehicle.vehicleType ??= vehicleTypeFromText(record.name);
        f.vehicle.isDrone ??= /drone|\bmct\b|\bgm-nissan doberman|roto-?drone|fly-?spy|dragonfly/i.test(record.name);
    } else {
        if (f.critter) for (const c of record.children) if (c.type === 'adept_power') c.type = 'critter_power';
        const mag = f.attributes.magic?.base ?? 0;
        const res = f.attributes.resonance?.base ?? 0;
        f.special = mag > 0 ? 'magic' : res > 0 ? 'resonance' : 'mundane';
    }
}

/* ------------------------------------------------------------------ */

export function parseInitiative(text) {
    const s = String(text ?? '').replace(/\s+/g, '');
    const m = /(\d+)\+(\d+)D6/i.exec(s);
    if (m) return { base: Number(m[1]), dice: Number(m[2]) };
    const rel = /\(?[FL](?:[x×*](\d+))?\)?([+-]\d+)?\+(\d+)D6/i.exec(s);
    if (rel) return { multiplier: Number(rel[1] ?? 1), constant: Number(rel[2] ?? 0), dice: Number(rel[3]) };
    const dice = /(\d+)D6/i.exec(s);
    if (dice) return { dice: Number(dice[1]) };
    return null;
}

function parseVehicleRow(header, row) {
    // Header: Handl Speed Accel Bod Armor Pilot Sensor Seats [Avail] [Cost]
    const heads = header.trim().split(/\s+/).map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
    const tokens = String(row ?? '').trim().match(/\d+\s*\/\s*\d+|\d+(?:,\d{3})*(?:\.\d+)?\s*¥?|[-–—]|\d+[RF]/gi) ?? [];
    return vehicleFromColumns(heads, tokens);
}

export function vehicleFromColumns(heads, tokens) {
    const v = {};
    const offset = Math.max(0, tokens.length - heads.length);
    heads.forEach((h, i) => {
        const t = tokens[i + offset] ?? tokens[i];
        if (t === undefined) return;
        const pair = /(\d+)\s*\/\s*(\d+)/.exec(t);
        const n = toNumber(t, undefined);
        switch (h) {
            case 'handl': case 'handling': case 'hand':
                v.handling = pair ? Number(pair[1]) : n; if (pair) v.off_road_handling = Number(pair[2]); break;
            case 'speed': case 'spd':
                v.speed = pair ? Number(pair[1]) : n; if (pair) v.off_road_speed = Number(pair[2]); break;
            case 'accel': case 'acc': case 'acceleration':
                v.acceleration = pair ? Number(pair[1]) : n; if (pair) v.off_road_acceleration = Number(pair[2]); break;
            case 'bod': case 'body': v.body = n; break;
            case 'armor': case 'armour': case 'arm': v.armor = n; break;
            case 'pilot': v.pilot = n; break;
            case 'sensor': case 'sens': v.sensor = n; break;
            case 'seats': case 'seat': v.seats = n; break;
            case 'avail': case 'availability': v.avail = /^[-–—]$/.test(t) ? '' : t.trim(); break;
            case 'cost': case 'price': v.cost = n; break;
            default: break;
        }
    });
    return v;
}

function handleSection(record, key, lines, warnings) {
    const f = record.fields;
    const text = joinListLines(lines);
    const list = () => splitList(text).map(x => x.trim()).filter(x => x && !/^(none|-|—)$/i.test(x));
    switch (key) {
        case 'initiative': {
            const init = parseInitiative(text);
            if (init) f.initiative.meatspace = init;
            break;
        }
        case 'astral_initiative': { const init = parseInitiative(text); if (init) f.initiative.astral = init; break; }
        case 'matrix_initiative': { const init = parseInitiative(text); if (init) f.initiative.matrix = init; break; }
        case 'condition': {
            const nums = text.match(/\d+/g)?.map(Number) ?? [];
            const p = /p(?:hysical)?\s*:?\s*(\d+)/i.exec(text);
            const st = /s(?:tun)?\s*:?\s*(\d+)/i.exec(text);
            const m = /m(?:atrix)?\s*:?\s*(\d+)/i.exec(text);
            f.condition = {
                physical: p ? Number(p[1]) : nums[0],
                stun: st ? Number(st[1]) : nums[1],
                matrix: m ? Number(m[1]) : undefined,
            };
            // SR5 grunts are printed with a single combined condition monitor.
            if (nums.length === 1 && f.professionalRating !== undefined && record.type === 'character') f.grunt = true;
            break;
        }
        case 'limits': {
            f.limits = {};
            for (const m of text.matchAll(/(physical|mental|social|astral)\s*:?\s*(\d+)(?:\s*\(\s*(\d+)\s*\))?/gi)) {
                f.limits[m[1].toLowerCase()] = Number(m[3] ?? m[2]);
            }
            break;
        }
        case 'armor': {
            const m = /(\d+)/.exec(text);
            if (m) f.armor = Number(m[1]);
            break;
        }
        case 'skills': {
            const defaultRating = record.type === 'spirit' || f.force !== undefined ? f.force : undefined;
            for (const entry of list()) {
                // Inline knowledge / language markers inside the skills line.
                const s = parseSkillEntry(entry, { defaultRating });
                if (!s) continue;
                if (s.group) {
                    const groupKey = s.name.toLowerCase().replace(/\s+/g, '_');
                    if (SKILL_GROUPS[groupKey]) {
                        for (const sk of SKILL_GROUPS[groupKey]) {
                            const name = sk.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
                            record.skills.push({ name, key: sk, rating: s.rating, specs: [], category: 'active', fromGroup: s.name });
                        }
                        continue;
                    }
                }
                const key = skillKey(s.name);
                if (!key) warnings.push(`Skill "${s.name}" is not a standard active skill; imported as a custom skill.`);
                record.skills.push({ name: s.name, key, rating: s.rating, specs: s.specs, category: 'active', ratingFromForce: s.rating === defaultRating && defaultRating !== undefined && !/\d/.test(entry) });
            }
            break;
        }
        case 'knowledge': {
            for (const entry of list()) {
                const prefix = /^(street|academic|professional|interests?)\s*:\s*/i.exec(entry);
                const s = parseSkillEntry(prefix ? entry.slice(prefix[0].length) : entry);
                if (!s) continue;
                const isLang = s.native || /\(L\)|\blanguage\b/i.test(entry);
                record.skills.push({
                    name: s.name, rating: s.rating ?? 0, specs: s.specs,
                    category: isLang ? 'language' : 'knowledge', native: s.native,
                    knowledgeType: prefix ? prefix[1].toLowerCase().replace(/^interest$/, 'interests') : 'street',
                });
            }
            break;
        }
        case 'languages': {
            for (const entry of list()) {
                const s = parseSkillEntry(entry);
                if (s) record.skills.push({ name: s.name, rating: s.rating ?? 0, specs: s.specs, category: 'language', native: s.native });
            }
            break;
        }
        case 'qualities': {
            for (const entry of list()) {
                const e = parseNamedEntry(entry);
                record.children.push(item('quality', e.name, { rating: e.rating, notes: e.paren && e.rating === undefined ? e.paren : undefined }));
            }
            break;
        }
        case 'augmentations': {
            for (const entry of list()) {
                const e = parseNamedEntry(entry);
                const fields = { rating: e.rating, grade: `${e.paren} ${e.bracket}`, notes: [e.paren, e.bracket].filter(Boolean).join('; ') || undefined };
                if (e.bracket) Object.assign(fields, parseStatTokens(e.bracket), { notes: fields.notes });
                if (fields.damage) delete fields.notes; // a cyber-weapon: its stats go on the item, not in notes
                record.children.push(item(isBioware(e.name) ? 'bioware' : 'cyberware', e.name, fields));
            }
            break;
        }
        case 'weapons': {
            for (const entry of list()) {
                const loose = !entry.includes('[') ? parseLooseRow(entry, 'weapon') : null;
                if (loose?.fields.damage) { record.children.push(item('weapon', loose.name, loose.fields)); continue; }
                const e = parseNamedEntry(entry);
                const stats = e.bracket ? parseStatTokens(e.bracket) : e.paren ? parseStatTokens(e.paren) : {};
                record.children.push(item('weapon', e.name, stats));
            }
            break;
        }
        case 'gear': {
            for (const raw of list()) {
                // "1 dose of cram or jazz (p. 411)": page references go to the source, "N doses of" to quantity.
                let entry = raw;
                const page = /\(\s*(?:p|pg|page)\.?\s*(\d+)\s*\)/i.exec(entry);
                if (page) entry = entry.replace(page[0], ' ').trim();
                const dose = /^(\d+)\s*(?:x\s+|(?:doses?|units?|rounds?|clips?|packs?|pieces?|boxes?)\s+(?:of\s+)?)(.+)$/i.exec(entry);
                if (dose) entry = dose[2];
                const e = parseNamedEntry(entry);
                const type = gearType(e.name, e.bracket);
                const fields = { rating: e.rating };
                if (dose) fields.quantity = Number(dose[1]);
                if (page) fields.source = `p. ${page[1]}`;
                if (type === 'armor') fields.armor = e.bracket || e.rating;
                else if (e.bracket) Object.assign(fields, parseStatTokens(e.bracket));
                if (e.paren && e.rating === undefined) {
                    const q = /(\d+)\s*(?:doses?|rounds?|clips?|uses?|units?|x)\b|^x?\s*(\d+)$/i.exec(e.paren);
                    if (q) fields.quantity = Number(q[1] ?? q[2]);
                    else fields.notes = e.paren;
                }
                if (type === 'weapon' && !fields.damage) Object.assign(fields, { category: 'grenade' });
                record.children.push(item(type, e.name, fields));
            }
            break;
        }
        case 'spells': {
            for (const entry of list()) {
                const e = parseNamedEntry(entry);
                record.children.push(item('spell', e.name, { notes: e.paren || undefined }));
            }
            break;
        }
        case 'adept_powers':
        case 'powers':
        case 'optional_powers':
        case 'weaknesses': {
            // Generic "Powers" are resolved once the actor type is known (see finalizeByType).
            const type = key === 'adept_powers' ? 'adept_power' : key === 'powers' ? '_power' : 'critter_power';
            if (key === 'weaknesses') f._weaknesses = true;
            if (key === 'powers' || key === 'optional_powers') f._powers = true;
            for (const entry of list()) {
                const e = parseNamedEntry(entry);
                record.children.push(item(type, e.name, { rating: e.rating, notes: e.paren && e.rating === undefined ? e.paren : undefined }, {
                    optional: key === 'optional_powers', weakness: key === 'weaknesses',
                }));
            }
            break;
        }
        case 'complex_forms':
            for (const entry of list()) record.children.push(item('complex_form', parseNamedEntry(entry).name));
            break;
        case 'programs':
            for (const entry of list()) {
                const e = parseNamedEntry(entry);
                record.children.push(item('program', e.name, { rating: e.rating }));
            }
            break;
        case 'contacts':
            for (const entry of list()) {
                const e = parseNamedEntry(entry);
                const inner = `${e.paren} ${e.bracket}`;
                const c = /(?:connection|c)\s*:?\s*(\d+)/i.exec(inner);
                const l = /(?:loyalty|l)\s*:?\s*(\d+)/i.exec(inner);
                const slash = /(\d+)\s*\/\s*(\d+)/.exec(inner);
                record.children.push({ ...item('contact', e.name, {
                    connection: c?.[1] ?? slash?.[1], loyalty: l?.[1] ?? slash?.[2],
                }), lookup: false });
            }
            break;
        case 'metamagics':
            for (const entry of list()) record.children.push(item('metamagic', parseNamedEntry(entry).name));
            break;
        case 'echoes':
            for (const entry of list()) record.children.push(item('echo', parseNamedEntry(entry).name));
            break;
        case 'initiate': f.initiation = toNumber(text); break;
        case 'submersion': f.submersion = toNumber(text); break;
        case 'tradition': {
            f.tradition = text;
            const t = text.toLowerCase();
            f.drainAttribute = /hermetic|logic|black magic|chaos|psionic|path of the wheel|christian|zoroastrian/.test(t) ? 'logic'
                : /shaman|charisma|wicca|voodoo|norse|druid|qabbalism|buddhism|hinduism|islam|shinto|aboriginal/.test(t) ? 'charisma'
                : /intuition/.test(t) ? 'intuition' : /willpower/.test(t) ? 'willpower' : undefined;
            const m = /(willpower|logic|charisma|intuition)\s*\+\s*(willpower|logic|charisma|intuition)/i.exec(text);
            if (m) f.drainAttribute = m[1].toLowerCase() === 'willpower' ? m[2].toLowerCase() : m[1].toLowerCase();
            break;
        }
        case 'metatype': {
            const m = /\b(human|elf|ork|orc|dwarf|troll)\b/i.exec(text);
            if (m) f.metatype = METATYPES[m[1].toLowerCase()];
            else f.metavariant = text;
            break;
        }
        case 'force': f.force = toNumber(text); break;
        case 'level': f.level = toNumber(text); break;
        case 'host_rating': f.hostRating = toNumber(text); break;
        case 'rating':
            f.professionalRating = toNumber(text);
            if (record.type === 'ic') f.hostRating = f.professionalRating;
            break;
        case 'essence': f.attributes.essence ??= { base: toNumber(text) }; break;
        case 'movement': f.movement = text; break;
        case 'matrix': {
            const pairs = readAttributePairs(text);
            for (const k of ['attack', 'sleaze', 'data_processing', 'firewall']) if (pairs[k]) f.attributes[k] = pairs[k];
            const dr = /device\s+rating\s*:?\s*(\d+)/i.exec(text) ?? /^(\d+)/.exec(text);
            if (dr) f.deviceRating = Number(dr[1]);
            break;
        }
        case 'vehicle_stats': {
            const pairs = {};
            for (const m of `Handling ${text}`.matchAll(/(handling|handl|speed|accel(?:eration)?|body|bod|armor|pilot|sensor|seats)\s*:?\s*(\d+(?:\s*\/\s*\d+)?)/gi)) {
                pairs[m[1].toLowerCase().replace(/^handl$/, 'handling').replace(/^bod$/, 'body').replace(/^acceleration$/, 'accel')] = m[2];
            }
            f.vehicle = vehicleFromColumns(Object.keys(pairs), Object.values(pairs));
            break;
        }
        case 'notes': f.notes = [f.notes, text].filter(Boolean).join('\n\n'); break;
        case 'lifestyle':
            record.children.push({ ...item('lifestyle', text.replace(/\(.*\)/, '').trim() || 'Lifestyle'), lookup: false });
            break;
        case 'nuyen': f.nuyen = toNumber(text); break;
        case 'karma': f.karma = toNumber(text); break;
        default: break;
    }
}

/** Expose for tests */
export const _internal = { readAttributeTable, readAttributePairs, joinListLines, parseNamedEntry, gearType, weaponProfile };

/** Add a list of entries ("Ares Predator V [Heavy Pistol, ...]") to an actor record as if read from a stat block section. */
export function handleListSection(record, key, entries) {
    handleSection(record, key, [entries.join(', ')], record.warnings);
}

/** Resolve generic powers, critter/spirit/sprite specifics and the magic/resonance flag. */
export function finalizeActorRecord(record) {
    finalizeByType(record);
}
