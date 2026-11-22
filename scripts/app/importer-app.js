/**
 * The importer window: sources → preview → destination → import.
 */
import { MODULE_ID, t, log, route } from './compat.js';
import { extractPdfText } from './pdf.js';
import { parseText } from '../parsers/text-parser.js';
import { parseJSON, looksLikeJSON } from '../parsers/json-parser.js';
import { ITEM_TYPES, ACTOR_TYPES } from '../parsers/types.js';
import { FORMAT_GUIDE, guideTopicFor } from './format-guide.js';
import { buildEntries, buildEntry, summarize, importEntries, listDestinations, listFolderPaths } from './creator.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const TEXT_EXT = /\.(txt|md|markdown|text|csv)$/i;
const JSON_EXT = /\.(json|jsonl|ndjson)$/i;
const PDF_EXT = /\.pdf$/i;

export class SR5ImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'sr5-importer',
        classes: ['sr5-importer'],
        tag: 'div',
        window: { title: 'SR5IMPORTER.Title', icon: 'fa-solid fa-file-import', resizable: true },
        position: { width: 860, height: 760 },
        actions: {
            parse: SR5ImporterApp.#onParse,
            runImport: SR5ImporterApp.#onImport,
            clearText: SR5ImporterApp.#onClearText,
            clearEntries: SR5ImporterApp.#onClearEntries,
            removeFile: SR5ImporterApp.#onRemoveFile,
            extractPdf: SR5ImporterApp.#onExtractPdf,
            cancelPdf: SR5ImporterApp.#onCancelPdf,
            selectAll: SR5ImporterApp.#onSelectAll,
            selectNone: SR5ImporterApp.#onSelectNone,
            toggleDetails: SR5ImporterApp.#onToggleDetails,
            removeEntry: SR5ImporterApp.#onRemoveEntry,
            openDocument: SR5ImporterApp.#onOpenDocument,
            pickFiles: SR5ImporterApp.#onPickFiles,
            loadSample: SR5ImporterApp.#onLoadSample,
            setStep: SR5ImporterApp.#onSetStep,
            guideTopic: SR5ImporterApp.#onGuideTopic,
            insertExample: SR5ImporterApp.#onInsertExample,
        },
    };

    static PARTS = {
        main: { template: `modules/${MODULE_ID}/templates/importer.hbs`, scrollable: ['.sr5i-scroll'] },
    };

    constructor(options = {}) {
        super(options);
        const saved = game.settings.get(MODULE_ID, 'importerOptions') ?? {};
        this.importState = {
            step: 'source',
            text: '',
            files: [],            // { id, name, kind: 'json'|'text'|'pdf', size, content|buffer, pages, columns }
            entries: [],
            expanded: new Set(),
            filter: '',
            defaultType: saved.defaultType ?? 'equipment',
            forceType: '',
            pdf: { busy: false, progress: 0, label: '', token: null },
            busy: false,
            progress: null,
            summary: null,
            parseNotes: [],
            guide: { open: false, topic: 'npc' },
            options: {
                actorDestination: 'world',
                itemDestination: 'world',
                actorFolder: saved.actorFolder ?? '',
                itemFolder: saved.itemFolder ?? '',
                duplicates: saved.duplicates ?? 'skip',
                matchItems: saved.matchItems ?? true,
                reconcile: saved.reconcile ?? true,
                openAfter: saved.openAfter ?? false,
            },
        };
        if (options.text) this.importState.text = options.text;
    }

    /* -------------------------------------------- */

    async _prepareContext() {
        const s = this.importState;
        const typeOptions = [
            ...ACTOR_TYPES.filter(k => k in (game.system.documentTypes?.Actor ?? {})).map(k => ({ value: k, label: `${game.i18n.localize(`TYPES.Actor.${k}`)} (${t('Labels.Actor')})`, group: 'Actor' })),
            ...ITEM_TYPES.filter(k => k in (game.system.documentTypes?.Item ?? {})).map(k => ({ value: k, label: game.i18n.localize(`TYPES.Item.${k}`), group: 'Item' })),
        ].sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));

        const filter = s.filter.toLowerCase();
        const entries = s.entries.map(e => ({
            ...e,
            typeLabel: game.i18n.localize(`TYPES.${e.documentName}.${e.type}`),
            summary: summarize(e),
            expanded: s.expanded.has(e.id),
            json: s.expanded.has(e.id) ? JSON.stringify(e.data, null, 2) : '',
            planJson: s.expanded.has(e.id) && e.plan && (e.plan.children?.length || e.plan.skills?.length)
                ? JSON.stringify({ skills: e.plan.skills, items: e.plan.children?.map(c => ({ type: c.type, name: c.name, ...c.fields })) }, null, 2) : '',
            hidden: filter && !(`${e.name} ${e.type}`.toLowerCase().includes(filter)),
            typeOptions: typeOptions.map(o => ({ ...o, selected: o.value === e.type })),
            warningText: e.warnings.join('\n'),
        }));
        const counts = {
            total: s.entries.length,
            included: s.entries.filter(e => e.include && !e.error).length,
            actors: s.entries.filter(e => e.include && !e.error && e.documentName === 'Actor').length,
            items: s.entries.filter(e => e.include && !e.error && e.documentName === 'Item').length,
            warnings: s.entries.filter(e => e.warnings.length).length,
            errors: s.entries.filter(e => e.error).length,
        };
        const o = s.options;
        return {
            state: s,
            step: s.step,
            steps: ['source', 'preview', 'import'].map((id, i) => ({ id, n: i + 1, label: t(`Steps.${id}`), active: s.step === id, disabled: id !== 'source' && !s.entries.length })),
            files: s.files.map(f => ({ ...f, sizeLabel: formatBytes(f.size), isPdf: f.kind === 'pdf' })),
            hasPdf: s.files.some(f => f.kind === 'pdf'),
            typeOptions,
            defaultTypeOptions: typeOptions.map(x => ({ ...x, selected: x.value === s.defaultType })),
            forceTypeOptions: typeOptions.map(x => ({ ...x, selected: x.value === s.forceType })),
            entries,
            counts,
            options: o,
            actorDestinations: listDestinations('Actor').map(d => ({ ...d, selected: d.value === o.actorDestination })),
            itemDestinations: listDestinations('Item').map(d => ({ ...d, selected: d.value === o.itemDestination })),
            actorFolders: listFolderPaths('Actor', o.actorDestination),
            itemFolders: listFolderPaths('Item', o.itemDestination),
            duplicateOptions: ['skip', 'replace', 'copy'].map(v => ({ value: v, label: t(`Duplicates.${v}`), selected: o.duplicates === v })),
            columnOptions: [['auto', 'Pdf.ColumnsAuto'], ['1', 'Pdf.Columns1'], ['2', 'Pdf.Columns2']],
            summary: s.summary,
            progress: s.progress,
            pdf: s.pdf,
            busy: s.busy,
            parseNotes: s.parseNotes,
            canImport: counts.included > 0 && !s.busy,
            guide: {
                open: s.guide.open,
                topics: FORMAT_GUIDE.map(g => ({ id: g.id, label: g.label, active: g.id === s.guide.topic })),
                current: FORMAT_GUIDE.find(g => g.id === s.guide.topic) ?? FORMAT_GUIDE[0],
            },
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        const root = this.element;

        const textarea = root.querySelector('textarea[name="sourceText"]');
        textarea?.addEventListener('input', ev => { this.importState.text = ev.target.value; });

        root.querySelector('input[name="fileInput"]')?.addEventListener('change', ev => this.#addFiles(ev.target.files));
        const drop = root.querySelector('.sr5i-drop');
        if (drop) {
            drop.addEventListener('dragover', ev => { ev.preventDefault(); drop.classList.add('dragging'); });
            drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
            drop.addEventListener('drop', ev => {
                ev.preventDefault();
                drop.classList.remove('dragging');
                if (ev.dataTransfer?.files?.length) this.#addFiles(ev.dataTransfer.files);
            });
        }

        root.querySelectorAll('[data-file-field]').forEach(el => el.addEventListener('change', ev => {
            const file = this.importState.files.find(f => f.id === ev.target.closest('[data-file-id]')?.dataset.fileId);
            if (file) file[ev.target.dataset.fileField] = ev.target.value;
        }));

        root.querySelector('select[name="defaultType"]')?.addEventListener('change', ev => { this.importState.defaultType = ev.target.value; });
        root.querySelector('select[name="forceType"]')?.addEventListener('change', ev => {
            this.importState.forceType = ev.target.value;
            // Show the layout expected for the chosen type.
            const topic = guideTopicFor(ev.target.value);
            if (topic && topic !== this.importState.guide.topic) { this.importState.guide.topic = topic; this.render(); }
        });
        root.querySelector('details.sr5i-guide')?.addEventListener('toggle', ev => { this.importState.guide.open = ev.target.open; });
        root.querySelector('input[name="filter"]')?.addEventListener('input', foundry.utils.debounce(ev => { this.importState.filter = ev.target.value; this.render(); }, 250));

        // Entry edits.
        root.querySelectorAll('[data-entry-id]').forEach(row => {
            const entry = this.importState.entries.find(e => e.id === row.dataset.entryId);
            if (!entry) return;
            row.querySelector('input[name="include"]')?.addEventListener('change', ev => { entry.include = ev.target.checked; this.#refreshCounts(); });
            row.querySelector('input[name="entryName"]')?.addEventListener('change', ev => {
                entry.name = ev.target.value.trim() || entry.name;
                if (entry.data) entry.data.name = entry.name;
                entry.record.name = entry.name;
            });
            row.querySelector('select[name="entryType"]')?.addEventListener('change', ev => this.#changeEntryType(entry, ev.target.value));
            row.querySelector('textarea[name="entryJson"]')?.addEventListener('change', ev => {
                try {
                    entry.data = JSON.parse(ev.target.value);
                    entry.name = entry.data.name ?? entry.name;
                    entry.type = entry.data.type ?? entry.type;
                    entry.error = null;
                    ev.target.classList.remove('invalid');
                } catch (err) {
                    ev.target.classList.add('invalid');
                    ui.notifications.warn(t('Errors.InvalidJson', { error: err.message }));
                }
            });
        });

        // Options.
        root.querySelectorAll('[data-option]').forEach(el => el.addEventListener('change', ev => {
            const key = ev.target.dataset.option;
            const value = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
            this.importState.options[key] = value;
            if (key === 'actorDestination' || key === 'itemDestination') this.render();
        }));
    }

    #refreshCounts() {
        const el = this.element.querySelector('[data-count="included"]');
        if (el) el.textContent = String(this.importState.entries.filter(e => e.include && !e.error).length);
    }

    /* -------------------------------------------- */
    /* Sources                                      */
    /* -------------------------------------------- */

    async #addFiles(fileList) {
        for (const file of Array.from(fileList ?? [])) {
            if (file.size > MAX_FILE_BYTES) { ui.notifications.warn(t('Errors.FileTooLarge', { name: file.name })); continue; }
            const id = foundry.utils.randomID();
            try {
                if (PDF_EXT.test(file.name) || file.type === 'application/pdf') {
                    this.importState.files.push({ id, name: file.name, kind: 'pdf', size: file.size, buffer: await file.arrayBuffer(), pages: '', columns: 'auto' });
                } else if (JSON_EXT.test(file.name) || file.type === 'application/json') {
                    this.importState.files.push({ id, name: file.name, kind: 'json', size: file.size, content: await file.text() });
                } else if (TEXT_EXT.test(file.name) || file.type.startsWith('text/')) {
                    const text = await file.text();
                    this.importState.text = [this.importState.text.trim(), text.trim()].filter(Boolean).join('\n\n---\n\n');
                    ui.notifications.info(t('Notes.TextAdded', { name: file.name }));
                } else {
                    ui.notifications.warn(t('Errors.UnsupportedFile', { name: file.name }));
                }
            } catch (err) {
                log.error(err);
                ui.notifications.error(t('Errors.ReadFailed', { name: file.name, error: err.message }));
            }
        }
        this.render();
    }

    async #extractPdfs() {
        const pdfs = this.importState.files.filter(f => f.kind === 'pdf');
        if (!pdfs.length) return;
        const token = { cancelled: false };
        this.importState.pdf = { busy: true, progress: 0, label: '', token };
        this.render();
        const texts = [];
        const notes = [];
        try {
            for (const [n, file] of pdfs.entries()) {
                const result = await extractPdfText(file.buffer.slice(0), {
                    pages: file.pages,
                    columns: file.columns,
                    token,
                    onProgress: ({ page, done, total }) => {
                        this.importState.pdf.progress = Math.round(((n + done / Math.max(1, total)) / pdfs.length) * 100);
                        this.importState.pdf.label = page ? t('Pdf.Reading', { name: file.name, page }) : '';
                        const bar = this.element?.querySelector('.sr5i-pdf-progress progress');
                        if (bar) bar.value = this.importState.pdf.progress;
                        const lbl = this.element?.querySelector('.sr5i-pdf-progress .label');
                        if (lbl) lbl.textContent = this.importState.pdf.label;
                    },
                });
                if (result.emptyPages.length) notes.push(t('Pdf.EmptyPages', { name: file.name, pages: result.emptyPages.join(', ') }));
                texts.push(result.text);
                if (token.cancelled) break;
            }
            if (texts.length) {
                this.importState.text = [this.importState.text.trim(), ...texts.map(x => x.trim())].filter(Boolean).join('\n\n---\n\n');
                this.importState.files = this.importState.files.filter(f => f.kind !== 'pdf');
                ui.notifications.info(t('Pdf.Done'));
            }
        } catch (err) {
            log.error(err);
            ui.notifications.error(t('Errors.PdfFailed', { error: err.message }));
        } finally {
            this.importState.pdf = { busy: false, progress: 0, label: '', token: null };
            this.importState.parseNotes = notes;
            this.render();
        }
    }

    #parseAll() {
        const s = this.importState;
        const opts = { defaultType: s.defaultType, forceType: s.forceType || undefined };
        const records = [];
        const notes = [];
        if (s.text.trim()) {
            try {
                const res = looksLikeJSON(s.text) ? parseJSON(s.text, { ...opts, sourceLabel: t('Labels.PastedText') }) : parseText(s.text, { ...opts, sourceLabel: t('Labels.PastedText') });
                records.push(...res.records);
                if (res.skipped?.length) notes.push(t('Notes.Skipped', { count: res.skipped.length, lines: res.skipped.slice(0, 5).join(' | ') }));
            } catch (err) {
                notes.push(err.message);
            }
        }
        for (const f of s.files) {
            if (f.kind === 'pdf') continue;
            try {
                const res = f.kind === 'json' ? parseJSON(f.content, { ...opts, sourceLabel: f.name }) : parseText(f.content, { ...opts, sourceLabel: f.name });
                records.push(...res.records);
                if (res.skipped?.length) notes.push(`${f.name}: ${res.skipped.join('; ')}`);
            } catch (err) {
                notes.push(`${f.name}: ${err.message}`);
            }
        }
        s.entries = buildEntries(records);
        s.parseNotes = notes;
        s.summary = null;
        s.expanded.clear();
        return records.length;
    }

    #changeEntryType(entry, newType) {
        const documentName = ACTOR_TYPES.includes(newType) && !ITEM_TYPES.includes(newType) ? 'Actor' : 'Item';
        let record = entry.record;
        if (record.raw && !record.native) {
            // Re-parse the original text as the chosen type.
            const res = parseText(record.raw, { forceType: newType, defaultType: newType });
            if (res.records[0]) record = { ...res.records[0], name: entry.name, source: record.source };
        } else if (!record.native) {
            record = { ...record, type: newType, documentName };
        } else {
            record = { ...record, type: newType, documentName, data: { ...record.data, type: newType } };
        }
        record.type = newType;
        record.documentName = documentName;
        const rebuilt = buildEntry(record);
        rebuilt.id = entry.id;
        rebuilt.include = entry.include;
        const i = this.importState.entries.indexOf(entry);
        this.importState.entries[i] = rebuilt;
        this.render();
    }

    #saveOptions() {
        const o = this.importState.options;
        game.settings.set(MODULE_ID, 'importerOptions', {
            defaultType: this.importState.defaultType,
            actorFolder: o.actorFolder, itemFolder: o.itemFolder, duplicates: o.duplicates,
            matchItems: o.matchItems, reconcile: o.reconcile, openAfter: o.openAfter,
        });
    }

    /* -------------------------------------------- */
    /* Actions                                      */
    /* -------------------------------------------- */

    static async #onParse() {
        if (this.importState.files.some(f => f.kind === 'pdf')) await this.#extractPdfs();
        const n = this.#parseAll();
        if (!n) {
            ui.notifications.warn(t('Errors.NothingFound'));
            const s = this.importState;
            s.guide = { open: true, topic: guideTopicFor(s.forceType) ?? s.guide.topic };
            this.render();
            return;
        }
        this.importState.step = 'preview';
        this.render();
    }

    static async #onExtractPdf() { await this.#extractPdfs(); }
    static #onCancelPdf() { if (this.importState.pdf.token) this.importState.pdf.token.cancelled = true; }

    static async #onImport() {
        const s = this.importState;
        if (s.busy) return;
        this.#saveOptions();
        s.busy = true;
        s.progress = { done: 0, total: s.entries.filter(e => e.include && !e.error).length, name: '' };
        this.render();
        try {
            const summary = await importEntries(s.entries, {
                ...s.options,
                onProgress: p => {
                    s.progress = p;
                    const bar = this.element?.querySelector('.sr5i-import-progress progress');
                    if (bar) { bar.max = p.total; bar.value = p.done; }
                    const lbl = this.element?.querySelector('.sr5i-import-progress .label');
                    if (lbl) lbl.textContent = p.name ? t('Import.Working', { name: p.name, done: p.done + 1, total: p.total }) : '';
                },
            });
            s.summary = summary;
            const created = summary.created.length + summary.replaced.length;
            if (created) ui.notifications.info(t('Import.Done', { count: created }));
            if (summary.failed.length) ui.notifications.warn(t('Import.Failed', { count: summary.failed.length }));
            // Imported entries are unticked so a second click doesn't duplicate them.
            const doneNames = new Set([...summary.created, ...summary.replaced, ...summary.skipped].map(d => d.name));
            for (const e of s.entries) if (doneNames.has(e.data?.name)) e.include = false;
            if (s.options.openAfter) {
                for (const d of [...summary.created, ...summary.replaced].slice(0, 5)) (await fromUuid(d.uuid))?.sheet?.render(true);
            }
        } catch (err) {
            log.error(err);
            ui.notifications.error(err.message);
        } finally {
            s.busy = false;
            s.progress = null;
            this.render();
        }
    }

    static #onClearText() { this.importState.text = ''; this.render(); }
    static #onClearEntries() { this.importState.entries = []; this.importState.summary = null; this.importState.step = 'source'; this.render(); }
    static #onRemoveFile(event, target) {
        const id = target.closest('[data-file-id]')?.dataset.fileId;
        this.importState.files = this.importState.files.filter(f => f.id !== id);
        this.render();
    }
    static #onSelectAll() { for (const e of this.importState.entries) if (!e.error) e.include = true; this.render(); }
    static #onSelectNone() { for (const e of this.importState.entries) e.include = false; this.render(); }
    static #onToggleDetails(event, target) {
        const id = target.closest('[data-entry-id]')?.dataset.entryId;
        if (this.importState.expanded.has(id)) this.importState.expanded.delete(id); else this.importState.expanded.add(id);
        this.render();
    }
    static #onRemoveEntry(event, target) {
        const id = target.closest('[data-entry-id]')?.dataset.entryId;
        this.importState.entries = this.importState.entries.filter(e => e.id !== id);
        this.render();
    }
    static async #onOpenDocument(event, target) {
        const doc = await fromUuid(target.dataset.uuid);
        doc?.sheet?.render(true);
    }
    static #onPickFiles() { this.element.querySelector('input[name="fileInput"]')?.click(); }
    static async #onLoadSample(event, target) {
        const file = target.dataset.sample;
        try {
            const res = await fetch(route(`modules/${MODULE_ID}/samples/${file}`));
            const text = await res.text();
            if (JSON_EXT.test(file)) this.importState.files.push({ id: foundry.utils.randomID(), name: file, kind: 'json', size: text.length, content: text });
            else this.importState.text = [this.importState.text.trim(), text.trim()].filter(Boolean).join('\n\n---\n\n');
            this.render();
        } catch (err) {
            ui.notifications.error(err.message);
        }
    }
    static #onGuideTopic(event, target) {
        this.importState.guide = { open: true, topic: target.dataset.topic };
        this.render();
    }
    static #onInsertExample(event, target) {
        const g = FORMAT_GUIDE.find(x => x.id === target.dataset.topic);
        if (!g) return;
        this.importState.text = [this.importState.text.trim(), g.example].filter(Boolean).join('\n\n---\n\n');
        this.render();
    }
    static #onSetStep(event, target) {
        const step = target.dataset.step;
        if (step !== 'source' && !this.importState.entries.length) return;
        this.importState.step = step;
        this.render();
    }
}

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
