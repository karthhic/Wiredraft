// Project storage: one folder per project (<name>.wdp) with plain JSON files.
//   project.json  format, rev, meta (title block, company, paper, language...), page order
//   devices.json  { tag: props }
//   cables.json   { tag: { type, length, from, to, desc } }
//   pages/<id>.json
// project.json also embeds the custom symbols the project uses, so it opens anywhere.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';
import { FORMAT, newProject } from '../core/model.js';
import { BY_ID, registerSymbols, symbolDef } from '../core/symbols.js';

export const DIR = path.resolve(process.env.WIREDRAFT_PROJECTS || path.join(ROOT, 'projects'));
fs.mkdirSync(DIR, { recursive: true });

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export function safeName(n) {
  const s = String(n ?? '').trim().replace(/\.wdp$/i, '').replace(/[^\w\- ]+/g, '-').replace(/^[-\s]+|[-\s]+$/g, '').slice(0, 64);
  if (!s) throw httpError(400, 'invalid project name');
  return s;
}

const dirOf = n => path.join(DIR, `${safeName(n)}.wdp`);
const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
function writeAtomic(f, data) {
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 1));
  fs.renameSync(tmp, f);
}

export const exists = n => fs.existsSync(path.join(dirOf(n), 'project.json'));

export function list() {
  return fs.readdirSync(DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.endsWith('.wdp'))
    .map(d => {
      const f = path.join(DIR, d.name, 'project.json');
      const j = readJson(f, null);
      if (!j) return null;
      return { name: d.name.slice(0, -4), title: j.meta?.title, rev: j.rev ?? 0, pages: j.pageOrder?.length ?? 0, mtime: fs.statSync(f).mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

export function diskRev(n) { return readJson(path.join(dirOf(n), 'project.json'), {}).rev ?? 0; }

export function load(n) {
  const dir = dirOf(n);
  const pj = readJson(path.join(dir, 'project.json'), null);
  if (!pj) throw httpError(404, `project "${n}" not found`);
  const pages = (pj.pageOrder || []).map(id => readJson(path.join(dir, 'pages', `${id}.json`), null)).filter(Boolean);
  for (const p of pages) p.items = { syms: [], wires: [], texts: [], lines: [], rects: [], ...(p.items || {}) };
  // the local library wins; embedded copies fill in symbols this PC does not have
  if (pj.symbols?.length) registerSymbols(pj.symbols, { override: false });
  return {
    symbols: pj.symbols || [],
    format: pj.format || FORMAT, name: safeName(n), rev: pj.rev ?? 0, meta: pj.meta || {},
    devices: readJson(path.join(dir, 'devices.json'), {}), cables: readJson(path.join(dir, 'cables.json'), {}), pages,
  };
}

/** Save with optimistic concurrency: if expectRev is given and differs from disk, 409 with the current project. */
export function save(proj, { expectRev } = {}) {
  const name = safeName(proj.name), dir = dirOf(name);
  const cur = exists(name) ? diskRev(name) : 0;
  if (expectRev != null && exists(name) && expectRev !== cur) throw httpError(409, 'project was changed elsewhere', { current: load(name) });
  const rev = cur + 1;
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  for (const page of proj.pages) {
    const f = path.join(dir, 'pages', `${page.id}.json`);
    const body = JSON.stringify(page, null, 1);
    if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== body) writeAtomic(f, body);
  }
  const keep = new Set(proj.pages.map(p => `${p.id}.json`));
  for (const f of fs.readdirSync(path.join(dir, 'pages'))) if (f.endsWith('.json') && !keep.has(f)) fs.unlinkSync(path.join(dir, 'pages', f));
  writeAtomic(path.join(dir, 'devices.json'), proj.devices || {});
  writeAtomic(path.join(dir, 'cables.json'), proj.cables || {});
  const used = [...new Set(proj.pages.flatMap(p => p.items.syms.map(s => s.sym)))].filter(id => BY_ID[id]?.custom);
  const symbols = used.map(id => symbolDef(BY_ID[id]));
  writeAtomic(path.join(dir, 'project.json'), { format: FORMAT, rev, meta: proj.meta, pageOrder: proj.pages.map(p => p.id), ...(symbols.length ? { symbols } : {}) });
  return { ...proj, name, rev, symbols };
}

export function create(name, meta = {}) {
  name = safeName(name);
  if (exists(name)) throw httpError(409, `project "${name}" already exists`);
  return save(newProject(name, meta));
}

export function importProject(proj, name) {
  name = safeName(name || proj.name);
  let n = name, i = 2;
  while (exists(n)) n = `${name}-${i++}`;
  if (proj.symbols?.length) registerSymbols(proj.symbols, { override: false });
  return save({ ...proj, name: n, rev: 0 });
}

/** Moves the folder to projects/_trash instead of deleting it. */
export function remove(name) {
  const dir = dirOf(name);
  if (!fs.existsSync(dir)) throw httpError(404, `project "${name}" not found`);
  const trash = path.join(DIR, '_trash');
  fs.mkdirSync(trash, { recursive: true });
  fs.renameSync(dir, path.join(trash, `${safeName(name)}-${Date.now()}.wdp`));
}

export const projectDir = dirOf;
