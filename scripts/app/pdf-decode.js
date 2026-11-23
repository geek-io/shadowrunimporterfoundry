/**
 * Decoding text from PDFs whose fonts have no character map (no ToUnicode, no cmap): the text
 * comes out as glyph numbers, which for most fonts are the real characters shifted by a constant
 * ("8LI" for "The"). Some commercial PDFs are made this way.
 *
 * 1. For each font, the shift is found from the text itself: the most common code is a shifted
 *    space, and the shifted text has to read like English (letters, vowels, common words).
 *    Small fonts (headings) use the document's shift when it turns them into words.
 * 2. Glyphs outside the shifted ASCII range (’ “ ” – — ¥ • and accented letters) are worked out
 *    from where they appear across the whole document. Ones that can't be identified become "�".
 *
 * Works on pdf.js text items ({str, fontName, ...}); fonts that read normally are left alone.
 */
const PUA = 0xF0000;            // unknown glyph n is held as U+F0000 + n until the document is read
const COMMON = /\b(the|and|of|to|in|is|you|that|it|for|with|on|are|as|be|or|this|his|her|they)\b/g;

function englishScore(text) {
    const chars = text.replace(/\s+/g, '');
    if (chars.length < 8) return 0;
    const letters = (chars.match(/[A-Za-z]/g) ?? []).length;
    const vowels = (chars.match(/[aeiouAEIOU]/g) ?? []).length;
    const words = (text.toLowerCase().match(COMMON) ?? []).length;
    const vowelOk = letters ? Math.abs(vowels / letters - 0.38) < 0.15 : false;
    return letters / chars.length + (vowelOk ? 0.3 : 0) + Math.min(0.4, (words * 40) / Math.max(1, text.length));
}

/** Shift one string; codes outside the shifted ASCII range become placeholders. */
function shiftText(str, k) {
    let out = '';
    for (const ch of str) {
        const c = ch.codePointAt(0);
        if (c === 32) { out += ' '; continue; }              // a space pdf.js added between words
        const real = c + k;
        if (real >= 32 && real <= 126) out += String.fromCharCode(real);
        else out += String.fromCodePoint(PUA + c);
    }
    return out;
}

/**
 * @param {Array<Array<{str:string,fontName:string}>>} pages  text items of every page
 * @returns {{decoded:boolean, fonts:object, glyphs:object}} what was done (items are changed in place)
 */
export function decodePdfText(pages) {
    // Text per font.
    const byFont = new Map();
    for (const items of pages) for (const it of items) {
        if (!it.str) continue;
        const f = byFont.get(it.fontName) ?? { text: '', items: [] };
        f.text += `${it.str} `;
        f.items.push(it);
        byFont.set(it.fontName, f);
    }

    // 1. Shift per font.
    const shifts = new Map();
    for (const [name, f] of byFont) {
        const counts = new Map();
        for (const ch of f.text) { const c = ch.codePointAt(0); if (c !== 32) counts.set(c, (counts.get(c) ?? 0) + 1); }
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        if (!top || top[0] >= 32 || top[0] < 1) continue;      // reads normally (or nothing to go on)
        const k = 32 - top[0];
        const base = englishScore(f.text);
        const shifted = englishScore(shiftText(f.text, k));
        if (shifted > base + 0.25 && shifted > 0.9) shifts.set(name, k);
    }
    if (!shifts.size) return { decoded: false, fonts: {}, glyphs: {} };
    // The document's usual shift, tried on small fonts without spaces (headings).
    const tally = new Map();
    for (const k of shifts.values()) tally.set(k, (tally.get(k) ?? 0) + 1);
    const docK = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const [name, f] of byFont) {
        if (shifts.has(name)) continue;
        const letters = s => (s.match(/[A-Za-z]/g) ?? []).length / Math.max(1, s.replace(/\s+/g, '').length);
        const shifted = shiftText(f.text, docK);
        if (letters(shifted) > letters(f.text) + 0.3 && letters(shifted) > 0.7) shifts.set(name, docK);
    }

    // Shift every item of a shifted font.
    for (const [name, k] of shifts) for (const it of byFont.get(name).items) it.str = shiftText(it.str, k);

    // 2. Unknown glyphs, from their contexts across the document.
    const votes = new Map();
    const vote = (g, kind, n = 1) => {
        const v = votes.get(g) ?? {};
        v[kind] = (v[kind] ?? 0) + n;
        votes.set(g, v);
    };
    const isPua = c => c >= PUA;
    for (const [name] of shifts) for (const it of byFont.get(name).items) {
        const s = [...it.str];
        s.forEach((ch, i) => {
            const c = ch.codePointAt(0);
            if (!isPua(c)) return;
            const prev = s[i - 1] ?? '';
            const next = s[i + 1] ?? '';
            const after = s.slice(i + 1, i + 4).join('');
            const L = x => /[A-Za-z]/.test(x);
            const D = x => /[0-9]/.test(x);
            if (L(prev) && /^(s|t|re|ve|ll|d|m)(?![A-Za-z])/i.test(after)) vote(c, 'apos', 2);
            else if (L(prev) && L(next)) vote(c, 'inword');
            if (D(next) && (!prev || prev === ' ' || prev === '(' || prev === '[')) vote(c, 'minus', 2);
            if (D(prev) && (!next || /[\s,.;)\]/]/.test(next))) vote(c, 'yen');
            if ((!prev || prev === ' ' || prev === '(') && (L(next) || D(next))) vote(c, 'open');
            if ((L(prev) || /[.,!?]/.test(prev)) && (!next || /[\s,.;:)]/.test(next))) vote(c, 'close');
            if ((!prev && (!next || next === ' ')) || (prev === ' ' && next === ' ')) vote(c, 'dash');
            if (!prev && next === ' ' && i === 0) vote(c, 'bullet');
            if (L(prev)) vote(c, 'afterLetter');
            if (/[.,!?]/.test(prev)) vote(c, 'afterPunct');
            vote(c, 'total');
        });
    }
    const glyphs = {};
    for (const [c, v] of votes) {
        const total = v.total;
        const share = k => (v[k] ?? 0) / total;
        let out = '�';
        if (share('apos') >= 0.5) out = '’';
        else if (share('minus') >= 0.5) out = '–';
        else if (share('yen') >= 0.6 && total >= 2) out = '¥';
        else if (share('bullet') >= 0.5) out = '•';
        // Always right after a letter, never after punctuation: a letter of a word (Bogotá, café).
        else if (share('afterLetter') >= 0.9 && !v.afterPunct) out = '\uFFFD';
        else if (share('dash') >= 0.4 || (share('inword') >= 0.3 && total >= 10)) out = '—';
        else if (share('open') >= 0.5) out = '“';
        else if (share('close') >= 0.5) out = '”';
        glyphs[c - PUA] = out;
    }
    for (const [name] of shifts) for (const it of byFont.get(name).items) {
        it.str = it.str.replace(/[\u{F0000}-\u{FFFFD}]/gu, ch => glyphs[ch.codePointAt(0) - PUA] ?? '�');
    }
    return { decoded: true, fonts: Object.fromEntries(shifts), glyphs };
}
