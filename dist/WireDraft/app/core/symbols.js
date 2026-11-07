// IEC 60617-style symbol library. Units: mm, pins on a 4 mm grid, current flows top → bottom.
//
// letter : IEC 81346 class letter used for new device tags (-F1, -K3 ...); noTag = no device
// role   : 'main' (coil, main device view) | 'aux' (contacts shown elsewhere) — drives cross-references
// fields : device properties (shared by every view of the device)
// local  : properties of this placement only (terminal number, contact numbers, xref name)
// show   : what is printed beside the symbol, in order

import { L, P, C, A, R, T } from './geom.js';

export const CATEGORIES = ['custom', 'protection', 'switching', 'power', 'terminals', 'plc', 'general'];

export const SYMBOLS = [];
const def = s => { SYMBOLS.push({ fields: ['desc', 'part'], local: [], show: ['rating'], ...s }); };

const DASH = { dash: '1.2 0.8' };

// ------------------------------------------------------------------ helpers
const xs = n => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 8);

function polePins(n) {
  return xs(n).flatMap((x, i) => [{ id: String(2 * i + 1), x, y: -8 }, { id: String(2 * i + 2), x, y: 8 }]);
}
const pinNums = n => xs(n).flatMap((x, i) => [T(x + 0.8, -6, 2 * i + 1, 1.6), T(x + 0.8, 7.4, 2 * i + 2, 1.6)]);
const link = n => n > 1 ? [L(xs(n)[0] - 2, 0, xs(n).at(-1) - 1.4, 0, DASH)] : [];

function breakerPoles(n) {
  return xs(n).flatMap(x => [
    L(x, -8, x, -4), L(x - 0.9, -4.9, x + 0.9, -3.1), L(x - 0.9, -3.1, x + 0.9, -4.9),
    L(x, 4, x - 3, -3.6), L(x, 4, x, 8),
  ]);
}
function contactPoles(n) {
  return xs(n).flatMap(x => [L(x, -8, x, -3.5), A(x + 1, -3.5, 1, 180, 360), L(x, 3.5, x - 2.8, -3), L(x, 3.5, x, 8)]);
}
const handle = n => [L(xs(n)[0] - 2, 0, xs(n)[0] - 4.4, 0), L(xs(n)[0] - 4.4, 0, xs(n)[0] - 4.4, -1.6)];

// ------------------------------------------------------------------ protection
for (const n of [1, 2, 3, 4]) def({
  id: `mcb_${n}p`, name: `MCB ${n}-pole`, cat: 'protection', letter: 'F', w: 8 * n, h: 16,
  pins: polePins(n), prims: [...breakerPoles(n), ...link(n), ...handle(n), ...pinNums(n)],
  fields: ['rating', 'desc', 'part'],
});
def({
  id: 'rcd_2p', name: 'RCD 2-pole', cat: 'protection', letter: 'F', w: 16, h: 16, pins: polePins(2),
  prims: [...breakerPoles(2), ...link(2), ...handle(2), ...pinNums(2), R(-7, 1.5, 14, 3.4), T(0, 4.1, 'IΔ', 2.2, 'middle')],
  fields: ['rating', 'sensitivity', 'desc', 'part'], show: ['rating', 'sensitivity'],
});
def({
  id: 'rcd_4p', name: 'RCD 4-pole', cat: 'protection', letter: 'F', w: 32, h: 16, pins: polePins(4),
  prims: [...breakerPoles(4), ...link(4), ...handle(4), ...pinNums(4), R(-15, 1.5, 30, 3.4), T(0, 4.1, 'IΔ', 2.2, 'middle')],
  fields: ['rating', 'sensitivity', 'desc', 'part'], show: ['rating', 'sensitivity'],
});
def({
  id: 'mpcb_3p', name: 'Motor protection switch', cat: 'protection', letter: 'Q', w: 24, h: 16, pins: polePins(3),
  prims: [...breakerPoles(3), ...link(3), ...handle(3), ...pinNums(3), ...xs(3).map(x => R(x - 1.2, 4.4, 2.4, 2.2))],
  fields: ['rating', 'setting', 'desc', 'part'], show: ['rating', 'setting'],
});
def({
  id: 'fuse', name: 'Fuse', cat: 'protection', letter: 'F', w: 4, h: 16,
  pins: [{ id: '1', x: 0, y: -8 }, { id: '2', x: 0, y: 8 }], prims: [L(0, -8, 0, 8), R(-1.2, -4, 2.4, 8)],
  fields: ['rating', 'desc', 'part'],
});
def({
  id: 'disconnector_3p', name: 'Main switch 3-pole', cat: 'protection', letter: 'Q', w: 24, h: 16, pins: polePins(3),
  prims: [...xs(3).flatMap(x => [L(x, -8, x, -3.5), L(x - 1.2, -3.5, x + 1.2, -3.5), L(x, 3.5, x - 2.8, -3), L(x, 3.5, x, 8)]), ...link(3), ...handle(3), ...pinNums(3)],
  fields: ['rating', 'desc', 'part'],
});

// ------------------------------------------------------------------ switching
def({
  id: 'coil', name: 'Contactor / relay coil', cat: 'switching', letter: 'K', role: 'main', w: 6, h: 12,
  pins: [{ id: 'A1', x: 0, y: -6 }, { id: 'A2', x: 0, y: 6 }],
  prims: [R(-3, -2, 6, 4), L(0, -6, 0, -2), L(0, 2, 0, 6), T(0.8, -4.4, 'A1', 1.6), T(0.8, 5.6, 'A2', 1.6)],
  fields: ['voltage', 'desc', 'part'], show: ['voltage'],
});
def({
  id: 'main_contacts_3p', name: 'Main contacts 3-pole', cat: 'switching', letter: 'K', role: 'aux', w: 24, h: 16,
  pins: polePins(3), prims: [...contactPoles(3), ...link(3), ...pinNums(3)], show: [],
});
const contactNo = [L(0, -6, 0, -2.5), L(0, 2.5, 0, 6), L(0, 2.5, -2.4, -2.2)];
const contactNc = [L(0, -6, 0, -2.5), L(0, -2.5, 1.8, -2.5), L(0, 2.5, 0, 6), L(0, 2.5, 2.4, -3)];
def({
  id: 'contact_no', name: 'NO contact', cat: 'switching', letter: 'K', role: 'aux', w: 6, h: 12,
  pins: [{ id: '1', x: 0, y: -6 }, { id: '2', x: 0, y: 6 }], prims: contactNo, local: ['nums'], show: ['nums'],
});
def({
  id: 'contact_nc', name: 'NC contact', cat: 'switching', letter: 'K', role: 'aux', w: 6, h: 12,
  pins: [{ id: '1', x: 0, y: -6 }, { id: '2', x: 0, y: 6 }], prims: contactNc, local: ['nums'], show: ['nums'],
});
def({
  id: 'pb_no', name: 'Push-button NO', cat: 'switching', letter: 'S', w: 10, h: 12,
  pins: [{ id: '13', x: 0, y: -6 }, { id: '14', x: 0, y: 6 }],
  prims: [...contactNo, L(-1.2, 0, -5, 0, DASH), L(-5, -1.4, -5, 1.4), T(0.8, -4.2, '13', 1.6), T(0.8, 5.6, '14', 1.6)],
});
def({
  id: 'pb_nc', name: 'Push-button NC', cat: 'switching', letter: 'S', w: 10, h: 12,
  pins: [{ id: '11', x: 0, y: -6 }, { id: '12', x: 0, y: 6 }],
  prims: [...contactNc, L(1.1, -0.2, -5, -0.2, DASH), L(-5, -1.6, -5, 1.2), T(-1.2, -4.2, '11', 1.6, 'end'), T(-1.2, 5.6, '12', 1.6, 'end')],
});
def({
  id: 'estop', name: 'Emergency stop', cat: 'switching', letter: 'S', w: 10, h: 12,
  pins: [{ id: '11', x: 0, y: -6 }, { id: '12', x: 0, y: 6 }],
  prims: [...contactNc, L(1.1, -0.2, -5, -0.2, DASH), A(-5, -0.2, 1.8, 90, 270), L(-5, -2, -5, 1.6), T(-1.2, -4.2, '11', 1.6, 'end'), T(-1.2, 5.6, '12', 1.6, 'end')],
});
def({
  id: 'overload_nc', name: 'Overload contact (95-96)', cat: 'switching', letter: 'F', role: 'aux', w: 10, h: 12,
  pins: [{ id: '95', x: 0, y: -6 }, { id: '96', x: 0, y: 6 }],
  prims: [...contactNc, L(1.1, -0.2, -2, -0.2, DASH), P([[-2, -0.2], [-3, -1.4], [-4, 1], [-5, -0.2]]), T(0.8, -4.2, '95', 1.6), T(0.8, 5.6, '96', 1.6)],
  show: [],
});
def({
  id: 'lamp', name: 'Indicator lamp', cat: 'switching', letter: 'H', w: 6, h: 12,
  pins: [{ id: 'X1', x: 0, y: -6 }, { id: 'X2', x: 0, y: 6 }],
  prims: [C(0, 0, 2.5), L(-1.77, -1.77, 1.77, 1.77), L(-1.77, 1.77, 1.77, -1.77), L(0, -6, 0, -2.5), L(0, 2.5, 0, 6)],
  fields: ['color', 'voltage', 'desc', 'part'], show: ['color'],
});

// ------------------------------------------------------------------ power
def({
  id: 'motor3', name: 'Motor 3~', cat: 'power', letter: 'M', w: 18, h: 16,
  pins: [{ id: 'U', x: -4, y: -8 }, { id: 'V', x: 0, y: -8 }, { id: 'W', x: 4, y: -8 }, { id: 'PE', x: 8, y: -8 }],
  prims: [C(0, 3, 5), T(0, 2.6, 'M', 2.6, 'middle'), T(0, 6, '3~', 2, 'middle'), L(-4, -8, -4, -0.2), L(0, -8, 0, -2), L(4, -8, 4, -0.2), L(8, -8, 8, 3), L(8, 3, 5, 3, DASH),
    T(-4.6, -6.4, 'U', 1.6, 'end'), T(0.6, -6.4, 'V', 1.6), T(4.6, -6.4, 'W', 1.6), T(8.6, -6.4, 'PE', 1.6)],
  fields: ['power', 'voltage', 'desc', 'part'], show: ['power'],
});
def({
  id: 'psu', name: 'Power supply AC/DC', cat: 'power', letter: 'G', w: 20, h: 20,
  pins: [{ id: 'L', x: -4, y: -10 }, { id: 'N', x: 0, y: -10 }, { id: 'PE', x: 4, y: -10 }, { id: '+', x: -4, y: 10 }, { id: '-', x: 4, y: 10 }],
  prims: [R(-8, -6, 16, 12), L(-8, 6, 8, -6), T(-4.5, -1.8, '~', 3, 'middle'), T(4.5, 4.2, '=', 3, 'middle'),
    L(-4, -10, -4, -6), L(0, -10, 0, -6), L(4, -10, 4, -6), L(-4, 6, -4, 10), L(4, 6, 4, 10),
    T(-4.6, -7.2, 'L', 1.6, 'end'), T(0.6, -7.2, 'N', 1.6), T(4.6, -7.2, 'PE', 1.6), T(-4.6, 8.8, '+', 1.8, 'end'), T(4.6, 8.8, '−', 1.8)],
  fields: ['rating', 'output', 'desc', 'part'], show: ['rating', 'output'],
});
def({
  id: 'socket', name: 'Socket outlet', cat: 'power', letter: 'X', w: 12, h: 12,
  pins: [{ id: 'L', x: -4, y: -6 }, { id: 'N', x: 0, y: -6 }, { id: 'PE', x: 4, y: -6 }],
  prims: [L(-4, -6, -4, 0), L(0, -6, 0, 0), L(4, -6, 4, 0), A(0, 0, 5, 0, 180), L(-5, 0, 5, 0), T(-4.6, -4.4, 'L', 1.6, 'end'), T(0.6, -4.4, 'N', 1.6), T(4.6, -4.4, 'PE', 1.6)],
  fields: ['rating', 'desc', 'part'],
});
def({
  id: 'transformer', name: 'Transformer 1~', cat: 'power', letter: 'T', w: 12, h: 24,
  pins: [{ id: '1', x: -2, y: -12 }, { id: '2', x: 2, y: -12 }, { id: '3', x: -2, y: 12 }, { id: '4', x: 2, y: 12 }],
  prims: [C(0, -2.6, 4), C(0, 2.6, 4), L(-2, -12, -2, -6.1), L(2, -12, 2, -6.1), L(-2, 12, -2, 6.1), L(2, 12, 2, 6.1)],
  fields: ['rating', 'primary', 'secondary', 'desc', 'part'], show: ['rating'],
});

// ------------------------------------------------------------------ terminals
def({
  id: 'terminal', name: 'Terminal', cat: 'terminals', letter: 'X', w: 4, h: 8, terminal: true,
  pins: [{ id: '1', x: 0, y: -4, side: 'in' }, { id: '2', x: 0, y: 4, side: 'out' }],
  prims: [C(0, 0, 0.9), L(0, -4, 0, -0.9), L(0, 0.9, 0, 4)],
  fields: ['desc', 'part'], local: ['term', 'bridge'], show: ['term'],
});
def({
  id: 'terminal_pe', name: 'PE terminal', cat: 'terminals', letter: 'X', w: 4, h: 8, terminal: true,
  pins: [{ id: '1', x: 0, y: -4, side: 'in' }, { id: '2', x: 0, y: 4, side: 'out' }],
  prims: [C(0, 0, 0.9), L(0, -4, 0, -0.9), L(0, 0.9, 0, 4), L(1.2, 0, 2.4, 0), L(2.4, -1.2, 2.4, 1.2), L(3, -0.75, 3, 0.75), L(3.6, -0.3, 3.6, 0.3)],
  fields: ['desc', 'part'], local: ['term', 'bridge'], show: ['term'],
});
def({
  id: 'plug', name: 'Plug / socket contact', cat: 'terminals', letter: 'X', w: 4, h: 8,
  pins: [{ id: '1', x: 0, y: -4 }, { id: '2', x: 0, y: 4 }],
  prims: [L(0, -4, 0, -0.4), A(0, 1.4, 1.8, 180, 360), L(0, 1.4, 0, 4)],
  fields: ['desc', 'part'], local: ['term'], show: ['term'],
});
def({
  id: 'cable_mark', name: 'Cable marker', cat: 'terminals', letter: 'W', w: 28, h: 4, pins: [],
  prims: [L(-14, 0, 14, 0)], fields: [], show: [], cable: true,
});

// ------------------------------------------------------------------ PLC
def({
  id: 'plc_in', name: 'PLC input', cat: 'plc', letter: 'A', w: 12, h: 12,
  pins: [{ id: '1', x: 0, y: -6 }], prims: [L(0, -6, 0, -2.5), R(-5, -2.5, 10, 5), T(0, 1, 'I', 2, 'middle')],
  local: ['addr'], show: ['addr'],
});
def({
  id: 'plc_out', name: 'PLC output', cat: 'plc', letter: 'A', w: 12, h: 12,
  pins: [{ id: '1', x: 0, y: 6 }], prims: [L(0, 2.5, 0, 6), R(-5, -2.5, 10, 5), T(0, 1, 'Q', 2, 'middle')],
  local: ['addr'], show: ['addr'],
});

// ------------------------------------------------------------------ general
def({ id: 'node', name: 'Connection point', cat: 'general', noTag: true, w: 2, h: 2, pins: [{ id: '1', x: 0, y: 0, node: true }], prims: [], fields: [], show: [] });
def({
  id: 'xref', name: 'Interruption point', cat: 'general', noTag: true, w: 4, h: 6, xref: true,
  pins: [{ id: '1', x: 0, y: -4 }], prims: [L(0, -4, 0, -1.4), P([[-1, -1.6], [1, -1.6], [0, 0.6]], true, { fill: true })],
  fields: [], local: ['name'], show: [],
});
def({
  id: 'ground', name: 'Protective earth', cat: 'general', noTag: true, w: 6, h: 6,
  pins: [{ id: '1', x: 0, y: -4 }], prims: [L(0, -4, 0, 0), L(-2, 0, 2, 0), L(-1.3, 0.8, 1.3, 0.8), L(-0.6, 1.6, 0.6, 1.6)],
  fields: [], show: [],
});
def({ id: 'box', name: 'Black box / device', cat: 'general', letter: 'A', w: 24, h: 16, box: true, pins: [], prims: [],
  fields: ['desc', 'part'], local: ['pinsTop', 'pinsBottom', 'pinsLeft', 'pinsRight', 'pitch', 'w', 'h'], show: [] });

export const BY_ID = Object.fromEntries(SYMBOLS.map(s => [s.id, s]));

// ------------------------------------------------------------------ custom symbols
// User symbols are JSON: the same fields as above, with prims as plain arrays
// (['l', x1, y1, x2, y2, {dash}], ['r', x, y, w, h], ['c', cx, cy, r, {fill}], ['a', cx, cy, r, a0, a1],
//  ['p', [[x, y]...], closed], ['t', x, y, text, size, anchor]). They live in library/symbols/*.json
// and a copy travels inside every project that uses them.

const ROLES = new Set(['main', 'aux']);
const PRIM_ARGS = { l: 4, r: 4, c: 3, a: 5, p: 2, t: 3 };
const list = v => (Array.isArray(v) ? v : String(v ?? '').split(',')).map(x => String(x).trim()).filter(Boolean);
const num = v => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`); return Math.round(n * 1000) / 1000; };

/** Validate and normalise a user symbol definition. Throws with a readable message. */
export function normalizeSymbol(d) {
  if (!d || typeof d !== 'object') throw new Error('symbol must be an object');
  const id = String(d.id ?? '').trim();
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(id)) throw new Error('symbol id: 2-41 characters, lowercase letters, digits and _ (starting with a letter)');
  if (BY_ID[id] && !BY_ID[id].custom) throw new Error(`"${id}" is a built-in symbol id; choose another`);
  const prims = (d.prims || []).map((p, i) => {
    const k = p?.[0];
    if (!PRIM_ARGS[k]) throw new Error(`prims[${i}]: unknown kind "${k}" (use l, r, c, a, p, t)`);
    const o = p[PRIM_ARGS[k] + 1];
    if (k === 'p') return ['p', (p[1] || []).map(([x, y]) => [num(x), num(y)]), !!p[2], p[3] && typeof p[3] === 'object' ? p[3] : undefined];
    if (k === 't') return ['t', num(p[1]), num(p[2]), String(p[3] ?? ''), num(p[4] ?? 2), ['start', 'middle', 'end'].includes(p[5]) ? p[5] : 'start', p[6] && typeof p[6] === 'object' ? p[6] : undefined];
    const n = PRIM_ARGS[k];
    return [k, ...p.slice(1, n + 1).map(num), o && typeof o === 'object' ? o : undefined];
  });
  if (!prims.length) throw new Error('a symbol needs at least one drawing element');
  const pins = (d.pins || []).map(p => ({ id: String(p.id ?? '').trim(), x: num(p.x), y: num(p.y) }));
  const seen = new Set();
  for (const p of pins) {
    if (!p.id) throw new Error('every pin needs a name');
    if (seen.has(p.id)) throw new Error(`pin name "${p.id}" is used twice`);
    seen.add(p.id);
  }
  // size from the drawing and pins, rounded up to the 4 mm grid
  let w = 0, h = 0;
  for (const p of pins) { w = Math.max(w, Math.abs(p.x) * 2); h = Math.max(h, Math.abs(p.y) * 2); }
  for (const p of prims) {
    const pts = p[0] === 'l' ? [[p[1], p[2]], [p[3], p[4]]] : p[0] === 'r' ? [[p[1], p[2]], [p[1] + p[3], p[2] + p[4]]]
      : p[0] === 'c' || p[0] === 'a' ? [[p[1] - p[3], p[2] - p[3]], [p[1] + p[3], p[2] + p[3]]] : p[0] === 'p' ? p[1] : [[p[1], p[2]]];
    for (const [x, y] of pts) { w = Math.max(w, Math.abs(x) * 2); h = Math.max(h, Math.abs(y) * 2); }
  }
  const fields = list(d.fields ?? 'desc,part'), local = list(d.local), show = list(d.show);
  return {
    id, name: String(d.name || id).slice(0, 60), names: d.names && typeof d.names === 'object' ? d.names : undefined,
    cat: String(d.cat || 'custom').trim() || 'custom', letter: d.noTag ? undefined : (String(d.letter || 'A').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'A'),
    noTag: !!d.noTag || undefined, role: ROLES.has(d.role) ? d.role : undefined,
    w: Math.max(4, Math.ceil(w / 4) * 4), h: Math.max(4, Math.ceil(h / 4) * 4), pins, prims, fields, local, show, custom: true,
  };
}

/** Add or replace user symbols. Built-in symbols are never replaced. */
export function registerSymbols(defs, { override = true } = {}) {
  const ok = [], errors = [];
  for (const d of defs || []) {
    try {
      const s = normalizeSymbol(d);
      if (BY_ID[s.id] && !override) continue;
      const i = SYMBOLS.findIndex(x => x.id === s.id);
      if (i >= 0) SYMBOLS[i] = s; else SYMBOLS.push(s);
      BY_ID[s.id] = s;
      ok.push(s.id);
    } catch (e) { errors.push(`${d?.id || '?'}: ${e.message}`); }
  }
  return { ok, errors };
}

export function unregisterSymbol(id) {
  if (!BY_ID[id]?.custom) return false;
  SYMBOLS.splice(SYMBOLS.findIndex(s => s.id === id), 1);
  delete BY_ID[id];
  return true;
}

/** Plain JSON definition of a symbol (for saving, embedding in projects, or copying a built-in). */
export function symbolDef(s) {
  const strip = o => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) : undefined);
  const prims = s.prims.map(p => { const q = [...p]; const last = q.at(-1); if (last === undefined) q.pop(); else if (typeof last === 'object' && !Array.isArray(last)) q[q.length - 1] = strip(last); return q; });
  return Object.fromEntries(Object.entries({
    id: s.id, name: s.name, names: s.names, cat: s.cat, letter: s.letter, noTag: s.noTag, role: s.role,
    pins: s.pins.map(({ id, x, y }) => ({ id, x, y })), prims, fields: s.fields, local: s.local, show: s.show,
  }).filter(([, v]) => v !== undefined));
}

/** Pins and primitives of a placed symbol (black boxes are built from their properties). */
export function shapeOf(sym, comp) {
  if (!sym?.box) return { pins: sym?.pins || [], prims: sym?.prims || [] };
  const pr = comp?.props || {};
  const w = Math.max(8, Math.round((+pr.w || 24) / 4) * 4), h = Math.max(8, Math.round((+pr.h || 16) / 4) * 4);
  // pin lists are comma separated; "_" leaves a gap; a pin named "X10/4" is labelled "4" (group shown by the drawing)
  const list = s => String(s ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const pitch = Math.min(40, Math.max(4, Math.round((+pr.pitch || 8) / 2) * 2));
  const top = list(pr.pinsTop), bot = list(pr.pinsBottom), left = list(pr.pinsLeft), right = list(pr.pinsRight);
  const label = id => id.slice(id.lastIndexOf('/') + 1);
  const pins = [], prims = [R(-w / 2, -h / 2, w, h, DASH)];
  const at = (i, n) => Math.round(((i - (n - 1) / 2) * pitch) / 2) * 2;
  const row = (names, y, dy) => names.forEach((id, i) => {
    if (id === '_') return;
    const x = at(i, names.length);
    pins.push({ id, x, y: y + dy * 4 });
    prims.push(L(x, y, x, y + dy * 4), C(x, y, 0.7), T(x, y - dy * 2.2 + (dy < 0 ? 0 : 1.4), label(id), 1.6, 'middle'));
  });
  const col = (names, x, dx) => names.forEach((id, i) => {
    if (id === '_') return;
    const y = at(i, names.length);
    pins.push({ id, x: x + dx * 4, y });
    prims.push(L(x, y, x + dx * 4, y), C(x, y, 0.7), T(x - dx * 1.4, y + 0.6, label(id), 1.6, dx < 0 ? 'start' : 'end'));
  });
  row(top, -h / 2, -1);
  row(bot, h / 2, 1);
  col(left, -w / 2, -1);
  col(right, w / 2, 1);
  if (comp?.device?.desc) prims.push(T(-w / 2 + 1.2, (top.length ? -h / 2 + 6 : -h / 2 + 3.4), comp.device.desc, 2, 'start'));
  return { pins, prims, w: w + (left.length || right.length ? 8 : 0), h: h + (top.length || bot.length ? 8 : 0) };
}
