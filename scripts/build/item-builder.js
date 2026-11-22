/**
 * Build SR5 system item data from loose, canonical fields.
 *
 * Only the fields we know are written; the system's DataModels fill every other
 * field with its default when the document is created.
 */
import {
    parseAugmented, parseDamage, parseAP, parseModes, parseAmmo, parseAvail, parseCost, toNumber,
    textToHTML, skillKey, extractRating, escapeHTML,
} from '../parsers/common.js';
import { weaponProfile, wareGrade, isBioware } from '../parsers/types.js';

const has = v => v !== undefined && v !== null && String(v).trim() !== '' && !/^[-–—]+$/.test(String(v).trim());

/**
 * @param {object} args
 * @param {string} args.type      system item type
 * @param {string} args.name
 * @param {object} args.fields    canonical loose fields
 * @param {object} [args.hint]    context from headings (category, qualityType, ...)
 * @param {boolean} [args.owned]  item belongs to an imported actor (equip it, prefer augmented values)
 */
export function buildItem({ type, name, fields = {}, hint = {}, owned = false }) {
    const warnings = [];
    const system = {};
    const f = fields;

    // Description: a labeled stat line for what was parsed, then any description prose. The pasted source text is never copied in.
    const description = {};
    // Weapons and hosts show every parsed stat in their own sheet fields, so they get no stat line.
    const statLine = type === 'weapon' || type === 'host' ? '' : describeFields(name, f, type);
    const parts = [];
    if (statLine) parts.push(`<p>${escapeHTML(statLine)}</p>`);
    // Hosts: Installed IC, Slaved Devices, Sculpting, Security Procedures, Pay Data... as printed.
    if (type === 'host' && Array.isArray(f.sections)) {
        for (const sec of f.sections) {
            if (!has(sec.text) || /^(host\s+)?rating$/i.test(sec.label ?? '')) continue;
            parts.push(sec.label ? `<p><strong>${escapeHTML(sec.label)}:</strong> ${escapeHTML(sec.text)}</p>` : textToHTML(sec.text));
        }
    }
    if (has(f.description)) parts.push(textToHTML(f.description));
    if (parts.length) description.value = parts.join('');
    if (has(f.source)) description.source = String(f.source).trim();
    if (Object.keys(description).length) system.description = description;

    const builder = BUILDERS[type];
    if (builder) builder({ system, f, hint, owned, warnings, name });
    else warnings.push(`No field mapping for item type "${type}"; only name and description are imported.`);

    const out = { name, type, system };
    if (has(f.img)) out.img = String(f.img);
    return { data: out, warnings };
}

/* ------------------------------------------------------------------ */

const DESCRIBE = [
    ['category', 'Category'], ['accuracy', 'Accuracy'], ['reach', 'Reach'], ['damage', 'Damage'], ['ap', 'AP'],
    ['mode', 'Mode'], ['rc', 'RC'], ['ammo', 'Ammo'], ['blast', 'Blast'], ['armor', 'Armor'], ['rating', 'Rating'],
    ['essence', 'Essence'], ['capacity', 'Capacity'], ['attack', 'Attack'], ['sleaze', 'Sleaze'],
    ['data_processing', 'Data Processing'], ['firewall', 'Firewall'], ['attributearray', 'Attribute Array'],
    ['programs', 'Programs'], ['target', 'Target'], ['range', 'Range'], ['duration', 'Duration'], ['drain', 'DV'],
    ['fade', 'FV'], ['pp', 'Power Points'], ['activation', 'Activation'], ['karma', 'Karma'],
    ['connection', 'Connection'], ['loyalty', 'Loyalty'], ['quantity', 'Quantity'], ['grade', 'Grade'],
    ['avail', 'Avail'], ['cost', 'Cost'],
];

/** "Name: Combat axe, Accuracy: 4, Reach: 2, Damage: (STR + 5)P, AP: -4, Avail: 12R, Cost: 4,000¥" */
export function describeFields(name, f = {}, type = '') {
    const bits = [];
    // Spell and critter power "Type: M/P" is meaningful; for other types the type chose the document.
    if (/^(spell|ritual|critter_power)$/.test(type) && has(f.type)) bits.push(`Type: ${f.type}`);
    for (const [key, label] of DESCRIBE) {
        if (!has(f[key])) continue;
        if (key === 'grade' && !/alpha|beta|delta|gamma|used|grey/i.test(f.grade)) continue;
        let v = String(f[key]).replace(/\s+/g, ' ').trim();
        if (key === 'damage') v = v.replace(/\(\s*(STR|BOD|MAG|F)\s*([+\-x×*\/])\s*(\d+)\s*\)/gi, (m, a, op, n) => `(${a.toUpperCase()} ${op} ${n})`);
        if (key === 'category') v = v.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
        bits.push(`${label}: ${v}`);
    }
    if (has(f.descriptors) && /^(spell|ritual)$/.test(type)) bits.push(`Descriptors: ${f.descriptors}`);
    if (!bits.length) return '';
    return [`Name: ${name}`, ...bits].join(', ');
}

function technology(system, f, { owned, defaultRating } = {}) {
    const tech = {};
    const rating = has(f.rating) ? toNumber(f.rating, undefined) : defaultRating;
    if (rating !== undefined && !Number.isNaN(rating)) tech.rating = rating;
    if (has(f.avail)) tech.availability = parseAvail(f.avail);
    if (has(f.cost)) tech.cost = parseCost(f.cost);
    if (has(f.quantity)) tech.quantity = Math.max(0, Math.round(toNumber(f.quantity, 1)));
    if (has(f.conceal)) tech.conceal = { base: toNumber(f.conceal) };
    if (owned) tech.equipped = true;
    if (Object.keys(tech).length) system.technology = { ...(system.technology ?? {}), ...tech };
}

function deviceAttributes(system, f) {
    const atts = {};
    if (has(f.attributearray)) {
        const nums = String(f.attributearray).match(/\d+/g)?.map(Number) ?? [];
        ['att1', 'att2', 'att3', 'att4'].forEach((k, i) => { if (nums[i] !== undefined) atts[k] = { value: nums[i] }; });
    }
    const map = { attack: 'att1', sleaze: 'att2', data_processing: 'att3', firewall: 'att4' };
    const attName = { att1: 'attack', att2: 'sleaze', att3: 'data_processing', att4: 'firewall' };
    for (const [field, att] of Object.entries(map)) if (has(f[field])) atts[att] = { value: toNumber(f[field]) };
    for (const k of Object.keys(atts)) atts[k].att = attName[k];
    if (Object.keys(atts).length) system.atts = atts;
}

function armorPart(system, value, { accessory } = {}) {
    const n = toNumber(String(value).replace(/^\[|\]$/g, ''));
    system.armor = { base: n, value: n, accessory: !!accessory };
}

function setActionDamage(system, dmg, apValue) {
    system.action ??= {};
    system.action.damage = {
        base: dmg.damage,
        value: dmg.damage,
        type: { base: dmg.type || 'physical', value: dmg.type || 'physical' },
        element: { base: dmg.element || '', value: dmg.element || '' },
        attribute: dmg.attribute && dmg.attribute !== 'force' ? dmg.attribute : '',
        base_formula_operator: dmg.operator,
    };
    if (apValue !== undefined) system.action.damage.ap = { base: apValue, value: apValue };
}

/* ------------------------------------------------------------------ */

const BUILDERS = {
    weapon({ system, f, owned, warnings, name }) {
        const categoryText = [f.category, f.subcategory, name].filter(has).join(' ');
        const profile = weaponProfile(f.category) ?? weaponProfile(f.subcategory) ?? weaponProfile(name)
            ?? (has(f.reach) ? { category: 'melee', skill: 'blades' } : null)
            ?? (has(f.blast) ? { category: 'thrown', skill: 'throwing_weapons', ranges: [2, 4, 6, 10], attribute: 'strength' } : null);
        let category = profile?.category ?? (has(f.mode) || has(f.ammo) ? 'range' : 'melee');
        if (/^(range|ranged|melee|thrown)$/i.test(String(f.category ?? ''))) category = String(f.category).toLowerCase().replace('ranged', 'range');
        system.category = category;
        if (has(f.subcategory)) system.subcategory = String(f.subcategory);
        else if (has(f.category) && !/^(range|ranged|melee|thrown)$/i.test(f.category)) system.subcategory = String(f.category);

        technology(system, f, { owned });
        system.action = {
            type: category === 'melee' ? 'complex' : 'simple',
            attribute: 'agility',
            skill: (has(f.skill) ? skillKey(f.skill) : '') || profile?.skill || (category === 'melee' ? 'blades' : category === 'thrown' ? 'throwing_weapons' : 'pistols'),
            categories: [category === 'melee' ? 'attack_melee' : category === 'thrown' ? 'attack_thrown' : 'attack_ranged'],
        };
        if (!profile && !has(f.skill)) warnings.push(`Weapon skill guessed as "${system.action.skill}" from "${categoryText || 'no category'}".`);

        if (has(f.accuracy)) {
            const acc = parseAugmented(f.accuracy);
            const accValue = owned && acc.augmented !== undefined ? acc.augmented : acc.base;
            system.action.limit = { base: accValue, value: accValue };
            if (/physical/i.test(String(f.accuracy))) system.action.limit = { base: 0, value: 0, attribute: 'physical' };
        }
        const dmg = has(f.damage) ? parseDamage(f.damage) : null;
        if (dmg) setActionDamage(system, dmg, has(f.ap) ? parseAP(f.ap) : undefined);
        else if (has(f.ap)) system.action.damage = { ap: { base: parseAP(f.ap), value: parseAP(f.ap) } };
        if (dmg?.attribute === 'strength' && category === 'melee') system.action.damage.attribute = 'strength';

        if (category === 'melee') {
            system.melee = { reach: toNumber(f.reach, 0) };
        } else {
            const ranges = profile?.ranges ?? [5, 20, 40, 60];
            const rangeData = {
                short: ranges[0], medium: ranges[1], long: ranges[2], extreme: ranges[3],
                category: 'manual', attribute: profile?.attribute ?? '',
            };
            if (category === 'range') {
                const modes = parseModes(f.mode);
                if (!Object.values(modes).some(Boolean)) modes.single_shot = true;
                const rc = has(f.rc) ? parseAugmented(f.rc) : null;
                const rcValue = rc ? (owned && rc.augmented !== undefined ? rc.augmented : rc.base) : 0;
                system.range = { ranges: rangeData, modes, rc: { base: rcValue, value: rcValue } };
                if (has(f.ammo)) {
                    const ammo = parseAmmo(f.ammo);
                    system.ammo = { current: { value: ammo.count, max: ammo.count } };
                    if (ammo.clip) system.ammo.clip_type = ammo.clip;
                }
            } else {
                const blast = has(f.blast) ? parseDamage(f.blast) : dmg;
                system.thrown = { ranges: rangeData, blast: { radius: toNumber(blast?.radius, 0), dropoff: toNumber(blast?.dropoff, 0) } };
                if (has(f.blast) && /(\d+)\s*m/i.test(f.blast) && !blast.dropoff) system.thrown.blast.radius = toNumber(/(\d+)\s*m/i.exec(f.blast)[1]);
            }
        }
    },

    armor({ system, f, owned, name }) {
        technology(system, f, { owned });
        const armorValue = has(f.armor) ? f.armor : has(f.rating) && !has(f.capacity) ? f.rating : 0;
        const accessory = /^\s*\+/.test(String(armorValue)) || /helmet|shield|gloves|boots|accessor/i.test(name) && /^\s*\+/.test(String(armorValue));
        armorPart(system, armorValue, { accessory });
        if (system.technology?.rating !== undefined && has(f.armor)) delete system.technology.rating;
        if (has(f.capacity)) system.capacity = { total: toNumber(f.capacity) };
        else if (has(f.armor)) system.capacity = { total: Math.abs(toNumber(f.armor)) };
    },

    cyberware: ware('cyberware'),
    bioware: ware('bioware'),

    equipment({ system, f, owned }) {
        technology(system, f, { owned });
    },

    device({ system, f, owned, name }) {
        technology(system, f, { owned });
        const text = `${f.category ?? ''} ${f.subcategory ?? ''} ${name}`.toLowerCase();
        system.category = /cyberdeck|\bdeck\b/.test(text) ? 'cyberdeck'
            : /\brcc\b|rigger command|command console/.test(text) ? 'rcc'
            : /commlink|\blink\b/.test(text) ? 'commlink' : 'device';
        deviceAttributes(system, f);
        if (system.category === 'commlink' && !system.atts && system.technology?.rating !== undefined) {
            // Commlinks: Data Processing and Firewall equal the device rating.
            system.atts = { att3: { value: system.technology.rating, att: 'data_processing' }, att4: { value: system.technology.rating, att: 'firewall' } };
        }
        if (has(f.programs)) system.programs = toNumber(f.programs);
    },

    program({ system, f, owned, name }) {
        technology(system, f, { owned });
        const text = `${f.category ?? ''} ${f.subcategory ?? ''} ${name}`.toLowerCase();
        system.type = /\bagent\b/.test(text) ? 'agent' : /hacking/.test(text) ? 'hacking_program' : 'common_program';
    },

    ammo({ system, f, owned }) {
        technology(system, f, { owned });
        if (has(f.damage)) {
            const dmg = parseDamage(f.damage);
            system.damage = dmg.damage;
            system.damageType = dmg.type || 'physical';
            if (dmg.element) system.element = dmg.element;
            if (/^\s*\d/.test(String(f.damage)) && !/^\s*[+-]/.test(String(f.damage))) system.replaceDamage = true;
        }
        if (has(f.ap)) {
            system.ap = parseAP(f.ap);
            if (/^\s*-?\d/.test(String(f.ap)) && !/^\s*[+-]/.test(String(f.ap))) system.replaceAP = true;
        }
        if (has(f.accuracy)) system.accuracy = toNumber(f.accuracy);
        if (has(f.blast)) {
            const b = parseDamage(f.blast);
            system.blast = { radius: b.radius, dropoff: b.dropoff };
        }
        if (has(f.element)) system.element = String(f.element).toLowerCase();
    },

    modification({ system, f, owned, name }) {
        technology(system, f, { owned });
        const text = `${f.category ?? ''} ${f.subcategory ?? ''} ${f.type ?? ''}`.toLowerCase();
        system.type = /armor|armour/.test(text) ? 'armor'
            : /cyber|ware/.test(text) ? 'ware'
            : /drone/.test(text) ? 'drone'
            : /vehicle/.test(text) ? 'vehicle' : 'weapon';
        if (system.type === 'weapon') {
            const mount = String(f.slots ?? f.mount ?? '').toLowerCase();
            const mp = ['barrel', 'under', 'stock', 'top', 'side', 'internal'].find(m => mount.includes(m) || (m === 'under' && mount.includes('under')));
            system.mod_weapon = {};
            if (mp) system.mod_weapon.mount_point = mp;
            if (has(f.accuracy)) system.mod_weapon.accuracy = toNumber(f.accuracy);
            if (has(f.rc)) system.mod_weapon.rc = toNumber(f.rc);
            if (has(f.conceal)) system.mod_weapon.conceal = toNumber(f.conceal);
        } else if (system.type === 'armor') {
            if (has(f.armor)) system.mod_armor = { value: toNumber(f.armor) };
            if (has(f.capacity)) system.slots = toNumber(String(f.capacity).replace(/[[\]]/g, ''));
        } else {
            if (has(f.slots)) system.slots = toNumber(f.slots);
            if (has(f.essence)) system.essence = toNumber(f.essence);
            if (has(f.capacity)) system.slots = toNumber(String(f.capacity).replace(/[[\]]/g, ''));
        }
        if (owned && system.technology) system.technology.equipped = true;
        void name;
    },

    spell({ system, f, hint, warnings, name }) {
        const descriptors = String(f.descriptors ?? '').toLowerCase();
        const typeLetter = String(f.type ?? '').trim().toUpperCase();
        if (/^M/.test(typeLetter) || /mana/i.test(f.type ?? '')) system.type = 'mana';
        else if (/^P/.test(typeLetter) || /physical/i.test(f.type ?? '')) system.type = 'physical';

        let category = String(f.category ?? hint.category ?? '').toLowerCase().replace(/ spells?$/, '').trim();
        if (!['combat', 'detection', 'health', 'illusion', 'manipulation'].includes(category)) {
            category = /direct|indirect|elemental/.test(descriptors) ? 'combat'
                : /directional|psychic|area|active|passive|extended/.test(descriptors) ? 'detection'
                : /realistic|obvious|sense/.test(descriptors) ? 'illusion'
                : /mental|environmental|physical|damaging/.test(descriptors) ? 'manipulation'
                : /essence/.test(descriptors) ? 'health' : '';
            if (!category) warnings.push('Spell category not found; set it on the item sheet.');
        }
        if (category) system.category = category;

        const range = String(f.range ?? '').toUpperCase().replace(/\s+/g, '');
        if (range) system.range = /^T/.test(range) ? 'touch' : /\(A\)|LOS\(A\)|AREA/.test(range) ? 'los_a' : 'los';
        const dur = String(f.duration ?? '').trim().toUpperCase();
        if (dur) system.duration = /^S/.test(dur) ? 'sustained' : /^P/.test(dur) ? 'permanent' : 'instant';

        const drainText = has(f.drain) ? f.drain : (has(f.damage) && /F/i.test(f.damage) ? f.damage : '');
        if (drainText) system.drain = toNumber(String(drainText).replace(/^\s*F\s*/i, '').replace(/\s+/g, ''), 0);

        system.action = { type: 'varies', skill: 'spellcasting', attribute: 'magic', categories: [`spell_${category === 'health' ? 'healing' : category || 'combat'}`] };
        system.action.opposed = {};
        if (category === 'combat') {
            const indirect = /indirect/.test(descriptors);
            system.combat = { type: indirect ? 'indirect' : 'direct' };
            if (indirect) system.action.opposed.type = 'defense';
            else {
                system.action.opposed.type = 'soak';
                system.action.opposed.attribute = system.type === 'physical' ? 'body' : 'willpower';
            }
            const dmgType = String(f.damage ?? '').trim().toUpperCase();
            const t = /^S/.test(dmgType) ? 'stun' : 'physical';
            const element = /\b(fire|cold|acid|electricity|water|radiation|pollutant)\b/.exec(descriptors + ' ' + name.toLowerCase())?.[1] ?? '';
            system.action.damage = { type: { base: t, value: t }, element: { base: element, value: element } };
        } else if (category === 'detection') {
            system.detection = {
                passive: /passive/.test(descriptors),
                extended: /extended/.test(descriptors),
                type: /directional/.test(descriptors) ? 'directional' : /psychic/.test(descriptors) ? 'psychic' : /area/.test(descriptors) ? 'area' : '',
            };
            if (!system.detection.passive) Object.assign(system.action.opposed, { type: 'custom', attribute: 'willpower', attribute2: 'logic' });
        } else if (category === 'illusion') {
            system.illusion = {
                type: /realistic/.test(descriptors) ? 'realistic' : /obvious/.test(descriptors) ? 'obvious' : '',
                sense: /multi/.test(descriptors) ? 'multi-sense' : /single/.test(descriptors) ? 'single-sense' : '',
            };
            Object.assign(system.action.opposed, system.type === 'physical'
                ? { type: 'custom', attribute: 'intuition', attribute2: 'logic' }
                : { type: 'custom', attribute: 'willpower', attribute2: 'logic' });
        } else if (category === 'manipulation') {
            system.manipulation = {
                damaging: /damaging/.test(descriptors), mental: /mental/.test(descriptors),
                environmental: /environmental/.test(descriptors), physical: /physical/.test(descriptors),
            };
            if (system.manipulation.mental) Object.assign(system.action.opposed, { type: 'custom', attribute: 'willpower', attribute2: 'logic' });
            if (system.manipulation.physical) Object.assign(system.action.opposed, { type: 'custom', attribute: 'body', attribute2: 'strength' });
        }
        if (!Object.keys(system.action.opposed).length) delete system.action.opposed;
    },

    ritual({ system, f }) {
        const t = String(f.type ?? '').trim().toUpperCase();
        if (/^M/.test(t)) system.type = 'mana';
        else if (/^P/.test(t)) system.type = 'physical';
        if (has(f.descriptors)) system.descriptors = String(f.descriptors);
        system.action = { type: 'varies', skill: 'ritual_spellcasting', attribute: 'magic' };
    },

    adept_power({ system, f, owned }) {
        const ppText = has(f.pp) ? f.pp : has(f.cost) ? f.cost : '';
        if (ppText) system.pp = toNumber(ppText, 0);
        const activation = String(f.activation ?? '').toLowerCase();
        system.type = !activation || /passive|none|always/.test(activation) ? 'passive' : 'active';
        if (/free|simple|complex|interrupt/.test(activation)) {
            system.action = { type: /free/.test(activation) ? 'free' : /simple/.test(activation) ? 'simple' : /interrupt/.test(activation) ? 'interrupt' : 'complex' };
        }
        if (has(f.rating)) system.level = toNumber(f.rating);
        void owned;
    },

    critter_power({ system, f, hint }) {
        const t = String(f.type ?? '').trim().toUpperCase();
        if (/^M/.test(t)) system.powerType = 'mana';
        else if (/^P/.test(t)) system.powerType = 'physical';
        const range = String(f.range ?? '').toUpperCase().replace(/\s+/g, '');
        if (range) system.range = /^T/.test(range) ? 'touch' : /SELF/.test(range) ? 'self' : /\(A\)/.test(range) ? 'los_a' : /LOS/.test(range) ? 'los' : 'special';
        const dur = String(f.duration ?? '').trim().toLowerCase();
        if (dur) system.duration = /^a/.test(dur) ? 'always' : /^i/.test(dur) ? 'instant' : /^s(?!p)/.test(dur) ? 'sustained' : /^p/.test(dur) ? 'permanent' : 'special';
        const act = String(f.activation ?? '').toLowerCase();
        if (act) system.action = { type: /auto/.test(act) ? 'none' : /free/.test(act) ? 'free' : /simple/.test(act) ? 'simple' : /complex/.test(act) ? 'complex' : /interrupt/.test(act) ? 'interrupt' : 'varies' };
        if (has(f.rating)) system.rating = toNumber(f.rating);
        if (has(f.karma)) system.karma = toNumber(f.karma);
        if (hint.optional) system.optional = 'disabled_option';
        if (hint.weakness) system.category = 'weakness';
        const cat = String(f.category ?? '').toLowerCase().replace(/\s+/g, '_');
        if (['mundane', 'paranormal', 'free_spirit', 'emergent', 'shapeshifter', 'drake', 'echoes', 'weakness', 'paranormal_infected'].includes(cat)) system.category = cat;
    },

    sprite_power({ system, f, hint }) {
        const dur = String(f.duration ?? '').trim().toLowerCase();
        if (dur) system.duration = /^a/.test(dur) ? 'always' : /^i/.test(dur) ? 'instant' : /^s(?!p)/.test(dur) ? 'sustained' : /^p/.test(dur) ? 'permanent' : 'special';
        const act = String(f.activation ?? '').toLowerCase();
        if (act) system.action = { type: /auto/.test(act) ? 'none' : /free/.test(act) ? 'free' : /simple/.test(act) ? 'simple' : /complex/.test(act) ? 'complex' : 'varies' };
        if (hint.optional) system.optional = 'disabled_option';
    },

    complex_form({ system, f }) {
        const target = String(f.target ?? '').toLowerCase();
        const targets = { persona: 'persona', device: 'device', file: 'file', self: 'self', sprite: 'sprite', host: 'host', ic: 'ic' };
        if (target) system.target = Object.keys(targets).find(k => target.includes(k)) ?? 'other';
        const dur = String(f.duration ?? '').trim().toUpperCase();
        if (dur) system.duration = /^S/.test(dur) ? 'sustained' : /^P/.test(dur) ? 'permanent' : 'immediate';
        if (has(f.fade)) system.fade = toNumber(String(f.fade).replace(/^\s*L\s*/i, '').replace(/\s+/g, ''), 0);
        system.action = { skill: 'software', attribute: 'resonance', type: 'complex' };
    },

    quality({ system, f, hint }) {
        let type = hint.qualityType;
        const t = String(f.type ?? f.category ?? '').toLowerCase();
        if (/neg/.test(t)) type = 'negative';
        else if (/pos/.test(t)) type = 'positive';
        else if (/life ?module/.test(t)) type = 'lifemodule';
        if (!type && has(f.karma)) type = /bonus/i.test(String(f._karmaLabel ?? '')) || toNumber(f.karma) < 0 ? 'negative' : 'positive';
        if (type) system.type = type;
        if (has(f.karma)) system.karma = Math.abs(toNumber(f.karma));
        if (has(f.rating)) system.rating = toNumber(f.rating);
    },

    lifestyle({ system, f, name }) {
        const text = `${f.type ?? ''} ${f.category ?? ''} ${name}`.toLowerCase();
        const type = ['street', 'squatter', 'low', 'luxury', 'high'].find(t => text.includes(t)) ?? (/middle|medium/.test(text) ? 'medium' : 'other');
        system.type = type;
        if (has(f.cost)) system.cost = parseCost(f.cost);
        for (const k of ['comforts', 'security', 'neighborhood', 'guests']) if (has(f[k])) system[k] = toNumber(f[k]);
        if (/permanent/.test(text)) system.permanent = true;
    },

    contact({ system, f }) {
        if (has(f.type) || has(f.category)) system.type = String(f.type ?? f.category);
        if (has(f.connection)) system.connection = toNumber(f.connection);
        if (has(f.loyalty)) system.loyalty = toNumber(f.loyalty);
        const s = `${f.notes ?? ''} ${f.type ?? ''}`.toLowerCase();
        if (/family/.test(s)) system.family = true;
        if (/blackmail/.test(s)) system.blackmail = true;
        if (/group/.test(s)) system.group = true;
    },

    sin({ system, f, owned }) {
        technology(system, f, { owned });
        if (has(f.licenses)) {
            const list = Array.isArray(f.licenses) ? f.licenses : String(f.licenses).split(/[,;]/);
            system.licenses = list.map(l => typeof l === 'string'
                ? { name: l.replace(/\(.*?\)/, '').trim(), rtg: extractRating(l) ?? system.technology?.rating ?? 1 }
                : l);
        }
    },

    host({ system, f }) {
        if (has(f.rating)) system.rating = toNumber(f.rating);
        deviceAttributes(system, f);
        // The system derives host attributes from the rating unless they are custom; keep the printed ones.
        if (system.atts) system.customAttributes = true;
    },

    metamagic() {},
    echo() {},
    grid() {},

    action({ system, f }) {
        system.action = {};
        if (has(f.skill)) system.action.skill = skillKey(f.skill) || String(f.skill);
        if (has(f.activation)) system.action.type = String(f.activation).toLowerCase();
    },

    call_in_action() {},

    skill({ system, f, hint }) {
        system.type = 'skill';
        system.skill = { rating: toNumber(f.rating, 0) };
        const cat = String(f.category ?? hint.skillCategory ?? '').toLowerCase();
        system.skill.category = /lang/.test(cat) ? 'language' : /know/.test(cat) ? 'knowledge' : 'active';
    },
};

function ware(kind) {
    return function ({ system, f, owned, name }) {
        technology(system, f, { owned });
        if (has(f.essence)) system.essence = toNumber(String(f.essence).replace(/rating\s*[x×*]\s*/i, ''));
        if (has(f.capacity)) system.capacity = { total: toNumber(String(f.capacity).replace(/[[\]]/g, '')) };
        system.grade = wareGrade(`${f.grade ?? ''} ${name}`);
        if (has(f.armor)) system.armor = { base: toNumber(f.armor), value: toNumber(f.armor), accessory: true };
        if (has(f.damage)) {
            // Cyber-weapons (spurs, hand razors, implant guns) attack with Unarmed Combat by default.
            system.action = {
                type: 'complex', attribute: 'agility', categories: ['attack_melee'],
                skill: (has(f.skill) ? skillKey(f.skill) : '') || 'unarmed_combat',
            };
            if (has(f.accuracy)) { const a = parseAugmented(f.accuracy); system.action.limit = { base: a.augmented ?? a.base, value: a.augmented ?? a.base }; }
            setActionDamage(system, parseDamage(f.damage), has(f.ap) ? parseAP(f.ap) : undefined);
        }
        void kind;
    };
}

/** Choose cyberware vs bioware for an augmentation name. */
export function wareType(name) {
    return isBioware(name) ? 'bioware' : 'cyberware';
}
