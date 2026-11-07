// User symbol library: ROOT/library/symbols/<id>.json, loaded into the shared registry at start.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';
import { registerSymbols, unregisterSymbol, normalizeSymbol, symbolDef, BY_ID } from '../core/symbols.js';

export const LIB = path.join(ROOT, 'library', 'symbols');

export function loadLibrary() {
  fs.mkdirSync(LIB, { recursive: true });
  const defs = [];
  for (const f of fs.readdirSync(LIB).filter(f => f.endsWith('.json'))) {
    try { defs.push(JSON.parse(fs.readFileSync(path.join(LIB, f), 'utf8'))); }
    catch (e) { console.warn(`library: skipped ${f}: ${e.message}`); }
  }
  const r = registerSymbols(defs);
  for (const e of r.errors) console.warn(`library: ${e}`);
  return r;
}

export function listLibrary() {
  return Object.values(BY_ID).filter(s => s.custom && fs.existsSync(path.join(LIB, `${s.id}.json`))).map(symbolDef);
}

export function saveSymbol(def) {
  const s = normalizeSymbol(def);
  fs.mkdirSync(LIB, { recursive: true });
  const out = symbolDef(s);
  fs.writeFileSync(path.join(LIB, `${s.id}.json`), JSON.stringify(out, null, 1));
  registerSymbols([out]);
  return out;
}

/** Moves the file to library/_trash; projects that use the symbol keep their embedded copy. */
export function deleteSymbol(id) {
  const f = path.join(LIB, `${String(id).replace(/[^\w]/g, '')}.json`);
  if (!fs.existsSync(f)) throw Object.assign(new Error(`symbol "${id}" not in the library`), { status: 404 });
  const trash = path.join(LIB, '..', '_trash');
  fs.mkdirSync(trash, { recursive: true });
  fs.renameSync(f, path.join(trash, `${id}-${Date.now()}.json`));
  unregisterSymbol(id);
}
