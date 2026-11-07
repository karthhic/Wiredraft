// Language files: ROOT/lang/<code>.json = { meta: {code, name, englishName, direction}, strings: {...} }.
// Any file dropped into the folder becomes a language; English is the fallback.

import fs from 'node:fs';
import path from 'node:path';
import { LANG } from './paths.js';
import { makeT } from '../core/i18n.js';

const cache = new Map();

export function listLangs() {
  let files = [];
  try { files = fs.readdirSync(LANG).filter(f => /^[\w-]+\.json$/.test(f)); } catch { /* no folder */ }
  return files.map(f => {
    const j = readLang(f.slice(0, -5));
    return j && { code: j.meta?.code || f.slice(0, -5), name: j.meta?.name || f.slice(0, -5), englishName: j.meta?.englishName || '', direction: j.meta?.direction || 'ltr' };
  }).filter(Boolean).sort((a, b) => (a.code === 'en' ? -1 : b.code === 'en' ? 1 : a.name.localeCompare(b.name)));
}

export function readLang(code) {
  const f = path.join(LANG, `${String(code).replace(/[^\w-]/g, '')}.json`);
  try {
    const st = fs.statSync(f);
    const hit = cache.get(f);
    if (hit && hit.mtime === st.mtimeMs) return hit.data;
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    cache.set(f, { mtime: st.mtimeMs, data });
    return data;
  } catch { return null; }
}

/** Translator for drawings: the project's fixed language, or else the interface language from config.json. */
export function drawingTranslator(proj, uiLang) {
  return translator(proj.meta?.language || uiLang || 'en');
}

export function translator(code) {
  const en = readLang('en')?.strings || {};
  const dict = readLang(code)?.strings || {};
  return makeT(dict, en, code || 'en');
}
