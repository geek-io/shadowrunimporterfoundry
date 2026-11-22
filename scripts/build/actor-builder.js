/**
 * Build SR5 actor creation data from a parsed actor record.
 *
 * Returns the creation data plus a "plan" of work that needs the created actor
 * (skills, owned items, and reconciling derived values with the printed stat block).
 */
import { escapeHTML, textToHTML, toNumber } from '../parsers/common.js';

const CORE = ['body', 'agility', 'reaction', 'strength', 'willpower', 'logic', 'intuition', 'charisma', 'edge', 'magic', 'resonance'];
const MATRIX = ['attack', 'sleaze', 'data_processing', 'firewall'];

/**
 * @param {object} record  actor record from the parsers
 * @param {object} [opts]
 */
export function buildActor(record, opts = {}) {
    const f = record.fields ?? {};
    const system = {};
    const warnings = [];
    const plan = { skills: record.skills ?? [], children: record.children ?? [], reconcile: {} };

    switch (record.type) {
        case 'spirit': buildSpirit(system, f, plan, warnings); break;
        case 'sprite': buildSprite(system, f, plan, warnings); break;
        case 'vehicle': buildVehicle(system, f, plan, warnings); break;
        case 'ic': buildIC(system, f, plan, warnings); break;
        default: buildCharacter(system, f, plan, warnings); break;
    }

    // Biography / notes.
    const parts = [];
    if (f.description) parts.push(textToHTML(f.description));
    if (f.notes && f.notes !== f.description) parts.push(textToHTML(f.notes));
    const facts = [];
    if (f.professionalRating !== undefined) facts.push(`Professional Rating ${f.professionalRating}`);
    if (f.groupSize > 1) facts.push(`Group of ${f.groupSize}`);
    if (f.tradition) facts.push(`Tradition: ${escapeHTML(f.tradition)}`);
    if (f.metavariant) facts.push(`Metavariant: ${escapeHTML(f.metavariant)}`);
    if (f.movement) facts.push(`Movement: ${escapeHTML(f.movement)}`);
    if (facts.length) parts.unshift(`<p>${facts.join(' · ')}</p>`);
    if (parts.length) system.description = { value: parts.join('\n') };

    const data = { name: record.name || 'Unnamed', type: record.type, system, items: [] };
    if (f.img) data.img = f.img;
    return { data, plan, warnings };
}

/* ------------------------------------------------------------------ */

function setBase(attrs, key, value) {
    if (value === undefined || value === null || Number.isNaN(value)) return;
    attrs[key] = { ...(attrs[key] ?? {}), base: value };
}

function buildCharacter(system, f, plan, warnings) {
    system.is_npc = f.npc !== false;
    if (f.grunt) system.npc = { is_grunt: true };
    if (f.critter) system.is_critter = true;
    if (f.metatype) system.metatype = f.metatype;
    if (f.special) system.special = f.special;

    const attrs = {};
    const augmented = {};
    for (const key of [...CORE, ...MATRIX]) {
        const a = f.attributes?.[key];
        if (!a) continue;
        if (a.relative !== undefined || a.half) { warnings.push(`Attribute ${key} is relative (F/L based) on a character; ignored.`); continue; }
        setBase(attrs, key, a.base);
        if (a.augmented !== undefined && a.augmented !== a.base) augmented[key] = a.augmented;
    }
    if (Object.keys(attrs).length) system.attributes = attrs;
    // Essence is worked out from ware; the printed value is matched after creation.
    const ess = f.attributes?.essence;
    if (ess?.base !== undefined && ess.base < 6) augmented.essence = ess.augmented ?? ess.base;
    if (Object.keys(augmented).length) plan.reconcile.attributes = augmented;

    if (f.drainAttribute || f.initiation !== undefined) {
        system.magic = {};
        if (f.drainAttribute) system.magic.attribute = f.drainAttribute;
        if (f.initiation !== undefined) system.magic.initiation = toNumber(f.initiation);
        if (f.initiation) setBase(attrs, 'initiation', toNumber(f.initiation));
    }
    if (f.submersion !== undefined) {
        system.technomancer = { submersion: toNumber(f.submersion) };
        setBase(attrs, 'submersion', toNumber(f.submersion));
        system.attributes = attrs;
    }
    if (f.nuyen !== undefined) system.nuyen = toNumber(f.nuyen);
    if (f.karma !== undefined) system.karma = { value: toNumber(f.karma), max: toNumber(f.karma) };

    initiative(system, f, plan, { meatspace: true, astral: true, matrix: true });
    if (f.armor !== undefined) plan.reconcile.armor = toNumber(f.armor);
    if (f.condition) plan.reconcile.condition = f.condition;
    if (f.limits) plan.reconcile.limits = f.limits;
}

/**
 * Initiative is derived from attributes, so the printed total and dice are matched after creation
 * by adjusting the constant and dice bases (see creator.reconcileActor).
 */
function initiative(system, f, plan, modes) {
    for (const mode of ['meatspace', 'astral', 'matrix']) {
        const i = f.initiative?.[mode];
        if (!i || !modes[mode]) continue;
        const entry = {};
        if (i.base !== undefined) entry.base = i.base;
        if (i.dice !== undefined) entry.dice = i.dice;
        if (Object.keys(entry).length) (plan.reconcile.initiative ??= {})[mode] = entry;
    }
    void system;
}

function buildSpirit(system, f, plan, warnings) {
    system.is_npc = true;
    if (f.spiritType) system.spiritType = f.spiritType;
    const force = toNumber(f.force, 6);
    const attrs = { force: { base: force } };
    for (const key of CORE) {
        const a = f.attributes?.[key];
        if (!a) continue;
        if (a.relative !== undefined) attrs[key] = { base: a.relative, applies_special: true };
        else if (a.half) attrs[key] = { base: Math.floor(force / 2), applies_special: false };
        else if (a.base !== undefined) {
            attrs[key] = { base: a.base, applies_special: false };
            // Printed "9(11)": the augmented value is matched after creation, as for characters.
            if (a.augmented !== undefined && a.augmented !== a.base) (plan.reconcile.attributes ??= {})[key] = a.augmented;
        }
    }
    if (f.bound) system.bound = true;
    if (f.services !== undefined) system.services = toNumber(f.services);
    if (f.attributes?.essence?.relative !== undefined) attrs.essence = { base: f.attributes.essence.relative, applies_special: true };
    system.attributes = attrs;
    if (f.drainAttribute) system.magic = { attribute: f.drainAttribute };
    initiative(system, f, plan, { meatspace: true, astral: true });
    // Spirit skills printed without numbers equal Force.
    for (const s of plan.skills) if (s.rating === undefined) s.rating = force;
    if (f.armor !== undefined) plan.reconcile.armor = toNumber(f.armor);
    void warnings;
}

function buildSprite(system, f, plan, warnings) {
    if (f.spriteType) system.spriteType = f.spriteType;
    const level = toNumber(f.level, 6);
    const attrs = { level: { base: level } };
    const matrix = {};
    for (const key of [...CORE, ...MATRIX]) {
        const a = f.attributes?.[key];
        if (!a) continue;
        const target = MATRIX.includes(key) ? matrix : attrs;
        if (a.relative !== undefined) target[key] = { base: a.relative, applies_special: true };
        else if (a.base !== undefined) target[key] = { base: a.base, applies_special: false };
    }
    system.attributes = attrs;
    if (Object.keys(matrix).length) system.matrix = matrix;
    initiative(system, f, plan, { matrix: true });
    for (const s of plan.skills) if (s.rating === undefined) s.rating = level;
    void warnings;
}

function buildVehicle(system, f, plan, warnings) {
    const v = f.vehicle ?? {};
    system.vehicleType = v.vehicleType ?? 'ground';
    system.isDrone = !!v.isDrone;
    if (v.avail) system.availability = String(v.avail);
    if (v.cost !== undefined) system.cost = toNumber(v.cost);
    const stats = {};
    const statKeys = ['pilot', 'handling', 'off_road_handling', 'speed', 'off_road_speed', 'acceleration', 'off_road_acceleration', 'sensor', 'seats'];
    for (const k of statKeys) {
        const val = v[k] ?? (k === 'acceleration' ? v.accel : undefined);
        if (val !== undefined && val !== null && !Number.isNaN(Number(val))) stats[k] = { base: toNumber(val) };
    }
    if (Object.keys(stats).length) system.vehicle_stats = stats;
    if (v.body !== undefined) system.attributes = { body: { base: toNumber(v.body) } };
    if (v.armor !== undefined) system.armor = { rating: { base: toNumber(v.armor) } };
    if (v.off_road_handling !== undefined || v.off_road_speed !== undefined) system.isOffRoad = false;
    if (!Object.keys(stats).length) warnings.push('No vehicle stats found (Handling, Speed, Accel, Body, Armor, Pilot, Sensor).');
}

function buildIC(system, f, plan, warnings) {
    if (f.icType) system.icType = f.icType;
    if (f.hostRating !== undefined) system.host = { rating: toNumber(f.hostRating) };
    initiative(system, f, plan, { matrix: true });
    void warnings;
}
