/**
 * Shared helpers for the SR5 importer parsers.
 *
 * Everything in /scripts/parsers is plain JavaScript with no Foundry globals,
 * so the parsers can be tested in Node.
 */

export const ATTRIBUTE_ALIASES = {
    b: 'body', bod: 'body', body: 'body',
    a: 'agility', agi: 'agility', agility: 'agility',
    r: 'reaction', rea: 'reaction', reaction: 'reaction',
    s: 'strength', str: 'strength', strength: 'strength',
    w: 'willpower', wil: 'willpower', willpower: 'willpower',
    l: 'logic', log: 'logic', logic: 'logic',
    i: 'intuition', int: 'intuition', intuition: 'intuition',
    c: 'charisma', cha: 'charisma', charisma: 'charisma',
    edg: 'edge', edge: 'edge', e: 'edge',
    ess: 'essence', essence: 'essence',
    m: 'magic', mag: 'magic', magic: 'magic',
    res: 'resonance', resonance: 'resonance',
    f: 'force', force: 'force',
    lvl: 'level', level: 'level', rating: 'rating',
    att: 'attack', attack: 'attack',
    slz: 'sleaze', sleaze: 'sleaze',
    dp: 'data_processing', 'data processing': 'data_processing', dataprocessing: 'data_processing', 'data proc': 'data_processing',
    fwl: 'firewall', fw: 'firewall', firewall: 'firewall',
    init: 'initiative', ini: 'initiative',
};

export const ACTIVE_SKILLS = [
    'archery', 'automatics', 'blades', 'clubs', 'exotic_melee_weapon', 'exotic_ranged_weapon', 'heavy_weapons',
    'longarms', 'pistols', 'throwing_weapons', 'unarmed_combat', 'disguise', 'diving', 'escape_artist', 'flight',
    'free_fall', 'gymnastics', 'palming', 'perception', 'running', 'sneaking', 'survival', 'swimming', 'tracking',
    'con', 'etiquette', 'impersonation', 'instruction', 'intimidation', 'leadership', 'negotiation', 'performance',
    'alchemy', 'arcana', 'artificing', 'assensing', 'astral_combat', 'banishing', 'binding', 'counterspelling',
    'disenchanting', 'ritual_spellcasting', 'spellcasting', 'summoning', 'compiling', 'decompiling', 'registering',
    'aeronautics_mechanic', 'automotive_mechanic', 'industrial_mechanic', 'nautical_mechanic', 'animal_handling',
    'armorer', 'artisan', 'biotechnology', 'chemistry', 'computer', 'cybercombat', 'cybertechnology', 'demolitions',
    'electronic_warfare', 'first_aid', 'forgery', 'hacking', 'hardware', 'locksmith', 'medicine', 'navigation',
    'software', 'gunnery', 'pilot_aerospace', 'pilot_aircraft', 'pilot_walker', 'pilot_ground_craft',
    'pilot_watercraft', 'pilot_exotic_vehicle',
];

export const SKILL_GROUPS = {
    acting: ['con', 'impersonation', 'performance'],
    athletics: ['gymnastics', 'running', 'swimming'],
    biotech: ['biotechnology', 'cybertechnology', 'first_aid', 'medicine'],
    close_combat: ['blades', 'clubs', 'unarmed_combat'],
    conjuring: ['banishing', 'binding', 'summoning'],
    cracking: ['cybercombat', 'electronic_warfare', 'hacking'],
    electronics: ['computer', 'hardware', 'software'],
    enchanting: ['alchemy', 'artificing', 'disenchanting'],
    engineering: ['aeronautics_mechanic', 'automotive_mechanic', 'industrial_mechanic', 'nautical_mechanic'],
    firearms: ['automatics', 'longarms', 'pistols'],
    influence: ['etiquette', 'leadership', 'negotiation'],
    outdoors: ['navigation', 'survival', 'tracking'],
    sorcery: ['counterspelling', 'ritual_spellcasting', 'spellcasting'],
    stealth: ['disguise', 'palming', 'sneaking'],
    tasking: ['compiling', 'decompiling', 'registering'],
};

export const SKILL_ALIASES = {
    'unarmed': 'unarmed_combat',
    'exotic melee weapon': 'exotic_melee_weapon',
    'exotic ranged weapon': 'exotic_ranged_weapon',
    'heavy weapon': 'heavy_weapons',
    'throwing': 'throwing_weapons',
    'thrown weapons': 'throwing_weapons',
    'assessing': 'assensing',
    'thrown weapon': 'throwing_weapons',
    'throwing weapon': 'throwing_weapons',
    'ritual spellcasting': 'ritual_spellcasting',
    'pilot ground vehicle': 'pilot_ground_craft',
    'pilot groundcraft': 'pilot_ground_craft',
    'pilot ground craft': 'pilot_ground_craft',
    'pilot aircraft': 'pilot_aircraft',
    'pilot watercraft': 'pilot_watercraft',
    'pilot walker': 'pilot_walker',
    'pilot aerospace': 'pilot_aerospace',
    'pilot exotic vehicle': 'pilot_exotic_vehicle',
    'ew': 'electronic_warfare',
    'electronic warfare': 'electronic_warfare',
    'first-aid': 'first_aid',
    'astral combat': 'astral_combat',
    'escape artist': 'escape_artist',
    'free-fall': 'free_fall',
    'free fall': 'free_fall',
    'animal handling': 'animal_handling',
};

/**
 * Normalise a skill name to the SR5 system skill key, or '' when it isn't an active skill.
 */
export function skillKey(name) {
    const clean = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!clean) return '';
    if (SKILL_ALIASES[clean]) return SKILL_ALIASES[clean];
    const key = clean.replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
    if (ACTIVE_SKILLS.includes(key)) return key;
    // Plural / singular forgiveness ("Pistol", "Heavy Weapon", "Blade").
    if (ACTIVE_SKILLS.includes(`${key}s`)) return `${key}s`;
    if (key.endsWith('s') && ACTIVE_SKILLS.includes(key.slice(0, -1))) return key.slice(0, -1);
    return '';
}

/**
 * Clean up text produced by PDF extraction, word processors and the web.
 */
export function normalizeText(text) {
    return String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/ /g, ' ')
        .replace(/[‐-―−﹘﹣－]/g, '-') // all dashes and minus signs
        .replace(/[‘’‚‛]/g, "'")
        .replace(/[“”„‟]/g, '"')
        .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff')
        .replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl')
        .replace(/•|·|●|▪/g, '•') // bullets normalised to •
        .replace(/[ \t]+$/gm, '')
        .replace(/\t/g, '    ');
}

/** "4", "-2", "+1", "0.5", "1,500" → number. Dashes and blanks → fallback. */
export function toNumber(value, fallback = 0) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const s = String(value).trim().replace(/[¥\s]|nuyen/gi, '').replace(/,(?=\d{3}\b)/g, '');
    if (!s || /^[-–—]+$/.test(s)) return fallback;
    const m = /^[+-]?\d+(?:\.\d+)?/.exec(s.replace(/^\+/, ''));
    if (!m) {
        const m2 = /[+-]?\d+(?:\.\d+)?/.exec(s);
        return m2 ? Number(m2[0]) : fallback;
    }
    return Number(s.startsWith('-') && !m[0].startsWith('-') ? `-${m[0]}` : m[0]);
}

/** "5(7)" or "5 (7)" → { base: 5, augmented: 7 } */
export function parseAugmented(value) {
    const s = String(value ?? '').trim();
    const m = /^([+-]?\d+(?:\.\d+)?)\s*(?:\(\s*([+-]?\d+(?:\.\d+)?)\s*\))?/.exec(s);
    if (!m) return { base: toNumber(s), augmented: undefined };
    return { base: Number(m[1]), augmented: m[2] !== undefined ? Number(m[2]) : undefined };
}

/**
 * Parse a damage code such as "8P", "10S(e)", "(STR+2)P", "STR+3P", "12P(f), -2/m", "As drug".
 */
export function parseDamage(value) {
    const out = { damage: 0, type: '', element: '', attribute: '', operator: 'add', dropoff: 0, radius: 0, raw: String(value ?? '') };
    let s = String(value ?? '').trim();
    if (!s || /^[-–—]+$/.test(s)) return out;

    const blast = /(-?\d+)\s*\/\s*m/i.exec(s);
    if (blast) out.dropoff = Number(blast[1]) > 0 ? -Number(blast[1]) : Number(blast[1]);
    const radius = /(\d+)\s*m\s*radius/i.exec(s);
    if (radius) out.radius = Number(radius[1]);

    const element = /\(\s*(e|f|fire|cold|c|acid|a|electricity|elec|water|radiation|pollutant)\s*\)/i.exec(s);
    if (element) out.element = ELEMENT_ALIASES[element[1].toLowerCase()] ?? '';

    const attr = /\(?\s*(STR|BOD|AGI|MAG|FORCE|F|LOG|WIL|CHA|INT|REA)\s*([+\-x*\/]\s*\d+)?\s*\)?\s*([PSM])?/i.exec(s);
    const simple = /(\d+)\s*([PSM])\b/i.exec(s) ?? /^(\d+)\s*([PSM])?/i.exec(s);

    if (simple && (!attr || simple.index <= attr.index)) {
        out.damage = Number(simple[1]);
        out.type = typeLetter(simple[2]);
    } else if (attr) {
        const key = attr[1].toUpperCase();
        out.attribute = { STR: 'strength', BOD: 'body', AGI: 'agility', MAG: 'magic', FORCE: 'force', F: 'force', LOG: 'logic', WIL: 'willpower', CHA: 'charisma', INT: 'intuition', REA: 'reaction' }[key] ?? '';
        if (attr[2]) {
            const op = attr[2].replace(/\s/g, '');
            const n = Number(op.slice(1));
            if (op[0] === '+') out.damage = n;
            else if (op[0] === '-') out.damage = -n;
            else if (op[0] === 'x' || op[0] === '*') { out.damage = n; out.operator = 'multiply'; }
            else if (op[0] === '/') { out.damage = n; out.operator = 'divide'; }
        }
        out.type = typeLetter(attr[3]);
    }
    if (!out.type) out.type = /stun/i.test(s) ? 'stun' : 'physical';
    if (out.dropoff && !out.radius && out.damage) out.radius = Math.round(out.damage / Math.abs(out.dropoff));
    return out;
}

const ELEMENT_ALIASES = {
    e: 'electricity', elec: 'electricity', electricity: 'electricity',
    f: 'fire', fire: 'fire', c: 'cold', cold: 'cold', a: 'acid', acid: 'acid',
    water: 'water', radiation: 'radiation', pollutant: 'pollutant',
};

function typeLetter(letter) {
    const l = String(letter ?? '').toUpperCase();
    if (l === 'S') return 'stun';
    if (l === 'M') return 'matrix';
    if (l === 'P') return 'physical';
    return '';
}

/** "–1", "-", "+2", "-half" → number */
export function parseAP(value) {
    return toNumber(value, 0);
}

/** "SA/BF", "SS", "FA", "SA, BF" → firing mode flags */
export function parseModes(value) {
    const s = String(value ?? '').toUpperCase();
    return {
        single_shot: /\bSS\b/.test(s),
        semi_auto: /\bSA\b/.test(s),
        burst_fire: /\bBF\b/.test(s),
        full_auto: /\bFA\b/.test(s),
    };
}

/** "15(c)", "30 (c)", "2(b)", "100 (belt)" → { count, clip } */
export function parseAmmo(value) {
    const s = String(value ?? '').trim();
    const m = /(\d+)\s*(?:\(\s*([a-z]+)\s*\))?/i.exec(s);
    if (!m) return { count: 0, clip: '' };
    const clipMap = { c: 'removable_clip', b: 'break_action', belt: 'belt_fed', m: 'internal_magazin', ml: 'muzzle_loader', cy: 'cylinder', d: 'drum', s: 'removable_clip' };
    return { count: Number(m[1]), clip: clipMap[(m[2] ?? '').toLowerCase()] ?? (m[2] ? '' : '') };
}

/** "12R", "6F", "—", "4" → availability string as written */
export function parseAvail(value) {
    const s = String(value ?? '').trim();
    if (!s || /^[-–—]+$/.test(s)) return '';
    return s.replace(/\s+/g, '');
}

/** "725¥", "1,500 nuyen", "Rating x 200¥" → number (first number). */
export function parseCost(value) {
    const s = String(value ?? '');
    if (/rating\s*[x×*]/i.test(s)) return toNumber(s.replace(/rating\s*[x×*]\s*/i, ''), 0);
    return toNumber(s, 0);
}

/** "Rating 3", "(Rating 4)", "Device Rating 3", "R3", trailing digit → number|undefined */
export function extractRating(text) {
    const s = String(text ?? '');
    const m = /(?:device\s+)?rating\s*:?\s*(\d+)/i.exec(s) ?? /\bR(\d+)\b/.exec(s) ?? /\(\s*(\d+)\s*\)\s*$/.exec(s) ?? /\s(\d+)\s*$/.exec(s);
    return m ? Number(m[1]) : undefined;
}

/**
 * Split a comma separated list, ignoring commas inside brackets or parentheses.
 * "a (b, c), d [e, f], g" → ["a (b, c)", "d [e, f]", "g"]
 */
export function splitList(text, separators = ',;') {
    const out = [];
    let depth = 0;
    let current = '';
    for (const ch of String(text ?? '')) {
        if ('([{'.includes(ch)) depth++;
        if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
        if (depth === 0 && separators.includes(ch)) {
            if (current.trim()) out.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) out.push(current.trim());
    return out;
}

/** Title-case a SHOUTED name, leave mixed-case names alone. */
export function tidyName(name) {
    let s = String(name ?? '').replace(/\s+/g, ' ').trim().replace(/[:•]+$/, '').trim();
    if (!s) return s;
    const letters = s.replace(/[^A-Za-z]/g, '');
    if (letters && letters === letters.toUpperCase() && letters.length > 2) {
        const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);
        s = s.toLowerCase().split(' ').map((w, i) => {
            if (i > 0 && small.has(w)) return w;
            // Keep roman numerals and known acronyms upper case.
            if (/^(i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(w) || /^(ic|ar|vr|smg|lmg|mmg|hmg|ap|dv|rcc|sin|pan|ai|emp)$/.test(w)) return w.toUpperCase();
            return w.replace(/(^|[-/(])([a-z])/g, (m, p, c) => p + c.toUpperCase());
        }).join(' ');
    }
    return s;
}

/** Normalise names for matching ("Ares Predator V" == "ares predator v"). */
export function matchKey(name) {
    return String(name ?? '')
        .toLowerCase()
        .replace(/\(.*?\)|\[.*?\]/g, ' ')
        .replace(/[’'`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function escapeHTML(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Wrap plain text paragraphs into HTML. */
export function textToHTML(text) {
    const s = String(text ?? '').trim();
    if (!s) return '';
    if (/^\s*<([a-z][a-z0-9]*)[\s>]/i.test(s)) return s; // already HTML
    return s
        .split(/\n\s*\n/)
        .map(p => `<p>${escapeHTML(p.replace(/-\n(?=[a-z])/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())}</p>`)
        .join('');
}

export function slug(text) {
    return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
