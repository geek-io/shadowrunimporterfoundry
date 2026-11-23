/**
 * Local PDF text extraction with the bundled pdf.js (no network access needed).
 * Rebuilds reading-order lines from positioned text, including two-column rulebook pages.
 */
import { MODULE_ID, route } from './compat.js';
import { decodePdfText } from './pdf-decode.js';

let pdfjsLib = null;

async function loadPdfJs() {
    if (pdfjsLib) return pdfjsLib;
    const base = `modules/${MODULE_ID}/vendor/pdfjs`;
    pdfjsLib = await import(route(`${base}/pdf.mjs`));
    pdfjsLib.GlobalWorkerOptions.workerSrc = route(`${base}/pdf.worker.mjs`);
    return pdfjsLib;
}

/** "1-3, 7, 10-" → sorted unique page numbers within 1..max */
export function parsePageRange(text, max) {
    const s = String(text ?? '').trim();
    if (!s) return Array.from({ length: max }, (_, i) => i + 1);
    const pages = new Set();
    for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
        const m = /^(\d+)?\s*-\s*(\d+)?$/.exec(part);
        if (m) {
            const a = Math.max(1, Number(m[1] ?? 1));
            const b = Math.min(max, Number(m[2] ?? max));
            for (let p = a; p <= b; p++) pages.add(p);
        } else if (/^\d+$/.test(part)) {
            const p = Number(part);
            if (p >= 1 && p <= max) pages.add(p);
        }
    }
    return [...pages].sort((x, y) => x - y);
}

/**
 * @param {ArrayBuffer} buffer
 * @param {object} [opts]
 * @param {string} [opts.pages]   page range, blank for all
 * @param {'auto'|'1'|'2'} [opts.columns]
 * @param {(p:{page:number,done:number,total:number}) => void} [opts.onProgress]
 * @param {{cancelled:boolean}} [opts.token]
 * @returns {Promise<{text:string, pageCount:number, pages:number[], emptyPages:number[]}>}
 */
export async function extractPdfText(buffer, opts = {}) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({
        data: new Uint8Array(buffer),
        cMapUrl: route(`modules/${MODULE_ID}/vendor/pdfjs/cmaps/`),
        cMapPacked: true,
        isEvalSupported: false,
    }).promise;
    const pages = parsePageRange(opts.pages, doc.numPages);
    const read = [];
    try {
        for (let i = 0; i < pages.length; i++) {
            if (opts.token?.cancelled) break;
            const pageNo = pages[i];
            opts.onProgress?.({ page: pageNo, done: i, total: pages.length });
            const page = await doc.getPage(pageNo);
            const viewport = page.getViewport({ scale: 1 });
            const content = await page.getTextContent({ disableNormalization: false });
            read.push({ pageNo, items: content.items, width: viewport.width, height: viewport.height });
            page.cleanup();
        }
    } finally {
        await doc.destroy();
    }
    opts.onProgress?.({ page: 0, done: pages.length, total: pages.length });
    const { text, emptyPages, decoded } = pagesToText(read, opts.columns ?? 'auto');
    return { text, pageCount: doc.numPages, pages, emptyPages, decoded };
}

/**
 * Text of several pages read with pdf.js: fonts without a character map are decoded across the
 * whole selection first (see pdf-decode.js), then each page is laid out.
 * @param {{pageNo:number, items:object[], width:number, height:number}[]} read
 */
export function pagesToText(read, columns = 'auto') {
    const { decoded } = decodePdfText(read.map(p => p.items));
    const out = [];
    const emptyPages = [];
    for (const p of read) {
        const text = pageToText(p.items, p.width, columns, p.height);
        if (!text.trim()) emptyPages.push(p.pageNo);
        out.push(text);
    }
    return { text: out.join('\n\n'), emptyPages, decoded };
}

/* ------------------------------------------------------------------ */

function pageToText(items, pageWidth, columns, pageHeight) {
    let runs = items
        .filter(it => typeof it.str === 'string' && (it.str.trim() || it.hasEOL))
        .map(it => ({
            str: it.str,
            x: it.transform[4],
            y: it.transform[5],
            w: it.width ?? 0,
            h: Math.abs(it.transform[3]) || it.height || 10,
        }))
        .filter(r => r.str.length);
    if (!runs.length) return '';
    runs = dropPageFurniture(runs, pageHeight);
    if (columns === '1') return linesToText(groupLines(runs));
    if (columns === '2') {
        const mid = splitPoint(runs, pageWidth);
        return layoutText(runs, [{ start: mid - 1, end: mid + 1 }], pageHeight);
    }
    return layoutText(runs, findGutters(runs, pageWidth), pageHeight);
}

/**
 * Page numbers and running headers/footers: short lines alone in the top or bottom margin.
 * They would otherwise land in the middle of whatever entry the page starts or ends with.
 */
function dropPageFurniture(runs, pageHeight) {
    if (!pageHeight) return runs;
    const lines = groupLines(runs);
    if (lines.length < 6) return runs;
    const drop = new Set();
    const lineLen = l => l.runs.map(r => r.str).join('').trim().length;
    const isolated = (l, other) => Math.abs(l.y - other.y) > Math.max(l.h, other.h) * 2.2;
    for (let i = 0; i < 2 && i + 1 < lines.length; i++) {           // top, highest y first
        const l = lines[i];
        if (l.y > pageHeight * 0.9 && lineLen(l) <= 60 && isolated(l, lines[i + 1])) drop.add(l); else break;
    }
    for (let i = lines.length - 1; i > lines.length - 3 && i > 0; i--) {  // bottom
        const l = lines[i];
        if (l.y < pageHeight * 0.1 && lineLen(l) <= 60 && isolated(l, lines[i - 1])) drop.add(l); else break;
    }
    if (!drop.size) return runs;
    const gone = new Set([...drop].flatMap(l => l.runs));
    return runs.filter(r => !gone.has(r));
}

/* ---------------- Column layout ----------------
 * Columns are found from the page itself: a gutter is a vertical band that (almost) no text crosses,
 * running down most of the page, with real text on both sides. Tables don't make gutters because
 * the text above and below them crosses their cell gaps. A line that crosses a gutter (a chapter
 * title over both columns) splits the page into bands that are read top to bottom.
 * Narrow strips of short capitalised words at the page edge are navigation tabs and are left out.
 */
function findGutters(runs, pageWidth) {
    const text = runs.filter(r => r.str.trim());
    if (text.length < 12) return [];
    const minX = Math.max(0, Math.floor(Math.min(...text.map(r => r.x))));
    const maxX = Math.ceil(Math.max(...text.map(r => r.x + r.w)));
    const width = Math.max(pageWidth, maxX) + 2;
    const hs = text.map(r => r.h).sort((a, b) => a - b);
    const hMed = hs[Math.floor(hs.length / 2)] || 10;

    // How much text height covers each x position. Lines running across the whole text area (a
    // paragraph or title over both columns) are left out here; they are read as full-width lines.
    const occ = new Float64Array(Math.ceil(width) + 1);
    const wide = (maxX - minX) * 0.55;
    for (const r of text) {
        if (r.w > wide) continue;
        const a = Math.max(0, Math.floor(r.x)), b = Math.min(occ.length - 1, Math.ceil(r.x + r.w));
        for (let x = a; x < b; x++) occ[x] += r.h;
    }
    const filled = [...occ.slice(minX, maxX)].filter(v => v > 0).sort((a, b) => a - b);
    const p90 = filled[Math.floor(filled.length * 0.9)] || 0;
    const limit = Math.max(hMed * 2.5, p90 * 0.04);

    // Candidate gutters: low-coverage bands, at least about a character wide.
    let gutters = [];
    for (let x = minX + 1; x < maxX; x++) {
        if (occ[x] > limit) continue;
        let e = x;
        while (e + 1 < maxX && occ[e + 1] <= limit) e++;
        // Text must start after the band and end before it (not just one long word poking past the rest).
        const real = text.some(r => r.x >= e) && text.some(r => r.x + r.w <= x + 1);
        if (real && e - x + 1 >= Math.max(6, hMed * 0.6)) gutters.push({ start: x, end: e + 1 });
        x = e;
    }
    if (!gutters.length) return [];

    // Keep a gutter only if the strips it separates both look like columns.
    const vSpan = span(text);
    const vExtent = extent(text);
    const stripRuns = (gs, i) => {
        const left = i === 0 ? -Infinity : gs[i - 1].end, right = i === gs.length ? Infinity : gs[i].start;
        return text.filter(r => { const c = r.x + r.w / 2; return c > left && c < right && !crosses(r, gs); });
    };
    let changed = true;
    while (changed && gutters.length) {
        changed = false;
        for (let i = 0; i <= gutters.length; i++) {
            const rs = stripRuns(gutters, i);
            const lines = groupLines(rs);
            // Text columns cover much of the page; navigation tabs are sparse but run down the page edge.
            const ok = lines.length >= 3 && ((proseLike(lines) && span(rs) >= vSpan * 0.3)
                || (isEdge(i, gutters) && navLike(lines) && extent(rs) >= vExtent * 0.4));
            if (ok) continue;
            // Merge this strip with a neighbour by dropping one of its gutters: the one between cells
            // of the same table rows (a label/value split lines up row by row), else the narrower.
            const cands = [i - 1, i].filter(k => k >= 0 && k < gutters.length);
            // A gutter with ordinary text on one side is a column edge; one between short cells on
            // both sides is a table split and goes first.
            const cellsBothSides = k => [k, k + 1].every(n => !proseLike(groupLines(stripRuns(gutters, n)))) ? 1 : 0;
            const aligned = k => rowAligned(groupLines(stripRuns(gutters, k)), groupLines(stripRuns(gutters, k + 1)));
            const width = k => gutters[k].end - gutters[k].start;
            const k = cands.sort((a, b) => (cellsBothSides(b) - cellsBothSides(a)) || (aligned(b) - aligned(a)) || (width(a) - width(b)))[0];
            gutters.splice(k, 1);
            changed = true;
            break;
        }
    }
    // Table columns that line up row by row with their neighbours are not text columns.
    // (Navigation tabs at the page edge may share the text's baselines; they stay separate.)
    gutters = gutters.filter((g, i) => {
        const l = groupLines(stripRuns(gutters, i)), r = groupLines(stripRuns(gutters, i + 1));
        if ((i === 0 && navLike(l)) || (i === gutters.length - 1 && navLike(r))) return true;
        // Both sides short cells (a table), lined up row by row: one table, not two columns.
        const cells = [l, r].every(ls => !proseLike(ls));
        return !cells || rowAligned(l, r) < 0.6;
    });
    return gutters;
}

const isEdge = (i, gutters) => i === 0 || i === gutters.length;
const crosses = (r, gutters) => gutters.some(g => r.x < g.start - 1 && r.x + r.w > g.end + 1);

/** Distance from the lowest to the highest run. */
function extent(rs) {
    if (!rs.length) return 0;
    return Math.max(...rs.map(r => r.y + r.h)) - Math.min(...rs.map(r => r.y));
}

/** Vertical extent covered by runs (union of their line boxes). */
function span(rs) {
    const iv = rs.map(r => [r.y, r.y + r.h]).sort((a, b) => a[0] - b[0]);
    let total = 0, cs = -Infinity, ce = -Infinity;
    for (const [a, b] of iv) {
        if (a > ce) { if (ce > cs) total += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b);
    }
    if (ce > cs) total += ce - cs;
    return total;
}

const lineText = l => l.runs.map(r => r.str).join(' ').replace(/\s+/g, ' ').trim();

/** Ordinary text: most lines are long enough to be sentences or list lines. */
function proseLike(lines) {
    const ts = lines.map(lineText);
    const lens = ts.map(t => t.length).sort((a, b) => a - b);
    if ((lens[Math.floor(lens.length / 2)] ?? 0) < 18) return false;
    // Words, not the number cells of a table row ("-1 SA - 15(c) 5R 725¥").
    const all = ts.join('').replace(/\s+/g, '');
    const letters = (all.match(/[A-Za-z]/g) ?? []).length;
    return letters / Math.max(1, all.length) >= 0.55;
}

/** Page-edge navigation: short capitalised labels ("INTRODUCTION", "SCENE 1"). */
function navLike(lines) {
    const ts = lines.map(lineText).filter(Boolean);
    // Words, not table codes such as "5R" or "12F".
    const caps = ts.filter(t => t.split(/\s+/).length <= 4 && t.length <= 24 && !/[a-z]/.test(t) && /[A-Z]{3}/.test(t));
    return ts.length >= 3 && caps.length / ts.length >= 0.6;
}

/** Share of lines in a that sit on the same baseline as a line in b (table rows do). */
function rowAligned(a, b) {
    if (!a.length || !b.length) return 0;
    const hits = a.filter(l => b.some(m => Math.abs(m.y - l.y) <= Math.max(1.5, Math.min(l.h, m.h) * 0.3))).length;
    return hits / Math.min(a.length, b.length);
}

/** Read the page: bands separated by lines that cross a gutter, each band column by column. */
function layoutText(runs, gutters, pageHeight) {
    if (!gutters.length) return linesToText(groupLines(runs));
    // In the top and bottom margins, a line across the columns is a running header or footer
    // ("SCENE 3: THE DIRECT ROUTE"), and a lone number is the page number. A column's last line can
    // sit right next to them, so they are removed here rather than merged into one line.
    const inMargin = r => pageHeight && (r.y < pageHeight * 0.08 || r.y > pageHeight * 0.92);
    const footer = new Set(runs.filter(r => inMargin(r) && crosses(r, gutters)));
    // A page number stands alone on its line, or only next to that footer text. A value such as the
    // "13" of "Condition Monitor: 13" at the top of a column has its label beside it and stays.
    const sameLine = (a, b) => Math.abs(a.y - b.y) <= Math.max(2, Math.min(a.h, b.h) * 0.6);
    const stripOf = r => gutters.filter(g => r.x + r.w / 2 > (g.start + g.end) / 2).length;
    const pageNumber = r => inMargin(r) && /^\s*\d{1,4}\s*$/.test(r.str)
        && runs.every(o => o === r || footer.has(o) || !sameLine(o, r) || stripOf(o) !== stripOf(r));
    runs = runs.filter(r => !footer.has(r) && !pageNumber(r));
    const spanning = runs.filter(r => crosses(r, gutters));
    // Lines crossing a gutter, merged with any runs on the same baseline.
    const spanLines = groupLines(spanning);
    const isOnSpanLine = r => spanLines.some(l => Math.abs(l.y - r.y) <= Math.max(2, Math.min(l.h, r.h) * 0.45));
    const body = runs.filter(r => !spanning.includes(r) && !isOnSpanLine(r));
    const strips = [];
    // Strip boundaries sit in the middle of each gutter, so nothing falls between strips.
    for (let i = 0; i <= gutters.length; i++) {
        const mid = g => (g.start + g.end) / 2;
        const left = i === 0 ? -Infinity : mid(gutters[i - 1]), right = i === gutters.length ? Infinity : mid(gutters[i]);
        strips.push(body.filter(r => { const c = r.x + r.w / 2; return c > left && c <= right; }));
    }
    // Navigation tabs at the page edge are dropped.
    const keep = strips.map((rs, i) => !(isEdge(i, gutters) && rs.length && navLike(groupLines(rs)) && !proseLike(groupLines(rs))));
    const fullLines = groupLines(runs.filter(r => spanning.includes(r) || isOnSpanLine(r)));
    const cuts = fullLines.map(l => l.y); // descending
    const out = [];
    let upper = Infinity;
    const emitBand = (lo, hi) => {
        for (let i = 0; i < strips.length; i++) {
            if (!keep[i]) continue;
            const rs = strips[i].filter(r => r.y < hi && r.y >= lo);
            const t = linesToText(groupLines(rs));
            if (t.trim()) out.push(t);
        }
    };
    for (const line of fullLines) {
        emitBand(line.y, upper);
        out.push(linesToText([line]));
        upper = line.y;
    }
    emitBand(-Infinity, upper);
    void cuts;
    return out.join('\n\n');
}

/** Find the emptiest vertical gutter near the middle of the page (forced two-column mode). */
function splitPoint(runs, width) {
    let best = width / 2;
    let bestScore = Infinity;
    for (let x = width * 0.3; x <= width * 0.7; x += 2) {
        const score = runs.filter(r => r.x < x && r.x + r.w > x).length;
        if (score < bestScore) { bestScore = score; best = x; }
    }
    return best;
}

function groupLines(runs) {
    const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const r of sorted) {
        const line = lines.find(l => Math.abs(l.y - r.y) <= Math.max(2, Math.min(l.h, r.h) * 0.45));
        if (line) { line.runs.push(r); line.h = Math.max(line.h, r.h); }
        else lines.push({ y: r.y, h: r.h, runs: [r] });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) l.runs.sort((a, b) => a.x - b.x);
    return lines;
}

function linesToText(lines) {
    const out = [];
    let prev = null;
    for (const line of lines) {
        let s = '';
        let end = null;
        let prevStr = '';
        for (const r of line.runs) {
            if (end !== null) {
                const gap = r.x - end;
                const spaced = s.endsWith(' ') || r.str.startsWith(' ');
                // Separate text runs that touch are usually separate table cells, not one word.
                const cellBoundary = gap > -r.h * 0.1 && prevStr.trim().length >= 2 && r.str.trim().length >= 2
                    && /[A-Z0-9)\]¥%.]$/.test(prevStr) && /^[A-Z0-9(+\-–—]/.test(r.str);
                if (gap > r.h * 1.5) s += '  ';          // column gap (tables, "Label: value  Label: value")
                else if (!spaced && (gap > r.h * 0.15 || cellBoundary)) s += ' ';
            }
            s += r.str;
            prevStr = r.str;
            end = r.x + r.w;
        }
        if (prev && prev.y - line.y > Math.max(prev.h, line.h) * 1.8) out.push('');
        out.push(s.replace(/\s+$/, ''));
        prev = line;
    }
    return out.join('\n');
}

/** Exposed for tests. */
export const _internal = { pagesToText, pageToText, findGutters, layoutText, groupLines, linesToText };
