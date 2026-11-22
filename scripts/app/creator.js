/**
 * Create Foundry documents from importer entries.
 * Runs in Foundry only (uses game, CONFIG, foundry.*).
 */
import { buildItem } from '../build/item-builder.js';
import { buildActor } from '../build/actor-builder.js';
import { matchKey, skillKey, toNumber, textToHTML, escapeHTML } from '../parsers/common.js';
import { MODULE_ID, log, isV14, hasSkillItems, t } from './compat.js';

/* ------------------------------------------------------------------ */
/* Preview                                                            */
/* ------------------------------------------------------------------ */

let entryCounter = 0;

/**
 * Convert parser records into preview entries with built creation data.
 */
export function buildEntries(records) {
    return records.map(record => buildEntry(record));
}

export function buildEntry(record) {
    const entry = {
        id: `e${++entryCounter}`,
        include: true,
        documentName: record.documentName,
        type: record.type,
        name: record.name,
        source: record.source ?? '',
        raw: record.raw ?? '',
        record,
        warnings: [...(record.warnings ?? [])],
        data: null,
        plan: null,
    };
    try {
        if (record.native) {
            entry.data = foundry.utils.deepClone(record.data);
            entry.data.name = record.name;
            entry.data.type = record.type;
            entry.plan = { skills: [], children: [], reconcile: {} };
        } else if (record.documentName === 'Actor') {
            const { data, plan, warnings } = buildActor(record);
            entry.data = data;
            entry.plan = plan;
            entry.warnings.push(...warnings);
            for (const child of plan.children) child.warnings ??= [];
        } else {
            const fields = { ...(record.fields ?? {}) };
            if (fields.notes) fields.description = [fields.description, fields.notes].filter(Boolean).join('\n\n');
            const { data, warnings } = buildItem({ type: record.type, name: record.name, fields, hint: record.hint ?? {} });
            entry.data = data;
            entry.warnings.push(...warnings);
        }
        validateType(entry);
    } catch (err) {
        entry.include = false;
        entry.error = err.message;
        log.error(err);
    }
    return entry;
}

function validateType(entry) {
    const types = game.system.documentTypes?.[entry.documentName] ?? {};
    if (!(entry.type in types)) {
        entry.include = false;
        entry.error = t('Errors.UnknownType', { type: entry.type, document: entry.documentName });
    }
}

/** Short human summary of key stats for the preview list. */
export function summarize(entry) {
    const s = entry.data?.system ?? {};
    const bits = [];
    if (entry.documentName === 'Actor') {
        const a = s.attributes ?? {};
        const att = ['body', 'agility', 'reaction', 'strength', 'willpower', 'logic', 'intuition', 'charisma', 'magic', 'resonance', 'force', 'level']
            .filter(k => a[k]?.base !== undefined)
            .map(k => `${k.slice(0, 3).toUpperCase()} ${a[k].applies_special ? (a[k].base >= 0 ? '+' : '') : ''}${a[k].base}`);
        if (att.length) bits.push(att.join(' '));
        const plan = entry.plan ?? {};
        if (plan.skills?.length) bits.push(`${plan.skills.length} skills`);
        if (plan.children?.length) bits.push(`${plan.children.length} items`);
        if (entry.data?.items?.length) bits.push(`${entry.data.items.length} items`);
        if (s.vehicle_stats) bits.push(['handling', 'speed', 'pilot', 'sensor'].filter(k => s.vehicle_stats[k]).map(k => `${k} ${s.vehicle_stats[k].base}`).join(', '));
    } else {
        const dmg = s.action?.damage;
        if (s.action?.limit?.base) bits.push(`Acc ${s.action.limit.base}`);
        if (dmg?.base !== undefined) bits.push(`DV ${dmg.attribute ? `(${dmg.attribute.slice(0, 3).toUpperCase()}+${dmg.base})` : dmg.base}${(dmg.type?.base ?? 'p')[0].toUpperCase()}`);
        if (dmg?.ap?.base) bits.push(`AP ${dmg.ap.base}`);
        if (s.armor?.base) bits.push(`Armor ${s.armor.accessory ? '+' : ''}${s.armor.base}`);
        if (s.essence) bits.push(`Ess ${s.essence}`);
        if (s.drain !== undefined && entry.type === 'spell') bits.push(`DV F${s.drain >= 0 ? '+' : ''}${s.drain}`);
        if (s.fade !== undefined) bits.push(`FV L${s.fade >= 0 ? '+' : ''}${s.fade}`);
        if (s.pp) bits.push(`${s.pp} PP`);
        if (s.karma) bits.push(`${s.karma} Karma`);
        if (s.technology?.rating) bits.push(`R${s.technology.rating}`);
        if (entry.type === 'host') {
            if (s.rating !== undefined) bits.push(`Rating ${s.rating}`);
            const at = s.atts ?? {};
            const v = ['att1', 'att2', 'att3', 'att4'].map(k => at[k]?.value);
            if (v.some(x => x !== undefined)) bits.push(`A/S/D/F ${v.map(x => x ?? '-').join('/')}`);
            const ic = entry.record?.fields?.ic;
            if (ic?.length) bits.push(`IC: ${ic.join(', ')}`);
        }
        if (s.technology?.availability) bits.push(`Avail ${s.technology.availability}`);
        if (s.technology?.cost) bits.push(`${s.technology.cost}¥`);
        if (s.category) bits.push(s.category);
    }
    return bits.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Destinations and folders                                           */
/* ------------------------------------------------------------------ */

export function listDestinations(documentName) {
    const out = [{ value: 'world', label: t('Destination.World') }];
    for (const pack of game.packs) {
        if (pack.documentName !== documentName || pack.locked) continue;
        if (pack.metadata.system && pack.metadata.system !== game.system.id) continue;
        out.push({ value: pack.collection, label: `${pack.title} (${pack.collection})` });
    }
    return out;
}

/** Existing folder paths ("NPCs/Gangers") for a document type and destination. */
export function listFolderPaths(documentName, destination) {
    const folders = destination === 'world'
        ? game.folders.filter(f => f.type === documentName)
        : (game.packs.get(destination)?.folders?.contents ?? []);
    const pathOf = f => {
        const parts = [];
        let cur = f;
        while (cur) { parts.unshift(cur.name); cur = cur.folder; }
        return parts.join('/');
    };
    return folders.map(pathOf).sort((a, b) => a.localeCompare(b));
}

async function ensureFolder(path, documentName, destination) {
    const parts = String(path ?? '').split('/').map(p => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    const pack = destination === 'world' ? null : game.packs.get(destination);
    const pool = () => pack ? pack.folders.contents : game.folders.filter(f => f.type === documentName);
    let parent = null;
    for (const name of parts) {
        let folder = pool().find(f => f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null));
        if (!folder) {
            folder = await Folder.implementation.create({ name, type: documentName, folder: parent?.id ?? null, sorting: 'a' }, pack ? { pack: pack.collection } : {});
        }
        parent = folder;
    }
    return parent;
}

/* ------------------------------------------------------------------ */
/* Duplicate detection                                                */
/* ------------------------------------------------------------------ */

async function existingIndex(documentName, destination) {
    const map = new Map();
    if (destination === 'world') {
        const collection = documentName === 'Actor' ? game.actors : game.items;
        for (const doc of collection) map.set(`${doc.type}|${doc.name.toLowerCase()}`, doc.id);
    } else {
        const pack = game.packs.get(destination);
        const index = await pack.getIndex({ fields: ['type'] });
        for (const e of index) map.set(`${e.type}|${e.name.toLowerCase()}`, e._id);
    }
    return map;
}

async function deleteExisting(documentName, destination, id) {
    if (destination === 'world') {
        const collection = documentName === 'Actor' ? game.actors : game.items;
        await collection.get(id)?.delete();
    } else {
        const pack = game.packs.get(destination);
        const doc = await pack.getDocument(id);
        await doc?.delete();
    }
}

/* ------------------------------------------------------------------ */
/* Matching owned items against world items and compendiums          */
/* ------------------------------------------------------------------ */

const TYPE_FAMILIES = {
    cyberware: ['cyberware', 'bioware'], bioware: ['bioware', 'cyberware'],
    critter_power: ['critter_power', 'adept_power', 'sprite_power'], adept_power: ['adept_power', 'critter_power'],
    sprite_power: ['sprite_power', 'critter_power'], equipment: ['equipment', 'device', 'armor', 'ammo', 'program'],
    device: ['device', 'equipment'], armor: ['armor', 'equipment'],
};

export class ItemLibrary {
    constructor() { this.entries = new Map(); this.ready = false; }

    async load({ packs = 'all' } = {}) {
        this.entries.clear();
        const add = (name, type, uuid, priority) => {
            for (const key of keysFor(name)) {
                const k = `${type}|${key}`;
                const cur = this.entries.get(k);
                if (!cur || cur.priority > priority) this.entries.set(k, { uuid, priority, name });
            }
        };
        for (const item of game.items) add(item.name, item.type, item.uuid, 0);
        for (const pack of game.packs) {
            if (pack.documentName !== 'Item') continue;
            if (pack.metadata.system && pack.metadata.system !== game.system.id) continue;
            if (Array.isArray(packs) && !packs.includes(pack.collection)) continue;
            try {
                const index = await pack.getIndex({ fields: ['type'] });
                const priority = pack.metadata.packageType === 'world' ? 1 : pack.metadata.packageType === 'module' ? 2 : 3;
                for (const e of index) add(e.name, e.type, e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, priority);
            } catch (err) {
                log.warn(`Could not index ${pack.collection}`, err);
            }
        }
        this.ready = true;
        return this;
    }

    find(name, type) {
        const types = TYPE_FAMILIES[type] ?? [type];
        for (const ty of types) {
            for (const key of keysFor(name)) {
                const hit = this.entries.get(`${ty}|${key}`);
                if (hit) return { ...hit, type: ty };
            }
        }
        return null;
    }
}

function keysFor(name) {
    const base = matchKey(name);
    const keys = new Set([base]);
    keys.add(base.replace(/\s+\d+$/, ''));                     // "wired reflexes 2" → "wired reflexes"
    keys.add(base.replace(/\brating\s*\d+\b/, '').trim());
    keys.add(base.replace(/s$/, ''));                         // plural forgiveness
    keys.add(String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()); // keep parenthetical text
    return [...keys].filter(Boolean);
}

/** Apply the stat block's rating/quantity to a matched compendium item. */
function applyOverrides(data, child) {
    const f = child.fields ?? {};
    const sys = data.system ?? (data.system = {});
    const rating = f.rating !== undefined && f.rating !== '' ? toNumber(f.rating, undefined) : undefined;
    if (rating !== undefined) {
        if (sys.technology) sys.technology.rating = rating;
        if (data.type === 'adept_power') sys.level = rating;
        if (['quality', 'critter_power'].includes(data.type)) sys.rating = rating;
    }
    if (f.quantity !== undefined && sys.technology) sys.technology.quantity = toNumber(f.quantity, 1);
    if (sys.technology && ['weapon', 'armor', 'cyberware', 'bioware', 'device', 'equipment', 'ammo', 'program'].includes(data.type)) sys.technology.equipped = true;
    if (['cyberware', 'bioware'].includes(data.type) && f.grade) {
        const g = /alpha|beta|delta|gamma|used|grey/i.exec(f.grade);
        if (g) sys.grade = g[0].toLowerCase();
    }
    if (f.notes) {
        sys.description ??= {};
        sys.description.value = `${sys.description.value ?? ''}<p><em>${escapeHTML(f.notes)}</em></p>`;
    }
}

async function resolveChild(child, { library, matchItems }) {
    if (child.native) return { data: foundry.utils.deepClone(child.data), matched: false };
    if (matchItems && child.lookup !== false && library) {
        const hit = library.find(child.name, child.type);
        if (hit) {
            const doc = await fromUuid(hit.uuid);
            if (doc) {
                const data = doc.toObject();
                delete data._id;
                delete data.folder;
                delete data.sort;
                if (child.name && !/\d/.test(data.name) && /\(|\d/.test(child.name) && hit.name !== child.name) data.name = child.name;
                foundry.utils.setProperty(data, '_stats.compendiumSource', hit.uuid);
                applyOverrides(data, child);
                return { data, matched: hit.uuid };
            }
        }
    }
    const fields = { ...(child.fields ?? {}) };
    if (fields.notes) fields.description = fields.notes;
    const nameOnly = !Object.values(fields).some(v => v !== undefined && v !== null && String(v).trim() !== '');
    const { data, warnings } = buildItem({ type: child.type, name: child.name, fields, hint: child.hint ?? {}, owned: true });
    return { data, matched: false, nameOnly, warnings: nameOnly ? [] : warnings };
}

/* ------------------------------------------------------------------ */
/* Import                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {object[]} entries preview entries
 * @param {object} options
 * @param {string} options.actorDestination  'world' or pack collection id
 * @param {string} options.itemDestination
 * @param {string} options.actorFolder       folder path
 * @param {string} options.itemFolder
 * @param {'skip'|'replace'|'copy'} options.duplicates
 * @param {boolean} options.matchItems       copy owned items from world/compendiums by name
 * @param {boolean} options.reconcile        match printed totals (augmented attributes, initiative, armor, monitors, limits)
 * @param {(progress: {done:number,total:number,name:string}) => void} [options.onProgress]
 */
export async function importEntries(entries, options) {
    const todo = entries.filter(e => e.include && !e.error && e.data);
    const summary = { created: [], replaced: [], skipped: [], failed: [], matched: 0, built: 0 };
    if (!todo.length) return summary;

    const library = options.matchItems && todo.some(e => e.documentName === 'Actor') ? await new ItemLibrary().load() : null;
    const indexes = {
        Actor: await existingIndex('Actor', options.actorDestination),
        Item: await existingIndex('Item', options.itemDestination),
    };
    const folders = {
        Actor: todo.some(e => e.documentName === 'Actor') ? await ensureFolder(options.actorFolder, 'Actor', options.actorDestination) : null,
        Item: todo.some(e => e.documentName === 'Item') ? await ensureFolder(options.itemFolder, 'Item', options.itemDestination) : null,
    };

    let done = 0;
    const total = todo.length;
    const itemBatch = [];

    const flushItems = async () => {
        if (!itemBatch.length) return;
        const destination = options.itemDestination;
        const batch = itemBatch.splice(0);
        try {
            const created = await Item.implementation.createDocuments(batch.map(b => b.data), destination === 'world' ? {} : { pack: destination });
            created.forEach((doc, i) => summary[batch[i].replaced ? 'replaced' : 'created'].push({ name: doc.name, uuid: doc.uuid, type: doc.type }));
        } catch (err) {
            log.error(err);
            for (const b of batch) summary.failed.push({ name: b.data.name, error: err.message });
        }
    };

    for (const entry of todo) {
        const destination = entry.documentName === 'Actor' ? options.actorDestination : options.itemDestination;
        const index = indexes[entry.documentName];
        const key = `${entry.data.type}|${String(entry.data.name).toLowerCase()}`;
        let replaced = false;
        options.onProgress?.({ done, total, name: entry.data.name });

        if (index.has(key)) {
            if (options.duplicates === 'skip') { summary.skipped.push({ name: entry.data.name, type: entry.data.type }); done++; continue; }
            if (options.duplicates === 'replace') {
                await deleteExisting(entry.documentName, destination, index.get(key));
                replaced = true;
            } else if (options.duplicates === 'copy') {
                entry.data.name = uniqueName(entry.data.name, entry.data.type, index);
            }
        }

        const data = foundry.utils.deepClone(entry.data);
        data.folder = folders[entry.documentName]?.id ?? null;
        foundry.utils.setProperty(data, `flags.${MODULE_ID}.imported`, { source: entry.source, at: Date.now() });

        if (entry.documentName === 'Item') {
            itemBatch.push({ data, replaced });
            if (itemBatch.length >= 50) await flushItems();
            index.set(key, 'pending');
        } else {
            try {
                const result = await createActor(data, entry, { ...options, library, destination });
                summary[replaced ? 'replaced' : 'created'].push({ name: result.actor.name, uuid: result.actor.uuid, type: result.actor.type, warnings: result.warnings });
                summary.matched += result.matched;
                summary.built += result.built;
                if (result.warnings.length) entry.warnings.push(...result.warnings);
                index.set(key, result.actor.id);
            } catch (err) {
                log.error(err);
                summary.failed.push({ name: data.name, error: err.message });
            }
        }
        done++;
    }
    await flushItems();
    options.onProgress?.({ done: total, total, name: '' });
    return summary;
}

function uniqueName(name, type, index) {
    let n = 2;
    while (index.has(`${type}|${`${name} (${n})`.toLowerCase()}`)) n++;
    return `${name} (${n})`;
}

async function createActor(data, entry, options) {
    const warnings = [];
    let matched = 0;
    let built = 0;
    const plan = entry.plan ?? { skills: [], children: [], reconcile: {} };

    // Owned items.
    const items = Array.isArray(data.items) ? [...data.items] : [];
    const nameOnly = [];
    for (const child of plan.children ?? []) {
        try {
            const res = await resolveChild(child, { library: options.library, matchItems: options.matchItems });
            if (res.matched) matched++; else built++;
            if (res.nameOnly) nameOnly.push(child.name);
            if (res.warnings?.length) warnings.push(...res.warnings.map(w => `${child.name}: ${w}`));
            if (game.system.documentTypes.Item?.[res.data.type] === undefined) {
                warnings.push(t('Errors.ChildTypeUnknown', { name: child.name, type: res.data.type }));
                continue;
            }
            items.push(res.data);
        } catch (err) {
            warnings.push(`${child.name}: ${err.message}`);
        }
    }

    if (nameOnly.length) warnings.push(t('Warnings.NameOnly', { names: nameOnly.join(', ') }));

    // Printed armor with no armor item → add one so the sheet shows it.
    const armorTotal = plan.reconcile?.armor;
    if (options.reconcile && armorTotal && data.type === 'character' && !items.some(i => (i.system?.armor?.base ?? i.system?.armor?.value ?? 0) > 0 && !i.system?.armor?.accessory)) {
        items.push({ name: t('Defaults.ArmorItem'), type: 'armor', system: { armor: { base: armorTotal, value: armorTotal }, technology: { equipped: true } } });
    }
    data.items = items;

    const pack = options.destination === 'world' ? null : options.destination;
    const actor = await Actor.implementation.create(data, pack ? { pack } : {});
    if (!actor) throw new Error(t('Errors.CreateFailed'));

    if (plan.skills?.length) {
        try { await applySkills(actor, plan.skills, warnings); }
        catch (err) { log.error(err); warnings.push(`Skills: ${err.message}`); }
    }
    if (options.reconcile && plan.reconcile && Object.keys(plan.reconcile).length) {
        try { await reconcileActor(actor, plan.reconcile, warnings); }
        catch (err) { log.error(err); warnings.push(`Reconcile: ${err.message}`); }
    }
    return { actor, matched, built, warnings };
}

/* ------------------------------------------------------------------ */
/* Skills                                                             */
/* ------------------------------------------------------------------ */

const KNOWLEDGE_ATTRIBUTE = { academic: 'logic', professional: 'logic', street: 'intuition', interests: 'intuition' };

let skillPackCache = null;
async function skillPackIndex() {
    if (skillPackCache) return skillPackCache;
    skillPackCache = new Map();
    const pack = game.packs.get(`${game.system.id}.sr5e-skills`) ?? game.packs.find(p => p.documentName === 'Item' && /skills?$/i.test(p.metadata.name) && p.metadata.packageName === game.system.id);
    if (pack) {
        const index = await pack.getIndex({ fields: ['type', 'system.type'] });
        for (const e of index) skillPackCache.set(e.name.toLowerCase(), e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`);
    }
    return skillPackCache;
}

async function applySkills(actor, skills, warnings) {
    if (!hasSkillItems()) return applyLegacySkills(actor, skills, warnings);

    const updates = [];
    const creates = [];
    const ownedSkills = actor.items.filter(i => i.type === 'skill' && (i.system?.type ?? 'skill') === 'skill');
    const findOwned = (s) => ownedSkills.find(i => {
        if (i.name.toLowerCase() === s.name.toLowerCase()) return true;
        const cat = i.system?.skill?.category ?? 'active';
        if (s.category !== cat) return false;
        return s.category === 'active' && (s.key || skillKey(s.name)) && skillKey(i.name) === (s.key || skillKey(s.name));
    });
    const packIndex = await skillPackIndex();

    for (const s of skills) {
        const rating = toNumber(s.rating, 0);
        const specs = (s.specs ?? []).map(name => ({ name }));
        const owned = findOwned(s);
        if (owned) {
            const existingSpecs = owned.system.skill?.specializations ?? [];
            const merged = [...existingSpecs, ...specs.filter(sp => !existingSpecs.some(e => e.name === sp.name))];
            updates.push({ _id: owned.id, 'system.skill.rating': rating, 'system.skill.specializations': merged, ...(s.native ? { 'system.skill.language.isNative': true } : {}) });
            continue;
        }
        let data = null;
        const packUuid = s.category === 'active' ? packIndex.get(s.name.toLowerCase()) ?? findPackByKey(packIndex, s) : null;
        if (packUuid) {
            const doc = await fromUuid(packUuid);
            if (doc) { data = doc.toObject(); delete data._id; foundry.utils.setProperty(data, '_stats.compendiumSource', packUuid); }
        }
        if (!data) {
            const knowledgeType = s.knowledgeType ?? 'street';
            data = {
                name: s.name,
                type: 'skill',
                system: {
                    type: 'skill',
                    skill: {
                        category: s.category,
                        attribute: s.category === 'knowledge' ? KNOWLEDGE_ATTRIBUTE[knowledgeType] ?? 'intuition' : s.category === 'language' ? 'intuition' : '',
                        knowledgeType,
                        defaulting: false,
                        language: { isNative: !!s.native },
                    },
                },
            };
            if (s.category === 'active') warnings.push(t('Warnings.CustomSkill', { name: s.name }));
        }
        foundry.utils.setProperty(data, 'system.skill.rating', rating);
        foundry.utils.setProperty(data, 'system.skill.specializations', specs);
        if (s.native) foundry.utils.setProperty(data, 'system.skill.language.isNative', true);
        creates.push(data);
    }
    if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
    if (creates.length) await actor.createEmbeddedDocuments('Item', creates);
}

function findPackByKey(packIndex, s) {
    const key = s.key || skillKey(s.name);
    if (!key) return null;
    for (const [name, uuid] of packIndex) if (skillKey(name) === key) return uuid;
    return null;
}

/** Older SR5 system versions (skills stored on the actor instead of as items). */
async function applyLegacySkills(actor, skills, warnings) {
    const update = {};
    const rid = () => foundry.utils.randomID(16);
    for (const s of skills) {
        const rating = toNumber(s.rating, 0);
        if (s.category === 'active') {
            const key = s.key || skillKey(s.name);
            if (!key || !foundry.utils.hasProperty(actor.system, `skills.active.${key}`)) {
                warnings.push(t('Warnings.LegacySkillMissing', { name: s.name }));
                continue;
            }
            update[`system.skills.active.${key}.base`] = rating;
            if (s.specs?.length) update[`system.skills.active.${key}.specs`] = s.specs;
        } else if (s.category === 'language') {
            update[`system.skills.language.value.${rid()}`] = { name: s.name, base: rating, specs: s.specs ?? [], isNative: !!s.native };
        } else {
            const kt = s.knowledgeType ?? 'street';
            update[`system.skills.knowledge.${kt}.value.${rid()}`] = { name: s.name, base: rating, specs: s.specs ?? [] };
        }
    }
    if (Object.keys(update).length) await actor.update(update);
}

/* ------------------------------------------------------------------ */
/* Reconcile derived values with the printed stat block              */
/* ------------------------------------------------------------------ */

async function reconcileActor(actor, reconcile, warnings) {
    const sys = () => actor.system;

    // 1. Augmented attributes ("REA 4(5)") → one Active Effect with the differences.
    if (reconcile.attributes) {
        const changes = [];
        for (const [key, target] of Object.entries(reconcile.attributes)) {
            const current = sys().attributes?.[key]?.value;
            if (current === undefined) continue;
            const diff = Number(target) - Number(current);
            if (diff) changes.push({ key: `system.attributes.${key}.value`, value: String(diff) });
        }
        if (changes.length) await actor.createEmbeddedDocuments('ActiveEffect', [effectData(t('Defaults.AugmentEffect'), changes)]);
    }

    // 2. Initiative, condition monitors, limits and armor via base/modifier fields.
    const update = {};
    for (const [mode, target] of Object.entries(reconcile.initiative ?? {})) {
        const init = sys().initiative?.[mode];
        if (!init) continue;
        if (target.base !== undefined && init.constant) {
            const diff = target.base - (init.constant.value ?? 0);
            if (diff) update[`system.initiative.${mode}.constant.base`] = (init.constant.base ?? 0) + diff;
        }
        if (target.dice !== undefined && init.dice) {
            const diff = target.dice - (init.dice.value ?? init.dice.base ?? 0);
            if (diff) update[`system.initiative.${mode}.dice.base`] = (init.dice.base ?? 0) + diff;
        }
    }
    const mods = sys().modifiers ?? {};
    const track = sys().track ?? {};
    const cond = reconcile.condition ?? {};
    const trackFix = (name, target) => {
        if (target === undefined || !track[name] || !(`${name}_track` in mods)) return;
        const diff = Number(target) - Number(track[name].max ?? 0);
        if (diff) update[`system.modifiers.${name}_track`] = (mods[`${name}_track`] ?? 0) + diff;
    };
    if (!sys().npc?.is_grunt) { trackFix('physical', cond.physical); trackFix('stun', cond.stun); }
    else trackFix('physical', cond.physical);

    for (const [limit, target] of Object.entries(reconcile.limits ?? {})) {
        const current = sys().limits?.[limit]?.value;
        if (current === undefined || !(`${limit}_limit` in mods)) continue;
        const diff = Number(target) - Number(current);
        if (diff) update[`system.modifiers.${limit}_limit`] = (mods[`${limit}_limit`] ?? 0) + diff;
    }
    if (reconcile.armor !== undefined && sys().armor?.rating && 'armor' in mods) {
        const diff = Number(reconcile.armor) - Number(sys().armor.rating.value ?? 0);
        if (diff) {
            update['system.modifiers.armor'] = (mods.armor ?? 0) + diff;
            warnings.push(t('Warnings.ArmorAdjusted', { diff: diff > 0 ? `+${diff}` : diff }));
        }
    }
    if (Object.keys(update).length) await actor.update(update);
}

function effectData(name, changes) {
    if (isV14()) {
        return { name, img: 'icons/svg/upgrade.svg', system: { changes: changes.map(c => ({ ...c, type: 'add' })) }, flags: { [MODULE_ID]: { reconcile: true } } };
    }
    return { name, img: 'icons/svg/upgrade.svg', changes: changes.map(c => ({ ...c, mode: CONST.ACTIVE_EFFECT_MODES.ADD })), flags: { [MODULE_ID]: { reconcile: true } } };
}

export { textToHTML };
