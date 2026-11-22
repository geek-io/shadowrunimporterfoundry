/**
 * Canonical field names for loose data (labeled text blocks, bracket lists and simplified JSON).
 */

const FIELD_ALIASES = {
    name: ['name', 'title'],
    type: ['type', 'itemtype', 'kind', 'doctype', 'documenttype'],
    category: ['category', 'cat', 'class', 'weapontype', 'spellcategory'],
    subcategory: ['subcategory', 'subtype', 'sub'],
    accuracy: ['acc', 'accuracy'],
    damage: ['dv', 'dmg', 'damage', 'damagevalue', 'damagecode'],
    ap: ['ap', 'armorpenetration', 'armourpenetration'],
    mode: ['mode', 'modes', 'firingmode', 'firingmodes', 'firemode', 'firemodes'],
    rc: ['rc', 'recoil', 'recoilcompensation'],
    ammo: ['ammo', 'ammunition', 'clip', 'magazine', 'capacityammo'],
    reach: ['reach'],
    blast: ['blast', 'blastradius'],
    avail: ['avail', 'availability'],
    cost: ['cost', 'price'],
    rating: ['rating', 'rtg', 'devicerating', 'level', 'lvl', 'force', 'grade_rating'],
    capacity: ['capacity', 'cap'],
    essence: ['essence', 'ess', 'essencecost'],
    armor: ['armor', 'armour', 'armorrating', 'armourrating', 'armorvalue'],
    conceal: ['conceal', 'concealability', 'concealment'],
    skill: ['skill', 'useskill', 'weaponskill'],
    range: ['range'],
    duration: ['duration', 'dur'],
    drain: ['drain', 'drainvalue', 'drainmodifier'],
    fade: ['fade', 'fv', 'fadevalue'],
    target: ['target', 'targets'],
    karma: ['karma', 'karmacost', 'bonus'],
    pp: ['pp', 'powerpoints', 'powerpointcost', 'ppcost'],
    activation: ['activation', 'action', 'actiontype'],
    descriptors: ['descriptors', 'keywords', 'tags'],
    element: ['element', 'elemental'],
    quantity: ['quantity', 'qty', 'count', 'amount'],
    grade: ['grade', 'waregrade'],
    slots: ['slots', 'slot', 'slotcost', 'mount', 'mountpoint'],
    description: ['description', 'desc', 'text', 'notes', 'note', 'details', 'body', 'effect', 'effects'],
    source: ['source', 'book', 'page', 'reference', 'ref', 'sourcebook'],
    connection: ['connection', 'con'],
    loyalty: ['loyalty', 'loy'],
    attack: ['attack', 'att', 'a'],
    sleaze: ['sleaze', 'slz', 's'],
    data_processing: ['dataprocessing', 'dataproc', 'dp', 'd'],
    firewall: ['firewall', 'fw', 'fwl', 'f'],
    attributes: ['attributes', 'attrs', 'stats'],
    attributearray: ['attributearray', 'array'],
    programs: ['programs', 'programslots'],
    comforts: ['comforts'], security: ['security'], neighborhood: ['neighborhood', 'neighbourhood'], guests: ['guests'],
    handling: ['handling', 'handl', 'hand'], speed: ['speed', 'spd'], acceleration: ['acceleration', 'accel', 'acc_v'],
    body: ['body', 'bod'], pilot: ['pilot'], sensor: ['sensor', 'sensors'], seats: ['seats'],
    img: ['img', 'image', 'icon', 'portrait'],
};

const LOOKUP = new Map();
for (const [canon, aliases] of Object.entries(FIELD_ALIASES)) for (const a of aliases) if (!LOOKUP.has(a)) LOOKUP.set(a, canon);

export function canonicalKey(key) {
    const k = String(key ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/_/g, '');
    return LOOKUP.get(k) ?? String(key ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Map an object's keys onto canonical field names, keeping unknown keys in snake_case. */
export function normalizeFields(obj = {}) {
    const out = {};
    for (const [key, value] of Object.entries(obj ?? {})) {
        if (value === undefined) continue;
        const canon = canonicalKey(key);
        if (out[canon] === undefined || out[canon] === '') out[canon] = value;
    }
    return out;
}

/**
 * Labels recognised at the start of a "Label: value" line in book text.
 * Ordered longest first so "Data Processing" wins over "Data".
 */
export const LINE_LABELS = [
    'Device Rating', 'Data Processing', 'Attribute Array', 'Power Point Cost', 'Power Points', 'Armor Rating',
    'Activation', 'Accuracy', 'Ammunition', 'Availability', 'Avail', 'Capacity', 'Category', 'Concealability', 'Conceal',
    'Connection', 'Cost', 'Damage', 'Descriptors', 'Description', 'Drain', 'Duration', 'Essence', 'Firewall', 'Fade',
    'Grade', 'Karma', 'Bonus', 'Loyalty', 'Mode', 'Modes', 'Name', 'Notes', 'Programs', 'Range', 'Rating', 'Reach', 'Recoil',
    'Sleaze', 'Attack', 'Skill', 'Source', 'Page', 'Target', 'Type', 'Subtype', 'Slots', 'Mount', 'Ammo', 'Action', 'Blast',
    'Quantity', 'Element', 'Handling', 'Speed', 'Accel', 'Body', 'Armor', 'Pilot', 'Sensor', 'Seats', 'Acc', 'DV', 'AP', 'RC',
    'FV', 'PP', 'Ess', 'Cap', 'DP', 'Max Rating', 'Comforts', 'Security', 'Neighborhood', 'Guests',
];

const LABEL_RE = new RegExp(
    `(?:^|\\s{2,}|\\s*[•|;]\\s*|\\s+(?=(?:${LINE_LABELS.map(l => l.replace(/ /g, '\\s+')).join('|')})\\s*:))` +
    `(${LINE_LABELS.map(l => l.replace(/ /g, '\\s+')).join('|')})\\s*:\\s*`,
    'gi',
);

/**
 * Pull "Label: value" pairs out of a line. Multiple pairs per line are supported:
 * "Type: M • Range: LOS • Damage: P" → { type: 'M', range: 'LOS', damage: 'P' }
 * @returns {Record<string,string>|null} null when the line has no recognised label
 */
export function parseLabeledLine(line) {
    const s = String(line ?? '');
    const matches = [...s.matchAll(LABEL_RE)];
    if (!matches.length) return null;
    // The first label must start the line (allowing a leading bullet), otherwise it's prose.
    const first = matches[0];
    if (s.slice(0, first.index).replace(/[•\s|-]/g, '').length > 0) return null;
    const out = {};
    for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const start = m.index + m[0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index : s.length;
        const value = s.slice(start, end).replace(/[•|;]\s*$/, '').trim();
        out[canonicalKey(m[1].replace(/\s+/g, ''))] = value;
    }
    return out;
}

/**
 * Parse compact stat tokens used in NPC gear brackets: "Heavy Pistol, Acc 5(7), DV 8P, AP -1, SA, RC -, 15(c)".
 */
export function parseStatTokens(text) {
    const out = {};
    const extra = [];
    const parts = String(text ?? '').split(/\s*[,|]\s*/).filter(Boolean);
    for (const raw of parts) {
        const p = raw.trim();
        let m;
        if ((m = /^acc(?:uracy)?\s*:?\s*(.+)$/i.exec(p))) out.accuracy = m[1];
        else if ((m = /^(?:dv|dmg|damage)\s*:?\s*(.+)$/i.exec(p))) out.damage = m[1];
        else if ((m = /^ap\s*:?\s*(.+)$/i.exec(p))) out.ap = m[1];
        else if ((m = /^rc\s*:?\s*(.+)$/i.exec(p))) out.rc = m[1];
        else if ((m = /^reach\s*:?\s*(.+)$/i.exec(p))) out.reach = m[1];
        else if ((m = /^(?:ammo|ammunition)\s*:?\s*(.+)$/i.exec(p))) out.ammo = m[1];
        else if ((m = /^(?:avail|availability)\s*:?\s*(.+)$/i.exec(p))) out.avail = m[1];
        else if ((m = /^cost\s*:?\s*(.+)$/i.exec(p))) out.cost = m[1];
        else if ((m = /^(?:device\s+)?rating\s*:?\s*(\d+)/i.exec(p))) out.rating = m[1];
        else if ((m = /^(?:ess|essence)\s*:?\s*(.+)$/i.exec(p))) out.essence = m[1];
        else if ((m = /^(?:capacity|cap)\s*:?\s*(.+)$/i.exec(p))) out.capacity = m[1];
        else if ((m = /^blast\s*:?\s*(.+)$/i.exec(p))) out.blast = m[1];
        else if ((m = /^(?:armor|armour)\s*:?\s*([+-]?\d+)/i.exec(p))) out.armor = m[1];
        else if ((m = /^(?:dp|data\s*processing)\s*:?\s*(\d+)/i.exec(p))) out.data_processing = m[1];
        else if ((m = /^(?:fw|firewall)\s*:?\s*(\d+)/i.exec(p))) out.firewall = m[1];
        else if ((m = /^(?:attack)\s*:?\s*(\d+)/i.exec(p))) out.attack = m[1];
        else if ((m = /^(?:sleaze)\s*:?\s*(\d+)/i.exec(p))) out.sleaze = m[1];
        else if (/^(SS|SA|BF|FA)(\s*\/\s*(SS|SA|BF|FA))*$/i.test(p)) out.mode = p;
        else if (/^\d+\s*\(\s*(c|b|m|ml|cy|d|belt|s)\s*\)$/i.test(p)) out.ammo = p;
        else if (/^\d+[PS](\s*\(\w+\))?$/i.test(p)) out.damage = p;
        else if (/^[+-]?\d+$/.test(p) && out.rating === undefined && !parts.some(x => /^acc/i.test(x))) out.rating = p;
        else if (/^w\/|^with\b/i.test(p)) extra.push(p);
        else extra.push(p);
    }
    if (extra.length) {
        // First free word is usually the category ("Heavy Pistol"), the rest are accessories / notes.
        if (!out.category && extra[0] && !/^w\//i.test(extra[0])) out.category = extra.shift();
        if (extra.length) out.notes = extra.join(', ');
    }
    return out;
}
