/**
 * Validate the importer's output against the SR5 system's real DataModel schemas.
 *
 *   node tests/schema/check.mjs <path to SR5-FoundryVTT checkout> [input files...]
 *
 * Needs Node 22.6+ (TypeScript type stripping). Copies the system's schema sources into a
 * temporary folder, swaps a few heavy helpers for stubs, loads every Actor/Item DataModel
 * with a minimal foundry.data.fields shim, then parses the inputs (default: samples/*) and
 * checks every built `system` field exists with the right type, integer-ness and choices.
 */
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { STUBS } from './stubs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleDir = path.resolve(here, '../..');
const [systemDir, ...inputs] = process.argv.slice(2);
if (!systemDir) { console.error('Usage: node tests/schema/check.mjs <SR5-FoundryVTT dir> [files...]'); process.exit(2); }

if (!process.env.SR5I_SCHEMA_DIR) {
    const work = mkdtempSync(path.join(tmpdir(), 'sr5i-schema-'));
    cpSync(path.join(systemDir, 'src/module/types'), path.join(work, 'module/types'), { recursive: true });
    cpSync(path.join(systemDir, 'src/module/config.ts'), path.join(work, 'module/config.ts'));
    for (const [rel, src] of Object.entries(STUBS)) {
        mkdirSync(path.dirname(path.join(work, "module", rel)), { recursive: true });
        writeFileSync(path.join(work, "module", rel), src);
    }
    for (const f of ['shim.mjs', 'loader.mjs', 'register.mjs']) cpSync(path.join(here, f), path.join(work, f));
    const files = inputs.length ? inputs.map(f => path.resolve(f)) : readdirSync(path.join(moduleDir, 'samples')).map(f => path.join(moduleDir, 'samples', f));
    const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', './register.mjs', fileURLToPath(import.meta.url), systemDir, ...files], {
        cwd: work, stdio: 'inherit', env: { ...process.env, SR5I_SCHEMA_DIR: work },
    });
    process.exit(r.status ?? 1);
}

// ---- Child process: schemas are loadable here ----
const work = process.env.SR5I_SCHEMA_DIR;
await import(pathToFileURL(path.join(work, 'shim.mjs')).href);
const quiet = console.log; console.log = () => {};
const files = {
    item: ['Action', 'AdeptPower', 'Ammo', 'Armor', 'Bioware', 'CallInAction', 'ComplexForm', 'Contact', 'CritterPower', 'Cyberware', 'Device', 'Echo', 'Equipment', 'Host', 'Lifestyle', 'Metamagic', 'Modification', 'Program', 'Quality', 'Ritual', 'Sin', 'Skill', 'Spell', 'SpritePower', 'Weapon'],
    actor: ['Character', 'IC', 'Spirit', 'Sprite', 'Vehicle'],
};
const key = n => n === 'IC' ? 'ic' : n.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
const schemas = { Item: {}, Actor: {} };
for (const [doc, names] of Object.entries(files)) {
    for (const n of names) {
        const mod = await import(pathToFileURL(path.join(work, `module/types/${doc}/${n}.ts`)).href);
        const cls = Object.values(mod).find(v => typeof v === 'function' && v.defineSchema && v !== foundry.abstract.TypeDataModel);
        schemas[doc === 'item' ? 'Item' : 'Actor'][key(n)] = cls.defineSchema();
    }
}
console.log = quiet;

const { parseText } = await import(pathToFileURL(path.join(moduleDir, 'scripts/parsers/text-parser.js')).href);
const { parseJSON } = await import(pathToFileURL(path.join(moduleDir, 'scripts/parsers/json-parser.js')).href);
const { buildAll } = await import(pathToFileURL(path.join(moduleDir, 'tests/pipeline.mjs')).href);
const { readFileSync } = await import('node:fs');

function check(field, value, p, errors) {
    if (!field) return errors.push(`${p}: no such field`);
    if (field.fields) {
        if (value === null && field.options?.nullable) return;
        if (typeof value !== 'object' || Array.isArray(value) || value === null) return errors.push(`${p}: expected object`);
        for (const [k, v] of Object.entries(value)) check(field.fields[k], v, `${p}.${k}`, errors);
        return;
    }
    const kind = field.kind;
    if (kind === 'NumberField') {
        if (typeof value !== 'number' || Number.isNaN(value)) return errors.push(`${p}: expected number, got ${JSON.stringify(value)}`);
        if (field.options.integer && !Number.isInteger(value)) errors.push(`${p}: expected integer, got ${value}`);
        if (field.options.min !== undefined && value < field.options.min) errors.push(`${p}: ${value} below min ${field.options.min}`);
        return;
    }
    if (kind === 'BooleanField') { if (typeof value !== 'boolean') errors.push(`${p}: expected boolean`); return; }
    if (kind === 'ArrayField') {
        if (!Array.isArray(value)) return errors.push(`${p}: expected array`);
        value.forEach((v, i) => check(field.element, v, `${p}[${i}]`, errors));
        return;
    }
    if (/String|HTML|UUID|TagifySelect/.test(kind)) {
        if (typeof value !== 'string') return errors.push(`${p}: expected string, got ${JSON.stringify(value)}`);
        const c = field.options.choices;
        const choices = c ? (Array.isArray(c) ? c : Object.keys(c)) : null;
        if (choices && value !== '' && !choices.includes(value)) errors.push(`${p}: "${value}" not one of ${choices.join(', ')}`);
    }
}

let total = 0;
let bad = 0;
for (const f of process.argv.slice(3)) {
    const text = readFileSync(f, 'utf8');
    const { records } = /\.jsonl?$/.test(f) ? parseJSON(text) : parseText(text);
    for (const b of buildAll(records)) {
        total++;
        const schema = schemas[b.kind][b.data.type];
        const errors = [];
        if (!schema) errors.push(`unknown ${b.kind} type ${b.data.type}`);
        else for (const [k, v] of Object.entries(b.data.system)) check(schema[k], v, `system.${k}`, errors);
        if (errors.length) { bad++; console.log(`✗ ${b.kind} ${b.data.type} "${b.data.name}"${b.owner ? ` on ${b.owner}` : ''}\n   ${errors.join('\n   ')}`); }
    }
}
console.log(`${total - bad}/${total} built documents match the SR5 DataModels.`);
process.exit(bad ? 1 : 0);
