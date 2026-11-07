// Page → layered primitives → SVG. The DXF writer consumes the same layers.

import { BY_ID } from './symbols.js';
import { place, svgOf, esc, L, P, R, T, FONT, normRot } from './geom.js';
import { frameGeom, framePrims, coverPrims } from './frames.js';
import { reportPrims } from './reports.js';
import { crossRefs } from './xref.js';
import { dims, pinWorld, shape, snap, paperOf, pageNets } from './model.js';

export const STYLE = `
.wd{fill:none;stroke:currentColor;stroke-width:.25;stroke-linecap:round;stroke-linejoin:round}
.wd text{fill:currentColor;stroke:none;font-family:${FONT}}
.wd .tbl{fill:#666}
.wd .lbl{fill:currentColor}
.wd .xr{fill:#555}
.wd .wl{fill:#333}
.wd .hit{stroke:transparent;fill:transparent}
.wd .whit{stroke:transparent;stroke-width:2.4;fill:none}
.wd .pin{fill:transparent;stroke:none}
`;

// ------------------------------------------------------------------ wires
function exitDir(p, t) {
  if (p.dir) return p.dir;
  const dx = t.x - p.x, dy = t.y - p.y;
  return Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
}

function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const last = out.at(-1);
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
    if (out.length >= 2) {
      const a = out.at(-2);
      if ((Math.abs(a[0] - last[0]) < 1e-6 && Math.abs(last[0] - p[0]) < 1e-6) || (Math.abs(a[1] - last[1]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6)) out.pop();
    }
    out.push(p);
  }
  return out;
}

export function route(a, b) {
  const da = exitDir(a, b), db = exitDir(b, a), S = 2;
  const a1 = [a.x + da[0] * S, a.y + da[1] * S], b1 = [b.x + db[0] * S, b.y + db[1] * S];
  if (a.x === b.x && da[0] === 0 && db[0] === 0) return [[a.x, a.y], [b.x, b.y]];
  if (a.y === b.y && da[1] === 0 && db[1] === 0) return [[a.x, a.y], [b.x, b.y]];
  let mid;
  if (da[0]) mid = db[0] ? [[snap((a1[0] + b1[0]) / 2, 2), a1[1]], [snap((a1[0] + b1[0]) / 2, 2), b1[1]]] : [[b1[0], a1[1]]];
  else mid = db[1] ? [[a1[0], snap((a1[1] + b1[1]) / 2, 2)], [b1[0], snap((a1[1] + b1[1]) / 2, 2)]] : [[a1[0], b1[1]]];
  return simplify([[a.x, a.y], a1, ...mid, b1, [b.x, b.y]]);
}

export function wirePoints(proj, page, w) {
  const sa = page.items.syms.find(s => s.id === w.a.s), sb = page.items.syms.find(s => s.id === w.b.s);
  const a = sa && pinWorld(proj, sa, w.a.p), b = sb && pinWorld(proj, sb, w.b.p);
  if (!a || !b) return null;
  if (w.pts?.length) {
    // manual bends: keep every leg horizontal or vertical by inserting an elbow where needed
    const raw = [[a.x, a.y], ...w.pts, [b.x, b.y]], pts = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      const p = pts.at(-1), q = raw[i];
      if (p[0] !== q[0] && p[1] !== q[1]) pts.push(i === raw.length - 1 && b.dir?.[1] ? [q[0], p[1]] : i === raw.length - 1 ? [p[0], q[1]] : [q[0], p[1]]);
      pts.push(q);
    }
    return simplify(pts);
  }
  return route(a, b);
}

function longestSeg(pts) {
  let best = null, len = -1;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], l = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    if (l > len) { len = l; best = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, v: x1 === x2 }; }
  }
  return best;
}

// ------------------------------------------------------------------ labels
function symbolLabels(proj, page, s, sym, xr) {
  const out = [], { w, h } = dims(proj, s), dev = proj.devices[s.tag] || {};
  const val = f => (sym.local.includes(f) ? s.props?.[f] : dev[f]) ?? s.props?.[f] ?? '';
  const lines = [];
  if (sym.xref) {
    const name = s.props?.name || '';
    const rot = normRot(s.rot);
    if (rot === 90 || rot === 270) {
      const [tx, ty, an] = rot === 90 ? [s.x - 2, s.y - 1.4, 'end'] : [s.x + 2, s.y + 0.8, 'start'];
      out.push(T(tx, ty, name, 2.5, an, { cls: 'lbl' }));
      (xr || []).forEach((l, i) => out.push(T(tx, ty + 2.6 + i * 2.2, l, 1.8, an, { cls: 'xr' })));
    } else {
      // vertical arrows: name runs upwards along the wire, as in EPLAN, so neighbours 8 mm apart never collide
      const down = rot === 0, y0 = down ? s.y + 1.6 : s.y - 1.6, an = down ? 'end' : 'start';
      out.push(T(s.x + 0.9, y0, name, 2.5, an, { cls: 'lbl', rot: -90 }));
      (xr || []).forEach((l, i) => out.push(T(s.x + 3.2 + i * 2.2, y0, l, 1.8, an, { cls: 'xr', rot: -90 })));
    }
    return out;
  }
  if (sym.cable) {
    const c = proj.cables[s.tag] || {};
    out.push(T(s.x - w / 2, s.y - 1, s.tag || '', 2.5, 'start', { cls: 'lbl' }));
    if (c.type) out.push(T(s.x - w / 2, s.y + 2.8, c.type, 1.8, 'start', { cls: 'xr' }));
    return out;
  }
  if (sym.terminal || sym.id === 'plug') {
    // the strip tag is printed once per row: skip it when a terminal of the same strip sits just to the left
    const neighbour = page.items.syms.some(o => o !== s && o.tag === s.tag && BY_ID[o.sym]?.terminal === sym.terminal && o.y === s.y && s.x - o.x > 0 && s.x - o.x <= 16);
    if (s.tag && s.props?.showTag !== '0' && !neighbour) out.push(T(s.x - 1.6, s.y + 0.9, s.tag, 2.2, 'end', { cls: 'lbl' }));
    if (s.props?.term) out.push(T(s.x + (sym.id === 'terminal_pe' ? 4.4 : 1.6), s.y + 0.9, s.props.term, 2.2, 'start', { cls: 'lbl' }));
    return out;
  }
  if (s.tag && !sym.noTag) lines.push([s.tag, 2.5, 'lbl']);
  for (const f of sym.show) { const v = val(f); if (v) lines.push([v, 1.9, 'xr']); }
  const below = sym.role === 'main' ? [] : (xr || []);
  for (const l of below) lines.push([l, 1.8, 'xr']);
  const vertical = h >= w || sym.box;
  const x = vertical ? s.x - w / 2 - 1.2 : s.x - w / 2;
  let y = vertical ? s.y - ((lines.length - 1) * 2.6) / 2 + 0.8 : s.y - h / 2 - 1.2 - (lines.length - 1) * 2.6;
  if (sym.box) y = s.y - h / 2 + 2;
  for (const [t, size, cls] of lines) { out.push(T(x, y, t, size, vertical ? 'end' : 'start', { cls })); y += 2.6; }
  // contact image of a coil: listed to the right, clear of the wire running through the coil
  if (sym.role === 'main' && xr?.length) xr.forEach((l, i) => out.push(T(s.x + w / 2 + 1.5, s.y + h / 2 + 1.5 + i * 2.2, l, 1.6, 'start', { cls: 'xr' })));
  return out;
}

const lineStyle = st => st === 'dash' ? { dash: '2 1' } : st === 'dashdot' ? { dash: '4 1 0.6 1' } : undefined;

/**
 * Layers: frame, symbol, label, wire, wirelabel, text, graphics, report.
 * Returns { paper, W, H, layers: [{ layer, kind?, id?, prims }] }.
 */
export function pageLayers(proj, page, ctx = {}) {
  const paper = paperOf(proj, page), g = frameGeom(paper), layers = [];
  const xrefs = ctx.xrefs || crossRefs(proj);
  layers.push({ layer: 'FRAME', prims: framePrims(proj, page, paper, ctx) });
  if (page.kind === 'cover') layers.push({ layer: 'TEXT', prims: coverPrims(proj, page, paper, ctx) });
  if (page.kind === 'report') layers.push({ layer: 'REPORT', prims: reportPrims(proj, page, paper, ctx) });

  for (const r of page.items.rects) layers.push({ layer: 'GRAPHICS', kind: 'rect', id: r.id, prims: [R(r.x, r.y, r.w, r.h, lineStyle(r.style))] });
  for (const l of page.items.lines) layers.push({ layer: 'GRAPHICS', kind: 'line', id: l.id, prims: [L(l.x1, l.y1, l.x2, l.y2, lineStyle(l.style))] });

  const pinCount = new Map(), { find } = pageNets(page), shown = new Set();
  for (const w of page.items.wires) {
    for (const e of [w.a, w.b]) { const k = `${e.s}.${e.p}`; pinCount.set(k, (pinCount.get(k) || 0) + 1); }
    const pts = wirePoints(proj, page, w);
    if (!pts) continue;
    const prims = [P(pts, false, { w: 0.3 })], labels = [];
    const m = longestSeg(pts), pr = w.props || {};
    // a net shows its wire number and size/colour once; cable cores are labelled on every wire
    const net = find(`${w.a.s}.${w.a.p}`);
    const once = v => { if (!v) return ''; const k = `${net}|${v}`; if (shown.has(k)) return ''; shown.add(k); return v; };
    const main = once(pr.wire || '');
    const sub = [pr.cable && pr.core ? `${pr.cable}:${pr.core}` : '', once([pr.size, pr.color].filter(Boolean).join(' '))].filter(Boolean).join(' ');
    if (m && (main || sub)) {
      if (m.v) { if (main) labels.push(T(m.x + 0.8, m.y, main, 1.8, 'start', { cls: 'wl' })); if (sub) labels.push(T(m.x + 0.8, m.y + 2.2, sub, 1.5, 'start', { cls: 'xr' })); }
      else { if (main) labels.push(T(m.x, m.y - 0.8, main, 1.8, 'middle', { cls: 'wl' })); if (sub) labels.push(T(m.x, m.y + 2.2, sub, 1.5, 'middle', { cls: 'xr' })); }
    }
    layers.push({ layer: 'WIRE', kind: 'wire', id: w.id, prims, labels, pts });
  }

  for (const s of page.items.syms) {
    const { sym, prims } = shape(proj, s);
    if (!sym) { layers.push({ layer: 'SYMBOL', kind: 'sym', id: s.id, prims: [R(s.x - 4, s.y - 4, 8, 8, { dash: true }), T(s.x, s.y + 1, '?', 2.5, 'middle')] }); continue; }
    const world = place(prims, s.x, s.y, s.rot);
    const pins = shape(proj, s).pins;
    const dots = [];
    for (const p of pins) {
      const n = pinCount.get(`${s.id}.${p.id}`) || 0;
      if (n >= (p.node ? 3 : 2)) { const w = pinWorld(proj, s, p.id); dots.push(['c', w.x, w.y, 0.55, { fill: true }]); }
    }
    layers.push({ layer: 'SYMBOL', kind: 'sym', id: s.id, prims: [...world, ...dots], labels: symbolLabels(proj, page, s, sym, xrefs.get(`${page.id}/${s.id}`)) });
  }
  for (const t of page.items.texts)
    layers.push({ layer: 'TEXT', kind: 'text', id: t.id, prims: [T(t.x, t.y, t.text, +t.size || 2.5, t.anchor || 'start', t.bold ? { bold: true } : undefined)] });

  return { paper, W: g.W, H: g.H, layers };
}

/** Inner SVG for a page. opts.interactive adds hit targets and pins; opts.sel is a Set of item ids. */
export function pageSVG(proj, page, opts = {}) {
  const { W, H, layers, paper } = pageLayers(proj, page, opts);
  const sel = opts.sel || new Set();
  let s = '';
  for (const ly of layers) {
    const body = svgOf(ly.prims) + (ly.labels ? svgOf(ly.labels) : '');
    if (!opts.interactive || !ly.kind) { s += `<g data-layer="${ly.layer}">${body}</g>`; continue; }
    const on = sel.has(ly.id) ? ' sel' : '';
    if (ly.kind === 'wire') {
      const pts = ly.pts.map(p => p.join(',')).join(' ');
      s += `<g class="it wire${on}" data-id="${esc(ly.id)}"><polyline class="whit" points="${pts}"/>${body}</g>`;
    } else if (ly.kind === 'sym') {
      const sy = page.items.syms.find(x => x.id === ly.id);
      const { w, h } = dims(proj, sy);
      let pins = '';
      for (const p of shape(proj, sy).pins) {
        const pw = pinWorld(proj, sy, p.id);
        pins += `<circle class="pin" data-s="${esc(sy.id)}" data-p="${esc(p.id)}" cx="${pw.x}" cy="${pw.y}" r="1.2"><title>${esc((sy.tag || '') + ':' + p.id)}</title></circle>`;
      }
      s += `<g class="it sym${on}" data-id="${esc(ly.id)}"><rect class="hit" x="${sy.x - w / 2 - 1}" y="${sy.y - h / 2 - 1}" width="${w + 2}" height="${h + 2}"/>${body}${pins}</g>`;
    } else {
      s += `<g class="it ${ly.kind}${on}" data-id="${esc(ly.id)}">${body}${ly.kind === 'line' ? `<polyline class="whit" points="${ly.prims[0][1]},${ly.prims[0][2]} ${ly.prims[0][3]},${ly.prims[0][4]}"/>` : ''}</g>`;
    }
  }
  return { W, H, paper, svg: s };
}

export function standaloneSVG(proj, page, opts = {}) {
  const { W, H, svg } = pageSVG(proj, page, { ...opts, interactive: false });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" class="wd" style="color:#000;background:#fff"><style>${STYLE}</style><rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="none"/>${svg}</svg>`;
}
