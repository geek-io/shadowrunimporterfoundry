/**
 * Shadowrun 5e Importer — entry point.
 */
import { MODULE_ID, SYSTEM_ID, t, asElement, canImport, log } from './app/compat.js';
import { SR5ImporterApp } from './app/importer-app.js';
import { parseText } from './parsers/text-parser.js';
import { parseJSON } from './parsers/json-parser.js';
import { buildEntries, importEntries, ItemLibrary } from './app/creator.js';
import { extractPdfText } from './app/pdf.js';

let app = null;

export function openImporter(options = {}) {
    if (game.system.id !== SYSTEM_ID) return ui.notifications.error(t('Errors.WrongSystem'));
    if (!app || options.fresh) app = new SR5ImporterApp(options);
    else if (options.text) { app.importState.text = options.text; app.importState.step = 'source'; }
    return app.render({ force: true });
}

Hooks.once('init', () => {
    game.settings.register(MODULE_ID, 'importerOptions', {
        name: 'SR5IMPORTER.Settings.Options',
        scope: 'client',
        config: false,
        type: Object,
        default: {},
    });
});

Hooks.once('ready', () => {
    const mod = game.modules.get(MODULE_ID);
    mod.api = {
        open: openImporter,
        parseText,
        parseJSON,
        extractPdfText,
        buildEntries,
        importEntries,
        ItemLibrary,
        /**
         * Import text or JSON without the window.
         * @example game.modules.get('sr5-importer').api.importText(text, { actorFolder: 'NPCs' })
         */
        async importText(text, options = {}) {
            const parsed = String(text).trim().startsWith('{') || String(text).trim().startsWith('[')
                ? parseJSON(text, options) : parseText(text, options);
            const entries = buildEntries(parsed.records, options);
            return importEntries(entries, {
                actorDestination: 'world', itemDestination: 'world', duplicates: 'skip',
                matchItems: true, reconcile: true, ...options,
            });
        },
    };
    if (game.system.id !== SYSTEM_ID) log.warn('Not running the Shadowrun 5e system; importer disabled.');
});

function addButton(html, documentName) {
    if (game.system.id !== SYSTEM_ID || !canImport()) return;
    const root = asElement(html);
    if (!root || root.querySelector('.sr5-importer-open')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sr5-importer-open';
    button.innerHTML = `<i class="fa-solid fa-file-import"></i> <span>${t('OpenButton')}</span>`;
    button.dataset.tooltip = t('Title');
    button.addEventListener('click', ev => { ev.preventDefault(); openImporter(); });
    const target = root.querySelector('.header-actions') ?? root.querySelector('.directory-header') ?? root;
    target.append(button);
    void documentName;
}

Hooks.on('renderActorDirectory', (app, html) => addButton(html, 'Actor'));
Hooks.on('renderItemDirectory', (app, html) => addButton(html, 'Item'));
Hooks.on('renderCompendiumDirectory', (app, html) => addButton(html, 'Compendium'));
