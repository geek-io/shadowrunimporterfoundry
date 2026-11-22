/**
 * Small helpers that smooth over Foundry v13 / v14 differences.
 */
export const MODULE_ID = 'sr5-importer';
export const SYSTEM_ID = 'shadowrun5e';

const prefix = 'SR5 Importer |';
export const log = {
    info: (...a) => console.log(prefix, ...a),
    warn: (...a) => console.warn(prefix, ...a),
    error: (...a) => console.error(prefix, ...a),
};

export const generation = () => Number(game.release?.generation ?? String(game.version ?? '0').split('.')[0]);
export const isV14 = () => generation() >= 14;

/** SR5 system 0.35+ stores skills as Items of type "skill". Earlier versions keep them on the actor. */
export const hasSkillItems = () => 'skill' in (game.system.documentTypes?.Item ?? {});

export function t(key, data) {
    const full = `SR5IMPORTER.${key}`;
    return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

export const renderTemplate = (...args) =>
    (foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate)(...args);

export const route = path => (foundry.utils.getRoute ? foundry.utils.getRoute(path) : `/${path}`);

/** Sidebar render hooks pass an HTMLElement in v13+, jQuery in older versions. */
export const asElement = html => (html instanceof HTMLElement ? html : html?.[0] ?? null);

export function canImport() {
    return game.user.isGM || game.user.can('ACTOR_CREATE') || game.user.can('ITEM_CREATE');
}
