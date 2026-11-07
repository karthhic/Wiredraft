// Project model (browser + Node).
//
// meta.language '' = drawings follow the interface language; a code (en, fi...) fixes it per project.
// project = { format, name, rev, meta, devices: {tag: props}, cables: {tag: props}, pages: [page] }
// page    = { id, number, title, kind: 'cover'|'schematic'|'report', report?, paper?, items }
// items   = { syms: [sym], wires: [wire], texts: [text], lines: [line], rects: [rect] }
// sym     = { id, sym, tag, x, y, rot, props }          props = placement-local values
// wire    = { id, a: {s, p}, b: {s, p}, props: {wire, size, color, potential, cable, core}, pts? }

import { BY_ID, shapeOf } from './symbols.js';
import { rotPt, normRot } from './geom.js';

export const FORMAT = 'wiredraft/1';
export const GRID = 4;
export const snap = (v, g = GRID) => Math.round(v / g) * g;
export const clone = o => JSON.parse(JSON.stringify(o));

export const PAPERS = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
};

export function newProject(name, meta = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const p = {
    format: FORMAT, name, rev: 0,
    meta: {
      title: name, description: '', customer: '', company: '', address: '', phone: '', drawingNo: '',
      paper: 'A3', language: '', func: '', loc: '', template: 'standard', date: today,
      drawnBy: '', approved: '', revision: '0', logo: null, ...meta,
    },
    devices: {}, cables: {}, pages: [],
  };
  addPage(p, { number: '1', title: 'Title page', kind: 'cover' });
  addPage(p, { number: '2', title: 'Schematic', kind: 'schematic' });
  return p;
}

export const emptyItems = () => ({ syms: [], wires: [], texts: [], lines: [], rects: [] });

export function uid(prefix, taken) {
  let i = taken.size + 1, id;
  do id = `${prefix}${(i++).toString(36)}`; while (taken.has(id));
  return id;
}
export const pageIds = proj => new Set(proj.pages.map(p => p.id));
export const itemIds = page => new Set(Object.values(page.items).flat().map(x => x.id));

export function addPage(proj, { number, title = '', kind = 'schematic', after, report, paper } = {}) {
  // a requested number that is already taken (e.g. from the AI) falls back to the next free one
  const wanted = number != null && number !== '' ? String(number) : null;
  const free = wanted && !proj.pages.some(p => p.number === wanted);
  const page = { id: uid('p', pageIds(proj)), number: free ? wanted : nextPageNumber(proj), title, kind, items: emptyItems() };
  if (report) page.report = report;
  if (paper) page.paper = paper;
  const idx = after ? proj.pages.findIndex(p => p.id === after || p.number === String(after)) : -1;
  if (idx >= 0) proj.pages.splice(idx + 1, 0, page); else proj.pages.push(page);
  return page;
}

export function nextPageNumber(proj) {
  const nums = proj.pages.map(p => parseFloat(p.number)).filter(isFinite);
  return String(nums.length ? Math.floor(Math.max(...nums)) + 1 : 1);
}

export function getPage(proj, ref) {
  if (ref == null) return null;
  const r = String(ref);
  return proj.pages.find(p => p.id === r) || proj.pages.find(p => p.number === r) || null;
}

export const paperOf = (proj, page) => PAPERS[page?.paper || proj.meta.paper] ? (page?.paper || proj.meta.paper) : 'A3';

// ------------------------------------------------------------------ devices and tags
export const normTag = t => {
  const s = String(t ?? '').trim();
  if (!s) return '';
  return /^[-=+]/.test(s) ? s : `-${s}`;
};

export function nextTag(proj, letter) {
  let n = 0;
  const re = new RegExp(`^-${letter}(\\d+)$`);
  for (const t of Object.keys(proj.devices)) { const m = t.match(re); if (m) n = Math.max(n, +m[1]); }
  for (const pg of proj.pages) for (const s of pg.items.syms) { const m = s.tag?.match(re); if (m) n = Math.max(n, +m[1]); }
  return `-${letter}${n + 1}`;
}

export function placements(proj, tag) {
  const out = [];
  for (const page of proj.pages) for (const s of page.items.syms) if (tag == null || s.tag === tag) out.push({ page, s });
  return out;
}

/** Symbol definition + live shape (pins, primitives) for a placed symbol. */
export function shape(proj, s) {
  const sym = BY_ID[s.sym];
  return { sym, ...shapeOf(sym, { props: s.props, device: proj.devices[s.tag] }) };
}

export function dims(proj, s) {
  const { sym, w, h } = shape(proj, s);
  const W = w ?? sym?.w ?? 8, H = h ?? sym?.h ?? 8;
  return normRot(s.rot) % 180 ? { w: H, h: W } : { w: W, h: H };
}

export function pinWorld(proj, s, pinId) {
  const sh = shape(proj, s);
  const p = sh.pins.find(p => p.id === pinId);
  if (!p) return null;
  const [x, y] = rotPt(p.x, p.y, s.rot);
  let dir = null;
  if (!p.node) {
    // exit direction from the edge the pin sits on (top/bottom first), in local coordinates
    const W = sh.w ?? sh.sym?.w ?? 8, H = sh.h ?? sh.sym?.h ?? 8;
    let d;
    if (Math.abs(p.y) >= H / 2 - 0.5) d = [0, Math.sign(p.y) || 1];
    else if (Math.abs(p.x) >= W / 2 - 0.5) d = [Math.sign(p.x) || 1, 0];
    else d = Math.abs(p.x) > Math.abs(p.y) ? [Math.sign(p.x), 0] : [0, Math.sign(p.y) || 1];
    dir = rotPt(d[0], d[1], s.rot).map(v => Math.round(v));
  }
  return { x: s.x + x, y: s.y + y, dir };
}

/** Resolve "s12.2", "-F1:2", "-F1.2" or "-K1:A1" on a page to { s, p }. */
export function resolvePin(proj, page, spec) {
  const str = String(spec ?? '').trim();
  // an interruption point or connection point can be named without a pin: "L+", "L1_F2"
  const xrefHit = page.items.syms.find(s => BY_ID[s.sym]?.xref && (s.props?.name === str || s.props?.name === str.replace(/[.:]1$/, '')));
  if (xrefHit) return { s: xrefHit.id, p: '1' };
  const m = str.match(/^(.+?)[.:]([^.:]+)$/);
  if (!m) {
    const one = page.items.syms.find(s => s.id === str || s.tag === normTag(str));
    const pins = one ? shape(proj, one).pins : [];
    if (pins.length === 1) return { s: one.id, p: pins[0].id };
    throw new Error(`bad pin reference "${spec}" (use TAG:PIN, e.g. -F1:2)`);
  }
  const [, who, pinRaw0] = m;
  const pinRaw = pinRaw0.replace(/\s*[([].*$/, '');
  let cands = page.items.syms.filter(s => s.id === who);
  if (!cands.length) { const tag = normTag(who); cands = page.items.syms.filter(s => s.tag === tag); }
  if (!cands.length) throw new Error(`no symbol "${who}" on page ${page.number}`);
  for (const s of cands) {
    const pins = shape(proj, s).pins;
    const p = pins.find(p => p.id === pinRaw) || pins.find(p => p.id.toLowerCase() === pinRaw.toLowerCase());
    if (p) return { s: s.id, p: p.id };
  }
  const pins = cands.flatMap(s => shape(proj, s).pins.map(p => p.id));
  throw new Error(`${who} has no pin "${pinRaw}" (pins: ${[...new Set(pins)].join(', ')})`);
}

// ------------------------------------------------------------------ nets
/** Union-find over the pins of one page; connection points merge everything wired to them. */
export function pageNets(page) {
  const parent = new Map();
  const find = k => { if (!parent.has(k)) parent.set(k, k); while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const union = (a, b) => parent.set(find(a), find(b));
  for (const w of page.items.wires) union(`${w.a.s}.${w.a.p}`, `${w.b.s}.${w.b.p}`);
  return { find };
}

/** Real device pins electrically connected to a pin (through wires and connection points). */
export function connectedPins(proj, page, sid, pin) {
  const { find } = pageNets(page);
  const root = find(`${sid}.${pin}`);
  const out = [];
  for (const s of page.items.syms) {
    const sym = BY_ID[s.sym];
    if (!sym || sym.id === 'node') continue;
    for (const p of shape(proj, s).pins) {
      if (s.id === sid && p.id === pin) continue;
      if (find(`${s.id}.${p.id}`) === root && page.items.wires.some(w => (w.a.s === s.id && w.a.p === p.id) || (w.b.s === s.id && w.b.p === p.id)))
        out.push({ s, pin: p.id });
    }
  }
  return out;
}

/**
 * Devices reached first from a pin, walking wires through connection points only.
 * This is what a terminal diagram lists as "target": the device wired to the terminal,
 * not every device on the same potential.
 */
export function nearestDevices(page, sid, pin) {
  const adj = new Map(), key = (s, p) => `${s}\u0000${p}`;
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  for (const w of page.items.wires) { const a = key(w.a.s, w.a.p), b = key(w.b.s, w.b.p); link(a, b); link(b, a); }
  const syms = new Map(page.items.syms.map(s => [s.id, s]));
  let frontier = [key(sid, pin)];
  const seen = new Set(frontier);
  while (frontier.length) {
    const next = [], found = [];
    for (const k of frontier) for (const n of adj.get(k) || []) {
      if (seen.has(n)) continue;
      seen.add(n);
      const [s, p] = n.split('\u0000'), sym = syms.get(s);
      if (!sym) continue;
      if (sym.sym === 'node') next.push(...[n]);
      else found.push({ s: sym, pin: p });
    }
    if (found.length) return found;
    frontier = next;
  }
  return [];
}

export const wiresAt =(page, sid, pin) => page.items.wires.filter(w => (w.a.s === sid && w.a.p === pin) || (w.b.s === sid && w.b.p === pin));
