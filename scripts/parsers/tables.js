/**
 * Parse gear tables from rulebooks and PDFs, one record per row:
 *
 *   HEAVY PISTOLS        ACC   DAMAGE  AP  MODE  RC  AMMO    AVAIL  COST
 *   Ares Predator V      5(7)  8P      -1  SA    -   15(c)   5R     725¥
 */
import { tidyName } from './common.js';
import { sectionHeading, weaponProfile, vehicleTypeFromText, isBioware, isArmorName } from './types.js';
import { vehicleFromColumns } from './statblock.js';

const NUM = String.raw`\d+(?:[.,]\d+)*`;
const DASH = String.raw`[-–—]`;
const RATING_X = String.raw`\(?\s*Rating\s*[x×*]\s*${NUM}\s*\)?`;

const COLUMN_PATTERNS = {
    accuracy: String.raw`(?:${NUM}\s*\(\s*${NUM}\s*\)|${NUM}|Physical(?:\s*\(\s*\d+\s*\))?|${DASH})`,
    damage: String.raw`(?:\(?\s*(?:STR|Str)\s*[+]\s*\d+\s*\)?\s*[PS](?:\s*\(\s*\w+\s*\))?|\d+\s*[PS](?:\s*\(\s*\w+\s*\))?(?:\s*,\s*-?\d+\s*\/\s*m)?|As\s+\w+|Special|${DASH})`,
    ap: String.raw`(?:[+-]?\d+|${DASH}|-half|Special)`,
    mode: String.raw`(?:(?:SS|SA|BF|FA)(?:\s*\/\s*(?:SS|SA|BF|FA))*|${DASH})`,
    rc: String.raw`(?:\d+\s*\(\s*\d+\s*\)|\d+|${DASH})`,
    ammo: String.raw`(?:\d+\s*\(\s*[a-z]+\s*\)(?:\s*(?:or|\/)\s*\d+\s*\(\s*[a-z]+\s*\))?|${DASH})`,
    reach: String.raw`(?:\d+|${DASH})`,
    avail: String.raw`(?:\+?\d+\s*[RF]?|${RATING_X}\s*[RF]?|\(?Rating\)?\s*[RF]?|${DASH})`,
    cost: String.raw`(?:${RATING_X}\s*¥?|${NUM}\s*¥?(?:\s*\+)?|Varies|Special|${DASH})`,
    armor: String.raw`(?:\+?\d+|${DASH})`,
    rating: String.raw`(?:\d+\s*-\s*\d+|\d+|${DASH})`,
    capacity: String.raw`(?:\[?\s*${RATING_X}\s*\]?|\[?\s*\d+\s*\]?|${DASH})`,
    essence: String.raw`(?:${RATING_X}|\d*\.\d+|\d+|${DASH})`,
    handling: String.raw`(?:\d+\s*\/\s*\d+|\d+|${DASH})`,
    speed: String.raw`(?:\d+\s*\/\s*\d+|\d+|${DASH})`,
    accel: String.raw`(?:\d+\s*\/\s*\d+|\d+|${DASH})`,
    body: String.raw`(?:\d+|${DASH})`,
    pilot: String.raw`(?:\d+|${DASH})`,
    sensor: String.raw`(?:\d+|${DASH})`,
    seats: String.raw`(?:\d+(?:\s*\/\s*\d+)?|${DASH})`,
    data_processing: String.raw`(?:\d+|${DASH})`,
    firewall: String.raw`(?:\d+|${DASH})`,
    attributearray: String.raw`(?:\d+\s+\d+\s+\d+\s+\d+)`,
    programs: String.raw`(?:\d+|${DASH})`,
    quantity: String.raw`(?:\d+|${DASH})`,
    karma: String.raw`(?:[+-]?\d+(?:\s*(?:to|-|–)\s*\d+)?(?:\s*Karma)?(?:\s*(?:per|\/)\s*(?:level|rating))?|${DASH})`,
};

const HEADER_WORDS = [
    [/^acc(uracy)?$/, 'accuracy'], [/^(damage|dv|dam)$/, 'damage'], [/^ap$/, 'ap'], [/^modes?$/, 'mode'],
    [/^rc$/, 'rc'], [/^ammo$/, 'ammo'], [/^reach$/, 'reach'], [/^avail(ability)?$/, 'avail'], [/^(cost|price)$/, 'cost'],
    [/^armou?r$/, 'armor'], [/^rating$/, 'rating'], [/^(capacity|cap)$/, 'capacity'], [/^(essence|ess)$/, 'essence'],
    [/^handl(ing)?$/, 'handling'], [/^speed$/, 'speed'], [/^accel(eration)?$/, 'accel'], [/^(bod|body)$/, 'body'],
    [/^pilot$/, 'pilot'], [/^sensors?$/, 'sensor'], [/^seats$/, 'seats'], [/^firewall$/, 'firewall'],
    [/^programs$/, 'programs'], [/^(qty|quantity)$/, 'quantity'], [/^karma$/, 'karma'],
];

const MULTIWORD = [
    [/device\s+rating/i, 'rating'], [/data\s+processing/i, 'data_processing'], [/attribute\s+array/i, 'attributearray'],
    [/max\.?\s+rating/i, 'rating'],
];

/**
 * @returns {{columns: string[], label: string}|null}
 */
export function parseTableHeader(line) {
    let s = String(line ?? '').trim();
    // Header rows are column names only: no "Label:" pairs, no sentences.
    if (!s || s.length > 160 || /:/.test(s) || /[.!?]$/.test(s)) return null;
    for (const [re, key] of MULTIWORD) s = s.replace(re, `§${key}§`);
    const tokens = s.split(/\s+/);
    const columns = [];
    let firstColumnIndex = -1;
    tokens.forEach((t, i) => {
        const m = /^§(\w+)§$/.exec(t);
        const key = m ? m[1] : HEADER_WORDS.find(([re]) => re.test(t.toLowerCase().replace(/[^a-z]/g, '')))?.[1];
        if (key) {
            if (firstColumnIndex < 0) firstColumnIndex = i;
            columns.push(key);
        } else if (firstColumnIndex >= 0) {
            columns.push('?');
        }
    });
    // "ARMOR ARMOR CAPACITY ..." – the first word is the table label, not a column.
    let label0 = '';
    const firstKey = columns[0];
    if (firstKey && firstKey !== '?' && columns.indexOf(firstKey, 1) > 0) { columns.shift(); label0 = tokens[firstColumnIndex]; firstColumnIndex++; }
    const known = columns.filter(c => c !== '?');
    // Need avail/cost or 3+ stat columns to be a table, and the unknown columns must be rare.
    // "QUALITY KARMA" tables only have one stat column.
    const karmaTable = known.length === 1 && known[0] === 'karma' && firstColumnIndex > 0 && !/\d/.test(s) && tokens.length <= 5;
    if (!karmaTable && (known.length < 3 || columns.filter(c => c === '?').length > 1)) return null;
    if (!karmaTable && !known.includes('avail') && !known.includes('cost') && known.length < 4) return null;
    const label = (tokens.slice(0, firstColumnIndex).join(' ') || label0).replace(/§/g, '');
    return { columns: columns.filter(c => c !== '?'), label };
}

function rowRegex(columns) {
    const parts = columns.map(c => `(${COLUMN_PATTERNS[c] ?? '\\S+'})`);
    return new RegExp(String.raw`^(.+?)\s+` + parts.join(String.raw`\s+`) + String.raw`\s*$`, 'i');
}

function tableKind(columns, label) {
    const c = new Set(columns);
    if (c.has('handling') || c.has('speed') || c.has('pilot')) return { documentName: 'Actor', type: 'vehicle' };
    if (c.has('damage') || c.has('mode') || c.has('reach')) return { documentName: 'Item', type: 'weapon' };
    if (c.has('essence')) return { documentName: 'Item', type: /bio|cultured|genetic/i.test(label) ? 'bioware' : 'cyberware' };
    if (c.has('data_processing') || c.has('attributearray')) return { documentName: 'Item', type: 'device' };
    if (c.has('armor')) return { documentName: 'Item', type: 'armor' };
    if (c.has('karma')) return { documentName: 'Item', type: 'quality', hint: /neg/i.test(label) ? { qualityType: 'negative' } : /pos/i.test(label) ? { qualityType: 'positive' } : {} };
    const heading = sectionHeading(label);
    if (heading) return { documentName: heading.documentName, type: heading.type, hint: heading.hint };
    return { documentName: 'Item', type: 'equipment' };
}

/**
 * Parse table rows starting at the header line.
 * @param {string[]} lines all lines of the chunk
 * @param {number} start index of the header line
 * @param {object} context { sub, hint, defaultType }
 * @returns {{records: object[], end: number, skipped: string[]}}
 */
export function parseTable(lines, start, context = {}) {
    const header = parseTableHeader(lines[start]);
    const records = [];
    const skipped = [];
    if (!header) return { records, end: start, skipped };
    const re = rowRegex(header.columns);
    const kind = tableKind(header.columns, `${header.label} ${context.sub ?? ''}`);
    let sub = header.label || context.sub || '';
    let pendingName = '';
    let i = start + 1;
    let misses = 0;

    for (; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            if (!records.length) continue;
            // After a gap the table continues only if a row (optionally under a sub-heading) follows.
            const next = [];
            for (let k = i + 1; k < lines.length && next.length < 2; k++) if (lines[k].trim()) next.push(lines[k].trim());
            const continues = next[0] && (re.test(next[0]) || (!/\d/.test(next[0]) && next[1] && re.test(next[1])));
            if (!continues) break;
            continue;
        }
        if (parseTableHeader(line)) break; // next table
        let m = re.exec(pendingName ? `${pendingName} ${line}` : line);
        if (!m && i + 1 < lines.length) {
            // Name wrapped onto two lines.
            const joined = `${line} ${lines[i + 1].trim()}`;
            const m2 = re.exec(joined);
            if (m2 && !re.exec(lines[i + 1].trim())) { m = m2; i++; }
        }
        if (m) {
            misses = 0;
            const name = tidyName(m[1].replace(/\s*\.{2,}\s*/g, ' ').trim());
            pendingName = '';
            const fields = {};
            header.columns.forEach((col, idx) => { fields[col] = m[idx + 2].trim(); });
            if (sub && kind.type !== 'quality') fields.category = sub;
            records.push(makeRecord(kind, name, fields, context, sub));
            continue;
        }
        // Sub-heading inside the table ("Hold-Outs", "Tasers").
        if (!/\d/.test(line) && line.split(/\s+/).length <= 5) {
            const heading = sectionHeading(line);
            if (heading || line === line.toUpperCase() || /s$/.test(line)) {
                sub = line;
                continue;
            }
            pendingName = pendingName ? `${pendingName} ${line}` : line;
            continue;
        }
        // Row with a missing or extra column: read it by value shape instead.
        const loose = parseLooseRow(line, kind.type);
        if (loose && kind.documentName === 'Item') {
            misses = 0;
            if (sub && !loose.fields.category) loose.fields.category = sub;
            records.push(makeRecord({ ...kind, type: loose.type }, tidyName(loose.name), loose.fields, context, sub));
            continue;
        }
        misses++;
        skipped.push(line);
        if (misses > 2) break;
    }
    return { records, end: i, skipped };
}

function makeRecord(kind, name, fields, context, sub) {
    if (kind.documentName === 'Actor' && kind.type === 'vehicle') {
        const vehicle = vehicleFromColumns(Object.keys(fields), Object.values(fields));
        vehicle.vehicleType = vehicleTypeFromText(`${name} ${sub}`);
        vehicle.isDrone = /drone/i.test(`${sub} ${name}`) || vehicle.seats === undefined;
        return {
            documentName: 'Actor', type: 'vehicle', name,
            fields: { vehicle, attributes: {}, initiative: {} }, skills: [], children: [], warnings: [], raw: '',
        };
    }
    let type = kind.type;
    if (type === 'cyberware' && isBioware(`${name} ${sub}`)) type = 'bioware';
    if (type === 'weapon' && !weaponProfile(`${sub} ${name}`) && !fields.reach && !fields.mode) {
        // Leave it as weapon; the builder will warn about the guessed skill.
    }
    return {
        documentName: 'Item', type, name, fields,
        hint: { ...(kind.hint ?? {}), ...(context.hint ?? {}) }, warnings: [], raw: '',
    };
}

/* ------------------------------------------------------------------ */
/* Rows without a header line                                         */
/* ------------------------------------------------------------------ */

const LOOSE_STAT = /^(?:[+-]?\d+(?:[.,]\d+)*(?:\([\w.]+\))?[PSRF]?(?:\([a-z]+\))?¥?\+?|\(?(?:STR|BOD|MAG|F)[+\-x×*\/]\d+\)?[PS](?:\([a-z]+\))?|[-–—]|(?:SS|SA|BF|FA)(?:\/(?:SS|SA|BF|FA))*|\[\+?\d+\]|Physical(?:\(\d+\))?|Rating(?:[x×*][\d.,]+)?¥?[RF]?)$/i;
const DAMAGE_TOKEN = /^(?:\d+[PS]|\(?(?:STR|BOD|MAG|F)[+\-x×*\/]\d+\)?[PS])(?:\([a-z]+\))?$/i;
const AVAIL_TOKEN = /^(?:\+?\d+[RF]?|[-–—]|Rating[RF]?)$/i;
const COST_TOKEN = /¥|^\d{1,3}(?:,\d{3})+\+?$|^\d{3,}\+?$|^Rating[x×*]/i;

/** Join pieces PDFs and books split with spaces: "(STR + 5)P", "5 (7)", "15 (c)", "4,000 ¥", "Rating x 2". */
function compactRow(line) {
    return String(line ?? '').trim()
        .replace(/\(\s*(STR|Str|BOD|MAG|F)\s*([+\-x×*\/])\s*(\d+)\s*\)\s*([PS])/g, '($1$2$3)$4')
        .replace(/(\d)\s+\(\s*([\w.]+)\s*\)/g, '$1($2)')
        .replace(/(\d)\s+¥/g, '$1¥')
        .replace(/Rating\s*[x×*]\s*/gi, 'Ratingx');
}

/**
 * Read one gear row with no header line: "Combat axe 4 2 (STR + 5)P -4 12R 4,000¥".
 * Values are recognised by their shape (damage code, AP, availability, cost) rather than by column.
 * @param {string} line
 * @param {string} [type] system type expected from context (weapon, armor, cyberware, ...)
 * @returns {{name: string, type: string, fields: object}|null} null when the line has no stats
 */
export function parseLooseRow(line, type) {
    const tokens = compactRow(line).split(/\s+/).filter(Boolean);
    let i = tokens.length;
    while (i > 1 && LOOSE_STAT.test(tokens[i - 1])) i--;
    const name = tokens.slice(0, i).join(' ');
    const vals = tokens.slice(i);
    if (!name || !/[A-Za-z]/.test(name) || vals.length < 2) return null;

    const fields = {};
    // Cost, then availability, from the end.
    if (vals.length && COST_TOKEN.test(vals[vals.length - 1])) fields.cost = vals.pop().replace(/^Ratingx/i, 'Rating x ');
    if (fields.cost !== undefined && vals.length && AVAIL_TOKEN.test(vals[vals.length - 1])) fields.avail = vals.pop();

    const dmgIdx = vals.findIndex(v => DAMAGE_TOKEN.test(v));
    let kind = type;
    if (dmgIdx >= 0 && (!kind || kind === 'weapon' || kind === 'equipment')) kind = 'weapon';

    if (kind === 'weapon' && dmgIdx >= 0) {
        const before = vals.slice(0, dmgIdx);
        const after = vals.slice(dmgIdx + 1);
        fields.damage = vals[dmgIdx];
        if (before[0] !== undefined) fields.accuracy = before[0];
        if (before[1] !== undefined) fields.reach = before[1];
        if (after.length && /^(?:[+-]?\d+|[-–—])$/.test(after[0])) fields.ap = after.shift();
        for (const v of after) {
            if (/^(?:SS|SA|BF|FA)(?:\/(?:SS|SA|BF|FA))*$/i.test(v)) fields.mode = v;
            else if (/^\d+\([a-z]+\)$/i.test(v)) fields.ammo = v;
            else if (fields.rc === undefined && /^(?:\d+(?:\(\d+\))?|[-–—])$/.test(v)) fields.rc = v;
        }
        return { name, type: 'weapon', fields };
    }
    if (dmgIdx >= 0 && kind === 'ammo') {
        fields.damage = vals[dmgIdx];
        if (vals[dmgIdx + 1] !== undefined) fields.ap = vals[dmgIdx + 1];
        return { name, type: kind, fields };
    }

    if (!kind) {
        // No type from context: decide from the values and the name.
        if (fields.cost === undefined) return null;
        if (vals.some(v => /^\d*\.\d+$/.test(v))) kind = 'cyberware';           // fractional essence
        else if (isArmorName(name) && vals.length >= 1) kind = 'armor';         // "Berwick Suit 9 5 9 2,600¥"
        else kind = 'equipment';                                                // "Medkit 6 6 1,500¥"
    }
    const nums = vals;
    const order = {
        armor: ['armor', 'capacity'],
        cyberware: ['essence', 'capacity'],
        bioware: ['essence', 'capacity'],
        device: ['rating', 'data_processing', 'firewall'],
        program: ['rating'],
        equipment: ['rating'],
        modification: ['rating'],
        ammo: ['damage', 'ap'],
    }[kind];
    (order ?? ['rating']).forEach((key, n) => {
        const v = nums[n];
        if (v !== undefined && !/^[-–—]$/.test(v)) fields[key] = v.replace(/^\[|\]$/g, '');
    });
    if (!Object.keys(fields).length) return null;
    return { name, type: kind, fields };
}
