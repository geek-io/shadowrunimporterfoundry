/**
 * Matrix hosts, as printed in adventures:
 *
 *   HOST: JOSE'S BISTRO
 *   Rating Attack Sleaze Data Proc. Firewall
 *   4 4 5 6 7
 *   Installed IC: Blaster, Crash, Scramble
 *   Slaved Devices: Cameras, door locks, POS system
 *   Sculpting: An outdoor market
 *   Security Procedures: Normally no IC running. When an intruder ...
 *   Pay Data: There are data files on the host ...
 *
 * Hosts are items in the SR5 system. Labeled lines may wrap over several lines (PDF copies).
 */
import { tidyName, toNumber } from './common.js';

const HOST_TITLE = /^host\s*[:–—-]\s*(\S.*)$/i;
const STAT_WORDS = [
    [/^(?:host\s+)?rating$/i, 'rating'], [/^(?:attack|att|a)$/i, 'attack'], [/^(?:sleaze|slz|s)$/i, 'sleaze'],
    [/^(?:data\s*proc(?:essing|\.)?|data\s*processing|d\/?p)$/i, 'data_processing'], [/^(?:firewall|fw|f)$/i, 'firewall'],
];

/** Known labels, in the order they are usually printed. Other "Label: text" lines are kept too. */
const LABELS = [
    ['ic', /^(?:installed\s+|patrolling\s+)?ic\s*:\s*/i, 'Installed IC'],
    ['slaved', /^slaved\s+(?:devices?|to)?\s*:\s*/i, 'Slaved Devices'],
    ['sculpting', /^sculpting\s*:\s*/i, 'Sculpting'],
    ['security', /^security(?:\s+procedures?)?\s*:\s*/i, 'Security Procedures'],
    ['paydata', /^pay\s*-?\s*data\s*:\s*/i, 'Pay Data'],
    ['spiders', /^spiders?\s*:\s*/i, 'Spiders'],
    ['files', /^files?\s*:\s*/i, 'Files'],
    ['description', /^description\s*:\s*/i, 'Description'],
    ['notes', /^notes?\s*:\s*/i, 'Notes'],
];
const GENERIC_LABEL = /^([A-Z][A-Za-z'’/&-]*(?:\s+[A-Za-z'’/&-]+){0,3})\s*:\s*(.*)$/;

/** "Rating Attack Sleaze Data Proc. Firewall" → ['rating','attack','sleaze','data_processing','firewall'] */
export function hostTableColumns(line) {
    const s = String(line ?? '').trim().replace(/\.(?=[A-Z])/g, '. ').replace(/\bdata\s+proc(?:essing|\.)?/i, 'DATAPROC').replace(/\bhost\s+rating\b/i, 'Rating');
    if (!s || s.length > 90 || /\d/.test(s)) return null;
    const cols = [];
    for (const tok of s.split(/\s+/)) {
        const t = tok === 'DATAPROC' ? 'data proc' : tok;
        const hit = STAT_WORDS.find(([re]) => re.test(t));
        if (!hit) return null;
        cols.push(hit[1]);
    }
    const named = new Set(cols);
    // Must name the matrix attributes in full ("A S D F" alone is too ambiguous).
    if (!(named.has('attack') && named.has('sleaze') && named.has('firewall') && named.has('data_processing'))) return null;
    if (!/attack/i.test(s) || !/firewall/i.test(s)) return null;
    return cols;
}

function labelOf(line) {
    for (const [key, re, label] of LABELS) {
        const m = re.exec(line);
        if (m) return { key, label, text: line.slice(m[0].length).trim() };
    }
    const g = GENERIC_LABEL.exec(line);
    if (g && !/^https?$/i.test(g[1])) return { key: 'other', label: g[1].trim(), text: g[2].trim() };
    return null;
}

/** "Rating 4, Attack 4, Sleaze 5, Data Processing 6, Firewall 7" on one line. */
function inlineStats(line) {
    const out = {};
    const re = /\b(host\s+rating|rating|attack|sleaze|data\s*proc(?:essing|\.)?|firewall)\b\s*:?\s*(\d+)/gi;
    for (const m of line.matchAll(re)) {
        const k = /rating/i.test(m[1]) ? 'rating' : /attack/i.test(m[1]) ? 'attack' : /sleaze/i.test(m[1]) ? 'sleaze' : /firewall/i.test(m[1]) ? 'firewall' : 'data_processing';
        out[k] ??= m[2];
    }
    return Object.keys(out).length >= 3 ? out : null;
}

function isHeading(t) {
    // An all-caps heading such as "ACCOMPLICES" or "DOCWAGON RESPONSE TEAM" starts something else.
    return /[A-Z]{3}/.test(t) && !/[a-z]/.test(t) && !/:/.test(t) && t.split(/\s+/).length <= 7 && !/^\d/.test(t);
}

const nextIndex = (lines, i, limit = 4) => {
    for (let j = i + 1, seen = 0; j < lines.length && seen < limit; j++) {
        if (lines[j].trim()) return j;
    }
    return -1;
};

/**
 * Host blocks in a run of lines.
 * @param {string[]} lines
 * @param {{isStart?: (line:string)=>boolean}} [stop] extra "something else starts here" test
 * @returns {{start:number, end:number}[]}
 */
export function findHostBlocks(lines, stop = {}) {
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (!t) continue;
        let start = -1;
        if (HOST_TITLE.test(t)) {
            // "Host: Name" followed by its table, stats or host labels.
            let j = i;
            for (let n = 0; n < 4; n++) {
                j = nextIndex(lines, j);
                if (j < 0) break;
                const u = lines[j].trim();
                if (hostTableColumns(u) || inlineStats(u) || (labelOf(u) && LABELS.some(([k, re]) => k !== 'description' && k !== 'notes' && re.test(u)))) { start = i; break; }
            }
        } else if (hostTableColumns(t)) {
            // A table with its name on the line above ("JOSE'S BISTRO" / "Host" above the table).
            const p = (() => { for (let k = i - 1; k >= 0 && k >= i - 2; k--) if (lines[k].trim()) return k; return -1; })();
            start = p >= 0 && !blocks.some(b => b.end > p) && lines[p].trim().length <= 60 && !labelOf(lines[p].trim()) ? p : i;
        }
        if (start < 0 || blocks.some(b => start < b.end)) continue;
        const end = hostBlockEnd(lines, start, stop);
        blocks.push({ start, end });
        i = end - 1;
    }
    return blocks;
}

function hostBlockEnd(lines, start, stop) {
    let sawContent = false;
    let lastText = '';
    for (let j = start + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (!t) {
            // A blank line ends the host unless the next line carries on a label or a sentence.
            const k = nextIndex(lines, j, 99);
            if (k < 0) return lines.length;
            const next = lines[k].trim();
            const carries = labelOf(next) && !isHeading(next) && !stop.isStart?.(next) && !HOST_TITLE.test(next) && hostLike(next)
                || (/^[a-z(]/.test(next) && !/[.!?]$/.test(lastText));
            if (!carries) return j;
            continue;
        }
        if (HOST_TITLE.test(t) || isHeading(t) || stop.isStart?.(t)) {
            if (sawContent) return j;
        }
        if (hostTableColumns(t) && sawContent && j > start + 1) return j;
        sawContent = true;
        lastText = t;
    }
    return lines.length;
}

/** Labels that belong to hosts (generic labels count only when another host line follows). */
function hostLike(line) {
    return LABELS.some(([, re]) => re.test(line)) || !!inlineStats(line);
}

/** Parse one host block into an import record. */
export function parseHostBlock(lines) {
    const f = { sections: [] };
    const warnings = [];
    let name = '';
    let i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    const first = (lines[i] ?? '').trim();
    const title = HOST_TITLE.exec(first);
    if (title) { name = title[1]; i++; }
    else if (!hostTableColumns(first)) { name = first.replace(/^host\s*/i, ''); i++; }

    let current = null;
    for (; i < lines.length; i++) {
        const t = lines[i].trim();
        if (!t) continue;
        const cols = hostTableColumns(t);
        if (cols) {
            const v = nextIndex(lines, i);
            const vals = v >= 0 ? lines[v].trim().split(/\s+/) : [];
            if (vals.length >= cols.length && vals.slice(0, cols.length).every(x => /^\d+$/.test(x))) {
                cols.forEach((c, n) => { f[c] = vals[n]; });
                i = v;
            } else warnings.push('Host table values not found under the Rating/Attack/Sleaze/Data Processing/Firewall header.');
            current = null;
            continue;
        }
        const stats = !current || labelOf(t) ? inlineStats(t) : null;
        if (stats && !labelOf(t)?.key?.match(/^(ic|slaved|sculpting|security|paydata|spiders|files|description|notes)$/)) {
            for (const [k, v] of Object.entries(stats)) f[k] ??= v;
            current = null;
            continue;
        }
        const lab = labelOf(t);
        if (lab && (lab.key !== 'other' || !current || /[.!?]$/.test(current.text) || lab.label.split(/\s+/).length <= 3)) {
            current = { key: lab.key, label: lab.label, text: lab.text };
            f.sections.push(current);
            continue;
        }
        if (current) { current.text = joinWrapped(current.text, t); continue; }
        // Text before any label: the host's description.
        f.sections.push(current = { key: 'description', label: '', text: t });
    }

    for (const s of f.sections) {
        if (s.key === 'ic') f.ic = s.text.replace(/\.$/, '').split(/\s*,\s*|\s+and\s+/).map(x => x.trim()).filter(Boolean);
        if (s.key === 'rating' || /^(host\s+)?rating$/i.test(s.label)) f.rating ??= String(toNumber(s.text));
    }
    if (f.rating === undefined) warnings.push('No host rating found.');
    return {
        documentName: 'Item', type: 'host', name: tidyName(name || 'Host'), fields: f, hint: {}, warnings,
        raw: lines.join('\n'),
    };
}

function joinWrapped(a, b) {
    if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
    return `${a} ${b}`;
}
