// Parse samples and build creation data without Foundry.
import { readFileSync } from 'node:fs';
import { parseText } from '../scripts/parsers/text-parser.js';
import { parseJSON } from '../scripts/parsers/json-parser.js';
import { buildItem } from '../scripts/build/item-builder.js';
import { buildActor } from '../scripts/build/actor-builder.js';

export function buildAll(records) {
  const out = [];
  for (const r of records) {
    if (r.documentName === 'Actor') {
      const { data, plan, warnings } = buildActor(r);
      out.push({ kind: 'Actor', data, warnings: [...r.warnings, ...warnings] });
      for (const c of plan.children) {
        if (c.native) continue;
        const b = buildItem({ type: c.type, name: c.name, fields: c.fields ?? {}, hint: c.hint ?? {}, owned: true });
        out.push({ kind: 'Item', owner: data.name, data: b.data, warnings: b.warnings });
      }
    } else if (!r.native) {
      const b = buildItem({ type: r.type, name: r.name, fields: r.fields, hint: r.hint ?? {} });
      out.push({ kind: 'Item', data: b.data, warnings: [...(r.warnings ?? []), ...b.warnings] });
    }
  }
  return out;
}

if (process.argv[1].endsWith('pipeline.mjs')) {
  const files = process.argv.slice(2);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const { records } = f.endsWith('.json') ? parseJSON(text) : parseText(text);
    for (const b of buildAll(records)) console.log(JSON.stringify(b));
  }
}
