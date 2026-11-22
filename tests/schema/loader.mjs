import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
export async function resolve(spec, ctx, next) {
  let s = spec;
  if (s.startsWith('@/')) s = pathToFileURL(path.join(root, s.slice(2))).href;
  else if (s.startsWith('src/')) s = pathToFileURL(path.join(root, s.slice(4))).href;
  if ((s.startsWith('.') || s.startsWith('file:')) && !/\.(ts|mjs|js)$/.test(s)) {
    const base = s.startsWith('file:') ? fileURLToPath(s) : path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), s);
    if (existsSync(base + '.ts')) return next(pathToFileURL(base + '.ts').href, ctx);
  }
  return next(s, ctx);
}
