/**
 * Contact cards, as printed in adventure handouts:
 *
 *   Matt grew up as a kid inside the containment zone ...   (description paragraph)
 *
 *   MATT WRATH
 *   Adept Pit Fighter
 *   Male Elf
 *
 *   Connection Rating: 2
 *   Loyalty:
 *   Key Active Skills: Animal Handling (Devil Rat), Blades, ...
 *   Knowledge Skills: Boxing, ...
 *   Uses: Street Rumors, Muscle, Fight Tickets
 *
 * Each card becomes a contact item. The description may also come after the labels.
 */
import { tidyName } from './common.js';

const CONNECTION = /^connection(?:\s+rating)?\s*:\s*(\d+)?\s*$/i;
const LABEL = /^(connection(?:\s+rating)?|loyalty|key\s+active\s+skills|active\s+skills|knowledge\s+skills|skills|uses|languages|metatype|archetype|type|qualities)\s*:\s*(.*)$/i;
const isCapsName = t => !!t && t.length <= 40 && /[A-Z]{2}/.test(t) && !/[a-z]/.test(t) && !/[:[\]()]/.test(t) && t.split(/\s+/).length <= 5;

const prevContent = (lines, i, stopAtBlank = false) => {
    for (let j = i - 1; j >= 0; j--) {
        if (lines[j].trim()) return j;
        if (stopAtBlank) return -1;
    }
    return -1;
};

/**
 * @param {string[]} lines
 * @returns {{start:number, end:number, record:object}[]}
 */
export function findContactCards(lines) {
    const cards = [];
    for (let i = 0; i < lines.length; i++) {
        if (!CONNECTION.test(lines[i].trim())) continue;
        // The name: a capitalised line a few lines above, with the role and metatype under it.
        let nameIdx = -1;
        const header = [];
        for (let j = prevContent(lines, i), n = 0; j >= 0 && n < 4; j = prevContent(lines, j), n++) {
            const t = lines[j].trim();
            if (LABEL.test(t)) break;
            if (isCapsName(t)) { nameIdx = j; break; }
            header.unshift(t);
        }
        if (nameIdx < 0 || header.length > 3 || header.some(t => t.length > 60)) continue;
        if (cards.some(c => nameIdx < c.end)) continue;

        // Description: the paragraph right above the name.
        let start = nameIdx;
        const desc = [];
        let d = prevContent(lines, nameIdx);
        if (d >= 0 && !(cards.length && d < cards[cards.length - 1].end)) {
            const paraEnd = d;
            while (d >= 0 && lines[d].trim() && !LABEL.test(lines[d].trim()) && !isCapsName(lines[d].trim())) d--;
            const para = lines.slice(d + 1, paraEnd + 1).map(l => l.trim());
            // Only prose belongs to the card (a few sentences, not a stat block).
            if (para.length && para.length <= 40 && /[.!?"”]$/.test(para[para.length - 1]) && !para.some(l => /^\w[\w ]{0,25}:/.test(l))) {
                desc.push(...para);
                start = d + 1;
            }
        }

        // Labeled lines after the name, each possibly wrapped.
        const fields = { sections: [] };
        let cur = null;
        let end = i;
        for (let j = i; j < lines.length; j++) {
            const t = lines[j].trim();
            if (!t) { end = j; continue; }
            const m = LABEL.exec(t);
            if (m) {
                cur = { label: m[1].replace(/\s+/g, ' ').replace(/^\w/, c => c.toUpperCase()), text: m[2].trim() };
                fields.sections.push(cur);
                end = j + 1;
                continue;
            }
            // A wrapped label line carries on without a blank line in between.
            if (cur && j === end) { cur.text = joinWrapped(cur.text, t); end = j + 1; continue; }
            break;
        }
        const conn = fields.sections.find(s => /^connection/i.test(s.label));
        const loy = fields.sections.find(s => /^loyalty/i.test(s.label));
        fields.sections = fields.sections.filter(s => s !== conn && s !== loy && s.text);
        if (conn?.text) fields.connection = conn.text.match(/\d+/)?.[0];
        if (loy?.text && /\d/.test(loy.text)) fields.loyalty = loy.text.match(/\d+/)[0];
        if (header[0]) fields.type = header[0];
        if (header[1]) fields.sections.unshift({ label: '', text: header[1] });
        if (desc.length) fields.description = joinLines(desc);

        cards.push({
            start, end,
            record: {
                documentName: 'Item', type: 'contact', name: tidyName(lines[nameIdx].trim()), fields, hint: {}, warnings: [],
                raw: lines.slice(start, end).join('\n'),
            },
        });
        i = end - 1;
    }
    return cards;
}

function joinWrapped(a, b) {
    if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
    return `${a} ${b}`;
}

function joinLines(ls) {
    return ls.reduce((acc, l) => (acc ? joinWrapped(acc, l) : l), '');
}
