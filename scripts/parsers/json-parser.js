/**
 * JSON input. Accepts:
 *  - Foundry document exports (Actor/Item "Export Data"), single or arrays, with embedded items
 *  - wrappers: { actors: [...], items: [...] }, { entries: [...] }, { documents: [...] }
 *  - legacy exports that use "data" instead of "system"
 *  - a simplified format: { "type": "weapon", "name": "...", "damage": "8P", "ap": -1, ... }
 *    and actors: { "type": "npc", "name": "...", "attributes": { "body": 4 }, "skills": { "Pistols": 5 }, "weapons": [...] }
 *  - JSON Lines (one object per line)
 *  - { "text": "...stat block..." } entries, which go through the text parser
 */
import { normalizeFields } from './fields.js';
import { resolveType, ITEM_TYPES, ACTOR_TYPES } from './types.js';
import { parseText } from './text-parser.js';
import { handleListSection, parseSkillEntry, finalizeActorRecord } from './statblock.js';
import { skillKey, parseAugmented, tidyName } from './common.js';

export function looksLikeJSON(text) {
    const t = String(text ?? '').trim();
    return /^[[{]/.test(t);
}

export function parseJSON(text, opts = {}) {
    let data;
    const warnings = [];
    try {
        data = JSON.parse(text);
    } catch (err) {
        // JSON Lines fallback.
        const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
        try { data = lines.map(l => JSON.parse(l)); }
        catch { throw new Error(`Invalid JSON: ${err.message}`); }
    }
    const objects = flatten(data);
    const records = [];
    for (const obj of objects) {
        try {
            records.push(...toRecords(obj, opts));
        } catch (err) {
            warnings.push(`Skipped an entry: ${err.message}`);
        }
    }
    for (const r of records) r.source = opts.sourceLabel ?? 'json';
    return { records, skipped: warnings };
}

function flatten(data) {
    if (Array.isArray(data)) return data.flatMap(flatten);
    if (!data || typeof data !== 'object') return [];
    for (const key of ['actors', 'items', 'entries', 'documents', 'results', 'records', 'content']) {
        if (Array.isArray(data[key]) && !data.type && !data.system) {
            const rest = Object.entries(data).filter(([k, v]) => k !== key && Array.isArray(v) && ['actors', 'items', 'entries', 'documents'].includes(k));
            return [...data[key].flatMap(flatten), ...rest.flatMap(([, v]) => v.flatMap(flatten))];
        }
    }
    return [data];
}

const LIST_KEYS = {
    qualities: 'qualities', augmentations: 'augmentations', cyberware: 'augmentations', bioware: 'augmentations', ware: 'augmentations',
    weapons: 'weapons', gear: 'gear', equipment: 'gear', spells: 'spells', powers: 'powers', adept_powers: 'adept_powers',
    adeptpowers: 'adept_powers', critter_powers: 'powers', critterpowers: 'powers', optional_powers: 'optional_powers',
    weaknesses: 'weaknesses', complex_forms: 'complex_forms', complexforms: 'complex_forms', programs: 'programs',
    contacts: 'contacts', metamagics: 'metamagics', echoes: 'echoes',
};

function toRecords(obj, opts) {
    if (!obj || typeof obj !== 'object') return [];

    // Free text inside JSON.
    if (typeof obj.text === 'string' && !obj.system && !obj.data && Object.keys(obj).length <= 3) {
        return parseText(obj.text, { ...opts, forceType: obj.type ?? opts.forceType }).records;
    }

    const system = obj.system ?? (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) ? obj.data : null);
    const typeKey = String(obj.type ?? '').trim();

    // Native Foundry document.
    if (system && (ITEM_TYPES.includes(typeKey) || ACTOR_TYPES.includes(typeKey))) {
        const documentName = ACTOR_TYPES.includes(typeKey) && !ITEM_TYPES.includes(typeKey) ? 'Actor' : 'Item';
        const doc = foundryClean({ ...obj, system });
        delete doc.data;
        return [{
            documentName, type: typeKey, name: obj.name ?? 'Unnamed', data: doc, native: true,
            warnings: obj.data && !obj.system ? ['Legacy export ("data" field) converted to "system"; check fields after import.'] : [],
            raw: '',
        }];
    }

    // Simplified format.
    const resolved = resolveType(obj.type ?? obj.kind ?? obj.category ?? opts.forceType ?? opts.defaultType ?? 'equipment');
    if (!resolved) throw new Error(`Unknown type "${obj.type}" for "${obj.name ?? 'unnamed'}"`);
    if (resolved.documentName === 'Actor') return [looseActor(obj, resolved)];
    const fields = normalizeFields(obj);
    if (resolved.sub && !fields.category) fields.category = resolved.sub;
    delete fields.type;
    if (/^[MP]$|^(mana|physical)$/i.test(String(obj.spellType ?? obj.powerType ?? ''))) fields.type = obj.spellType ?? obj.powerType;
    return [{
        documentName: 'Item', type: resolved.type, name: tidyName(obj.name ?? 'Unnamed'), fields,
        hint: obj.qualityType ? { qualityType: obj.qualityType } : (/negative/i.test(String(obj.type)) ? { qualityType: 'negative' } : {}),
        warnings: [], raw: '',
    }];
}

/** Remove ids, ownership and stats so the document imports as new. */
export function foundryClean(doc) {
    const out = structuredClone(doc);
    for (const k of ['_id', '_key', '_stats', 'folder', 'ownership', 'sort']) delete out[k];
    if (Array.isArray(out.items)) out.items = out.items.map(i => { const c = { ...i }; if (c.data && !c.system) { c.system = c.data; delete c.data; } delete c._key; delete c._stats; return c; });
    if (Array.isArray(out.effects)) out.effects = out.effects.map(e => { const c = { ...e }; delete c._key; delete c._stats; return c; });
    return out;
}

function looseActor(obj, resolved) {
    const record = {
        documentName: 'Actor', type: resolved.type, name: tidyName(obj.name ?? 'Unnamed'),
        fields: { attributes: {}, initiative: {}, npc: resolved.npc ?? true, critter: !!resolved.critter },
        skills: [], children: [], warnings: [], raw: '',
    };
    const f = record.fields;

    for (const [k, v] of Object.entries(obj.attributes ?? {})) {
        const key = k.toLowerCase();
        const s = String(v);
        const rel = /^[FL]\s*([+-]\s*\d+)?$/i.exec(s.replace(/\s+/g, ''));
        if (rel) f.attributes[key] = { relative: Number((rel[1] ?? '0').replace(/\s+/g, '')) };
        else if (typeof v === 'object' && v) f.attributes[key] = { base: Number(v.base ?? v.value ?? 0), augmented: v.augmented ?? v.total };
        else f.attributes[key] = parseAugmented(s);
    }
    for (const k of ['metatype', 'force', 'level', 'armor', 'professionalRating', 'tradition', 'drainAttribute', 'initiation', 'submersion', 'notes', 'description', 'spiritType', 'spriteType', 'icType', 'hostRating', 'nuyen', 'karma', 'img']) {
        if (obj[k] !== undefined) f[k] = obj[k];
    }
    if (obj.description && !f.notes) f.notes = obj.description;
    if (obj.condition) f.condition = obj.condition;
    if (obj.limits) f.limits = obj.limits;
    if (obj.initiative) {
        const init = typeof obj.initiative === 'string' ? obj.initiative : null;
        if (init) {
            const m = /(\d+)\s*\+\s*(\d+)\s*D6/i.exec(init);
            if (m) f.initiative.meatspace = { base: Number(m[1]), dice: Number(m[2]) };
        } else Object.assign(f.initiative, obj.initiative);
    }
    if (obj.vehicle || resolved.type === 'vehicle') f.vehicle = normalizeFields(obj.vehicle ?? obj);
    if (f.vehicle) {
        // normalizeFields maps "accel" → acceleration; vehicle code expects accel.
        if (f.vehicle.acceleration !== undefined) f.vehicle.accel = f.vehicle.acceleration;
    }
    if (obj.grunt || obj.is_grunt) f.grunt = true;

    // Skills: { "Pistols": 5 } or ["Pistols 5"] or [{ name, rating, specs }]
    const skills = obj.skills ?? {};
    const pushSkill = (name, rating, extra = {}) => {
        const category = extra.category ?? 'active';
        record.skills.push({ name, key: category === 'active' ? skillKey(name) : '', rating: Number(rating ?? 0), specs: extra.specs ?? [], category, native: !!extra.native, knowledgeType: extra.knowledgeType ?? 'street' });
    };
    if (Array.isArray(skills)) {
        for (const s of skills) {
            if (typeof s === 'string') { const p = parseSkillEntry(s); if (p) pushSkill(p.name, p.rating, { specs: p.specs }); }
            else if (s?.name) pushSkill(s.name, s.rating ?? s.value, { specs: s.specs ?? s.specializations ?? [], category: s.category, native: s.native, knowledgeType: s.knowledgeType });
        }
    } else {
        for (const [name, v] of Object.entries(skills)) {
            if (typeof v === 'object' && v) pushSkill(name, v.rating ?? v.value, { specs: v.specs ?? [], category: v.category });
            else pushSkill(name, v);
        }
    }
    for (const [key, category] of [['knowledge', 'knowledge'], ['knowledgeSkills', 'knowledge'], ['languages', 'language']]) {
        const list = obj[key];
        if (!list) continue;
        const entries = Array.isArray(list) ? list : Object.entries(list).map(([n, r]) => `${n} ${r}`);
        for (const e of entries) {
            if (typeof e === 'string') { const p = parseSkillEntry(e); if (p) pushSkill(p.name, p.rating, { category, native: p.native }); }
            else if (e?.name) pushSkill(e.name, e.rating, { category, native: e.native, knowledgeType: e.knowledgeType });
        }
    }

    // Lists of items.
    const rawItems = Array.isArray(obj.items) ? obj.items : [];
    for (const [key, section] of Object.entries(LIST_KEYS)) {
        const list = obj[key];
        if (!Array.isArray(list)) continue;
        const strings = list.filter(x => typeof x === 'string');
        if (strings.length) handleListSection(record, section, strings);
        for (const o of list.filter(x => x && typeof x === 'object')) rawItems.push({ ...o, _section: section });
    }
    for (const it of rawItems) {
        if (typeof it === 'string') { handleListSection(record, 'gear', [it]); continue; }
        if (it.system && ITEM_TYPES.includes(it.type)) {
            record.children.push({ documentName: 'Item', type: it.type, name: it.name, data: foundryClean(it), native: true });
            continue;
        }
        const sectionType = { weapons: 'weapon', spells: 'spell', adept_powers: 'adept_power', powers: 'critter_power', complex_forms: 'complex_form', programs: 'program', contacts: 'contact', qualities: 'quality', augmentations: 'cyberware', metamagics: 'metamagic', echoes: 'echo' }[it._section];
        const r = resolveType(it.type ?? sectionType ?? 'equipment');
        const fields = normalizeFields(it);
        delete fields._section;
        delete fields.type;
        record.children.push({ documentName: 'Item', type: r?.documentName === 'Item' ? r.type : 'equipment', name: tidyName(it.name ?? 'Unnamed'), fields, hint: {}, lookup: it.lookup !== false });
    }

    finalizeActorRecord(record);
    if (obj.special && record.type === 'character') f.special = obj.special;
    return record;
}
