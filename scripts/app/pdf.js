/**
 * Local PDF text extraction with the bundled pdf.js (no network access needed).
 * Rebuilds reading-order lines from positioned text, including two-column rulebook pages.
 */
import { MODULE_ID, route } from './compat.js';

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
    const out = [];
    const emptyPages = [];
    try {
        for (let i = 0; i < pages.length; i++) {
            if (opts.token?.cancelled) break;
            const pageNo = pages[i];
            opts.onProgress?.({ page: pageNo, done: i, total: pages.length });
            const page = await doc.getPage(pageNo);
            const viewport = page.getViewport({ scale: 1 });
            const content = await page.getTextContent({ disableNormalization: false });
            const text = pageToText(content.items, viewport.width, opts.columns ?? 'auto');
            if (!text.trim()) emptyPages.push(pageNo);
            out.push(text);
            page.cleanup();
        }
    } finally {
        await doc.destroy();
    }
    opts.onProgress?.({ page: 0, done: pages.length, total: pages.length });
    return { text: out.join('\n\n'), pageCount: doc.numPages, pages, emptyPages };
}

/* ------------------------------------------------------------------ */

function pageToText(items, pageWidth, columns) {
    const runs = items
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

    const twoColumns = columns === '2' || (columns === 'auto' && looksTwoColumn(runs, pageWidth));
    if (!twoColumns) return linesToText(groupLines(runs));
    const mid = splitPoint(runs, pageWidth);
    const left = runs.filter(r => r.x + r.w / 2 < mid);
    const right = runs.filter(r => r.x + r.w / 2 >= mid);
    return [linesToText(groupLines(left)), linesToText(groupLines(right))].filter(Boolean).join('\n\n');
}

function looksTwoColumn(runs, width) {
    const mid = width / 2;
    const textRuns = runs.filter(r => r.str.trim().length > 2);
    if (textRuns.length < 30) return false;
    const crossing = textRuns.filter(r => r.x < mid - 15 && r.x + r.w > mid + 15).length;
    const left = textRuns.filter(r => r.x + r.w < mid).length;
    const right = textRuns.filter(r => r.x > mid).length;
    return crossing / textRuns.length < 0.06 && left / textRuns.length > 0.25 && right / textRuns.length > 0.25;
}

/** Find the emptiest vertical gutter near the middle of the page. */
function splitPoint(runs, width) {
    let best = width / 2;
    let bestScore = Infinity;
    for (let x = width * 0.4; x <= width * 0.6; x += 2) {
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
                    && /[A-Z0-9)\]¥%]$/.test(prevStr) && /^[A-Z0-9(+\-–—]/.test(r.str);
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
export const _internal = { pageToText, looksTwoColumn, groupLines, linesToText };
