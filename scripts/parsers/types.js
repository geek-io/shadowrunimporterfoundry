/**
 * Document type vocabulary: what words in source material mean which SR5 system type.
 */

export const ITEM_TYPES = [
    'action', 'adept_power', 'ammo', 'armor', 'bioware', 'call_in_action', 'complex_form', 'contact',
    'critter_power', 'cyberware', 'device', 'echo', 'equipment', 'grid', 'host', 'lifestyle', 'metamagic',
    'modification', 'program', 'quality', 'ritual', 'sin', 'skill', 'spell', 'sprite_power', 'weapon',
];

export const ACTOR_TYPES = ['character', 'spirit', 'sprite', 'vehicle', 'ic'];

/** Type words → [documentName, systemType, extras] */
const TYPE_WORDS = [
    // Actors
    [/^(npc|grunt|grunts|lieutenant|professional|runner|character|pc|player character|contact npc|stat ?block)$/, 'Actor', 'character', { npc: true }],
    [/^(critter|creature|animal|paracritter|awakened critter|dracoform|dragon|shapeshifter|infected|metavariant)$/, 'Actor', 'character', { npc: true, critter: true }],
    [/^(spirit|spirits|ally spirit|free spirit|watcher)$/, 'Actor', 'spirit'],
    [/^(sprite|sprites)$/, 'Actor', 'sprite'],
    [/^(vehicle|vehicles|car|bike|truck|boat|aircraft|drone|drones|vtol|rotorcraft|anthroform)$/, 'Actor', 'vehicle'],
    [/^(ic|intrusion countermeasures?)$/, 'Actor', 'ic'],

    // Items
    [/^(weapon|weapons|firearm|firearms|gun|guns|melee( weapon)?|ranged( weapon)?|pistol|rifle|shotgun|smg|blade|club|bow|crossbow|grenade|grenades|rocket|missile|throwing weapon|explosive)s?$/, 'Item', 'weapon'],
    [/^(armor|armour|clothing|armor accessory|helmet|shield)s?$/, 'Item', 'armor'],
    [/^(spell|spells|combat spell|detection spell|health spell|illusion spell|manipulation spell)s?$/, 'Item', 'spell'],
    [/^(adept power|adept powers|power|powers|adept)$/, 'Item', 'adept_power'],
    [/^(critter power|critter powers|spirit power|spirit powers|optional powers?|weakness(es)?)$/, 'Item', 'critter_power'],
    [/^(sprite power|sprite powers)$/, 'Item', 'sprite_power'],
    [/^(complex form|complex forms|cf)$/, 'Item', 'complex_form'],
    [/^(quality|qualities|positive quality|positive qualities|negative quality|negative qualities)$/, 'Item', 'quality'],
    [/^(cyberware|cyber|headware|eyeware|earware|bodyware|cyberlimb|cyberlimbs|cyberweapon|cyberweapons|cybernetics|augmentation|augmentations|implant|implants|cyberware?s)$/, 'Item', 'cyberware'],
    [/^(bioware|cultured bioware|biotech|genetech|nanotech|nanoware)s?$/, 'Item', 'bioware'],
    [/^(gear|equipment|item|items|misc|miscellaneous|tool|tools|drug|drugs|toxin|toxins|chemical|survival gear|security|sensor|sensors|electronics|focus|foci|magical (equipment|supplies)|reagents?)$/, 'Item', 'equipment'],
    [/^(device|commlink|commlinks|cyberdeck|cyberdecks|deck|rcc|rccs|rigger command console|cyberterminal)s?$/, 'Item', 'device'],
    [/^(program|programs|common program|hacking program|agent|agents|autosoft|autosofts|software)s?$/, 'Item', 'program'],
    [/^(ammo|ammunition|ammunitions|round|rounds)$/, 'Item', 'ammo'],
    [/^(modification|modifications|mod|mods|accessory|accessories|weapon accessory|weapon accessories|weapon mod|armor modification|armor mod|vehicle mod|vehicle modification|cyberware mod|ware mod|upgrade)s?$/, 'Item', 'modification'],
    [/^(lifestyle|lifestyles)$/, 'Item', 'lifestyle'],
    [/^(contact|contacts)$/, 'Item', 'contact'],
    [/^(sin|sins|fake sin|license|licenses|licence|licences|id)$/, 'Item', 'sin'],
    [/^(ritual|rituals)$/, 'Item', 'ritual'],
    [/^(metamagic|metamagics|metamagic technique)s?$/, 'Item', 'metamagic'],
    [/^(echo|echoes)$/, 'Item', 'echo'],
    [/^(host|hosts)$/, 'Item', 'host'],
    [/^(action|actions|matrix action|matrix actions)$/, 'Item', 'action'],
    [/^(skill|skills|knowledge skill|language)$/, 'Item', 'skill'],
];

/**
 * Turn a free-text type word (e.g. "Weapon (Heavy Pistol)", "adept power", "NPC") into a document target.
 * @returns {{documentName: 'Actor'|'Item', type: string, sub?: string, npc?: boolean, critter?: boolean}|null}
 */
export function resolveType(word) {
    if (!word) return null;
    const raw = String(word).trim();
    const sub = /\(([^)]+)\)/.exec(raw)?.[1]?.trim();
    const base = raw.replace(/\(.*?\)/g, '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

    // Direct system keys first ("adept_power", "critter_power").
    const asKey = base.replace(/\s+/g, '_');
    if (ITEM_TYPES.includes(asKey)) return { documentName: 'Item', type: asKey, sub };
    if (ACTOR_TYPES.includes(asKey)) return { documentName: 'Actor', type: asKey, sub };

    for (const [re, documentName, type, extras] of TYPE_WORDS) {
        if (re.test(base)) return { documentName, type, sub: sub ?? (base !== type ? base : undefined), ...(extras ?? {}) };
    }

    // Weapon category words used as the type ("Heavy Pistol", "Assault Rifle").
    if (weaponProfile(base)) return { documentName: 'Item', type: 'weapon', sub: raw };
    return null;
}

/* ------------------------------------------------------------------ */
/* Weapons                                                            */
/* ------------------------------------------------------------------ */

const STR = 'strength';

/**
 * SR5 core range table (p. 185) and the matching skill and weapon category.
 * Ranges with `attribute` are multipliers of that attribute.
 */
const WEAPON_PROFILES = [
    [/taser/, { category: 'range', skill: 'pistols', ranges: [5, 10, 15, 20] }],
    [/hold-? ?out/, { category: 'range', skill: 'pistols', ranges: [5, 15, 30, 50] }],
    [/light pistol/, { category: 'range', skill: 'pistols', ranges: [5, 15, 30, 50] }],
    [/machine pistol/, { category: 'range', skill: 'automatics', ranges: [5, 15, 30, 50] }],
    [/heavy pistol|pistol/, { category: 'range', skill: 'pistols', ranges: [5, 20, 40, 60] }],
    [/submachine|\bsmgs?\b/, { category: 'range', skill: 'automatics', ranges: [10, 40, 80, 150] }],
    [/assault rifle|carbine/, { category: 'range', skill: 'automatics', ranges: [25, 150, 350, 550] }],
    [/sniper/, { category: 'range', skill: 'longarms', ranges: [50, 350, 800, 1500] }],
    [/sport(ing)? rifle|hunting rifle|rifle/, { category: 'range', skill: 'longarms', ranges: [100, 250, 500, 750] }],
    [/shotgun/, { category: 'range', skill: 'longarms', ranges: [10, 40, 80, 150] }],
    [/light machine|\blmgs?\b/, { category: 'range', skill: 'heavy_weapons', ranges: [25, 200, 400, 800] }],
    [/medium machine|heavy machine|\bmmgs?\b|\bhmgs?\b|machine gun/, { category: 'range', skill: 'heavy_weapons', ranges: [40, 250, 750, 1200] }],
    [/assault cannon|cannon/, { category: 'range', skill: 'heavy_weapons', ranges: [50, 300, 750, 1500] }],
    [/grenade launcher/, { category: 'range', skill: 'heavy_weapons', ranges: [50, 100, 150, 500] }],
    [/missile launcher|rocket launcher|launcher/, { category: 'range', skill: 'heavy_weapons', ranges: [70, 150, 450, 1500] }],
    [/heavy crossbow/, { category: 'range', skill: 'archery', ranges: [15, 45, 120, 180] }],
    [/medium crossbow/, { category: 'range', skill: 'archery', ranges: [9, 36, 90, 150] }],
    [/crossbow/, { category: 'range', skill: 'archery', ranges: [6, 24, 60, 120] }],
    [/\bbows?\b|longbow|archery/, { category: 'range', skill: 'archery', ranges: [1, 10, 30, 60], attribute: STR }],
    [/aerodynamic grenade/, { category: 'thrown', skill: 'throwing_weapons', ranges: [2, 4, 8, 15], attribute: STR }],
    [/grenade|explosive/, { category: 'thrown', skill: 'throwing_weapons', ranges: [2, 4, 6, 10], attribute: STR }],
    [/shuriken|throwing|thrown/, { category: 'thrown', skill: 'throwing_weapons', ranges: [1, 2, 5, 7], attribute: STR }],
    [/unarmed|cyber ?implant weapon|spurs|shock glove|knucks|hand razor|bone lacing/, { category: 'melee', skill: 'unarmed_combat' }],
    [/exotic melee|monofilament whip|whip|monowhip/, { category: 'melee', skill: 'exotic_melee_weapon' }],
    [/exotic ranged|flamethrower|net ?gun|dart gun/, { category: 'range', skill: 'exotic_ranged_weapon', ranges: [5, 15, 30, 50] }],
    [/blade|knife|knives|sword|katana|axe|dagger|machete|combat knife|survival knife|forearm snap|sabre|saber|spear|pole ?arm/, { category: 'melee', skill: 'blades' }],
    [/club|baton|staff|sap|bat|hammer|mace|telescoping|stun baton|shock/, { category: 'melee', skill: 'clubs' }],
    [/melee/, { category: 'melee', skill: 'blades' }],
];

export function weaponProfile(text) {
    const s = String(text ?? '').toLowerCase();
    if (!s) return null;
    for (const [re, profile] of WEAPON_PROFILES) if (re.test(s)) return profile;
    return null;
}

/* ------------------------------------------------------------------ */
/* Actors                                                             */
/* ------------------------------------------------------------------ */

export const METATYPES = { human: 'human', elf: 'elf', ork: 'ork', orc: 'ork', dwarf: 'dwarf', troll: 'troll' };

export const SPIRIT_TYPES = [
    'abomination', 'air', 'aircraft', 'airwave', 'ally', 'anansi', 'anarch', 'arboreal', 'automotive', 'barren',
    'beasts', 'blackjack', 'blade_summoned', 'blood', 'blood_shade', 'boggle', 'bone', 'bugul', 'carcass', 'caretaker',
    'ceramic', 'chindi', 'corps_cadavre', 'corpse', 'crawler', 'croki', 'detritus', 'duende', 'earth', 'ejerian',
    'elvar', 'energy', 'erinyes', 'fire', 'ghasts', 'green_man', 'gremlin', 'guardian', 'guidance', 'gum_toad',
    'homunculus', 'hopper', 'horror_show', 'imp', 'jarl', 'kappa', 'kokopelli', 'man', 'master_shedim', 'metal',
    'morbi', 'muse', 'nightmare', 'nocnitsa', 'noxious', 'nuclear', 'nymph', 'palefire', 'phantom', 'plague',
    'plant', 'preta', 'queen', 'rot', 'scout', 'shade', 'shedim', 'ship', 'sludge', 'soldier', 'stabber', 'succubus',
    'task', 'train', 'tsuchigumo_warrior', 'tungak', 'unbreakable', 'vrygoths', 'vucub_caquix', 'watcher', 'water',
    'worker', 'wraith',
];

export const SPRITE_TYPES = ['companion', 'courier', 'crack', 'data', 'fault', 'generalist', 'machine'];

export const IC_TYPES = [
    'acid', 'binder', 'black_ic', 'blaster', 'bloodhound', 'blue_goo', 'catapult', 'crash', 'flicker', 'jammer',
    'killer', 'marker', 'patrol', 'probe', 'scramble', 'shocker', 'sleuther', 'sparky', 'tar_baby', 'track',
];

/** "Spirit of Fire", "Fire Spirit", "Beasts Spirit", "Spirit of Man" → 'fire' etc. */
export function spiritTypeFromName(name) {
    const s = String(name ?? '').toLowerCase();
    const m = /spirit of (?:the )?([a-z' -]+)/.exec(s) ?? /([a-z' -]+?)\s+spirit/.exec(s);
    const candidates = [];
    if (m) candidates.push(m[1].trim());
    candidates.push(s);
    for (const c of candidates) {
        const key = c.replace(/['’]/g, '').replace(/[\s-]+/g, '_');
        if (SPIRIT_TYPES.includes(key)) return key;
        if (key === 'beast' || key === 'animal') return 'beasts';
        if (key === 'men') return 'man';
        for (const t of SPIRIT_TYPES) if (new RegExp(`\\b${t.replace(/_/g, '[ _-]')}s?\\b`).test(c)) return t;
    }
    return '';
}

export function spriteTypeFromName(name) {
    const s = String(name ?? '').toLowerCase();
    for (const t of SPRITE_TYPES) if (new RegExp(`\\b${t}\\b`).test(s)) return t;
    return '';
}

export function icTypeFromName(name) {
    const s = String(name ?? '').toLowerCase().replace(/[\s-]+/g, '_');
    for (const t of IC_TYPES) if (s.includes(t)) return t;
    return '';
}

export function vehicleTypeFromText(text) {
    const s = String(text ?? '').toLowerCase();
    if (/aerospace|suborbital|semiballistic|spaceplane/.test(s)) return 'aerospace';
    if (/groundcraft|\bcars?\b|\bbikes?\b|motorcycle|truck|\bvans?\b|sedan|\bsuv\b|limo/.test(s)) return 'ground';
    if (/walker|anthro|legged|spider|crawler/.test(s)) return 'walker';
    if (/boat|ship|yacht|submarine|\bsub\b|watercraft|hydrofoil|jet ?ski|catamaran|\braft\b|kayak|vessel/.test(s)) return 'water';
    if (/roto|rotor|vtol|vstol|helicopter|plane|aircraft|jet|blimp|airship|\blta\b|glider|wing|aerial|copter|dragonfly|hornet|condor|kite|balloon/.test(s)) return 'air';
    return 'ground';
}

/* ------------------------------------------------------------------ */
/* Ware                                                               */
/* ------------------------------------------------------------------ */

const BIOWARE_WORDS = [
    'adrenaline pump', 'bone density', 'cat\'s eyes', 'cats eyes', 'claws (bio', 'damage compensator', 'enhanced articulation',
    'erythropoietin', 'genetic', 'hypothalamus', 'mnemonic enhancer', 'muscle augmentation', 'muscle toner', 'nephritic screen',
    'nictitating', 'orthoskin', 'pain editor', 'pathogenic defense', 'platelet factor', 'reflex recorder', 'sleep regulator',
    'suprathyroid', 'symbiotes', 'synaptic booster', 'synthacardium', 'tailored pheromones', 'toxin extractor', 'tracheal filter',
    'trauma damper', 'cerebral booster', 'reception enhancer', 'chemical gland', 'sensitive neural', 'spinal reinforcement',
    'bioware', 'cultured', 'nanohive', 'nanite', 'gene therapy', 'metabolic arrester', 'boosted reflexes',
];

/** Names that are armor or armored clothing ("Berwick Suit", "Armor Jacket", "Lined Coat"). */
export function isArmorName(name) {
    return /\barmou?r\b|jacket|\bvest\b|lined coat|\bcoat\b|clothing|clothes|helmet|\bshield\b|form-?fitting|bodysuit|\bsuit\b|urban explorer|ballistic|security suit|riot|\bffbs\b|full body|mortimer|zoe|vashon|actioneer|victory|camouflage|\bcamo\b|milspec|uniform|\bduster\b|\bcloak\b|\bpants\b|leathers/i.test(String(name ?? ''));
}

export function isBioware(name) {
    const s = String(name ?? '').toLowerCase();
    return BIOWARE_WORDS.some(w => s.includes(w));
}

export function wareGrade(text) {
    const s = String(text ?? '').toLowerCase();
    if (/\balpha/.test(s)) return 'alpha';
    if (/\bbeta/.test(s)) return 'beta';
    if (/\bdelta/.test(s)) return 'delta';
    if (/\bgamma/.test(s)) return 'gamma';
    if (/\bused\b|second-?hand/.test(s)) return 'used';
    if (/\bgr[ae]y\b/.test(s)) return 'grey';
    return 'standard';
}

/* ------------------------------------------------------------------ */
/* Section headings in books and stat blocks                         */
/* ------------------------------------------------------------------ */

/**
 * Lines like "COMBAT SPELLS", "Heavy Pistols", "Negative Qualities" set context for the entries below them.
 * @returns {{type: string, documentName: string, sub?: string, hint?: object}|null}
 */
export function sectionHeading(line) {
    const raw = String(line ?? '').trim();
    // Headings start with a capital and don't end a sentence ("bikes." in a paragraph is not BIKES).
    if (/^[a-z]/.test(raw) || /[.!?,;]$/.test(raw)) return null;
    const s = raw.replace(/:+$/, '').toLowerCase();
    if (!s || s.length > 40 || /\d/.test(s)) return null;
    const spell = /^(combat|detection|health|illusion|manipulation) spells?$/.exec(s);
    if (spell) return { documentName: 'Item', type: 'spell', hint: { category: spell[1] } };
    if (/^positive qualit(y|ies)$/.test(s)) return { documentName: 'Item', type: 'quality', hint: { qualityType: 'positive' } };
    if (/^negative qualit(y|ies)$/.test(s)) return { documentName: 'Item', type: 'quality', hint: { qualityType: 'negative' } };
    if (/^(headware|eyeware|earware|bodyware|cyberlimbs?|cyberweapons?|cyberware)$/.test(s)) return { documentName: 'Item', type: 'cyberware', sub: s };
    if (/^(basic |cultured )?bioware$/.test(s)) return { documentName: 'Item', type: 'bioware', sub: s };
    if (/^(adept powers?)$/.test(s)) return { documentName: 'Item', type: 'adept_power' };
    if (/^(critter powers?|spirit powers?)$/.test(s)) return { documentName: 'Item', type: 'critter_power' };
    if (/^complex forms?$/.test(s)) return { documentName: 'Item', type: 'complex_form' };
    if (/^(sprite powers?)$/.test(s)) return { documentName: 'Item', type: 'sprite_power' };
    if (/^(echoes)$/.test(s)) return { documentName: 'Item', type: 'echo' };
    if (/^(metamagics?|metamagic techniques)$/.test(s)) return { documentName: 'Item', type: 'metamagic' };
    if (/^(rituals?)$/.test(s)) return { documentName: 'Item', type: 'ritual' };
    if (/^(commlinks?|cyberdecks?|rigger command consoles|rccs?)$/.test(s)) return { documentName: 'Item', type: 'device', sub: s };
    if (/^(hacking programs?|common programs?|agents?|autosofts?)$/.test(s)) return { documentName: 'Item', type: 'program', sub: s };
    if (/^(ammunition|ammo)$/.test(s)) return { documentName: 'Item', type: 'ammo' };
    if (/^(weapon accessories|firearm accessories|armor modifications|vehicle modifications)$/.test(s)) return { documentName: 'Item', type: 'modification', sub: s };
    if (/^(armor|armour|clothing and armor)$/.test(s)) return { documentName: 'Item', type: 'armor' };
    if (/^(drones?|vehicles?|groundcraft|watercraft|aircraft|bikes|cars|trucks|rotorcraft|vtol\/vstol|anthroform drones)$/.test(s)) return { documentName: 'Actor', type: 'vehicle', sub: s };
    if (/^(spirits?)$/.test(s)) return { documentName: 'Actor', type: 'spirit' };
    if (/^(sprites?)$/.test(s)) return { documentName: 'Actor', type: 'sprite' };
    if (/^(critters?|paracritters?)$/.test(s)) return { documentName: 'Actor', type: 'character', hint: { critter: true } };
    const weapon = weaponProfile(s);
    if (weapon && /s$|weapons|explosives|blades|clubs|bows|crossbows/.test(s) && s.split(' ').length <= 4) {
        return { documentName: 'Item', type: 'weapon', sub: s };
    }
    return null;
}
