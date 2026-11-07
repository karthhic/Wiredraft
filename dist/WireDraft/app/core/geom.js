// Drawing primitives in millimetres (y down). The same primitives feed the
// SVG renderer (editor, PDF) and the DXF writer, so every output matches.
//
//   ['l', x1, y1, x2, y2, o]          line
//   ['p', [[x,y]...], closed, o]      polyline
//   ['c', cx, cy, r, o]               circle
//   ['a', cx, cy, r, a0, a1, o]       arc, degrees, clockwise on screen (y down)
//   ['r', x, y, w, h, o]              rectangle
//   ['t', x, y, text, size, anchor, o] text, y = baseline, anchor start|middle|end
//   ['img', x, y, w, h, href]         image (logos), SVG/PDF only
// o: { dash, fill, w (line width mm), bold, cls, rot (text rotation, degrees clockwise) }

export const L = (x1, y1, x2, y2, o) => ['l', x1, y1, x2, y2, o];
export const P = (pts, closed = false, o) => ['p', pts, closed, o];
export const C = (cx, cy, r, o) => ['c', cx, cy, r, o];
export const A = (cx, cy, r, a0, a1, o) => ['a', cx, cy, r, a0, a1, o];
export const R = (x, y, w, h, o) => ['r', x, y, w, h, o];
export const T = (x, y, s, size = 2.5, anchor = 'start', o) => ['t', x, y, String(s ?? ''), size, anchor, o];

export const normRot = r => ((Math.round((+r || 0) / 90) * 90) % 360 + 360) % 360;

export function rotPt(x, y, rot) {
  switch (normRot(rot)) {
    case 90: return [-y, x];
    case 180: return [-x, -y];
    case 270: return [y, -x];
    default: return [x, y];
  }
}

/** Transform local primitives to world: rotate (text stays upright) then translate. */
export function place(prims, dx, dy, rot = 0) {
  rot = normRot(rot);
  const tp = (x, y) => { const [a, b] = rotPt(x, y, rot); return [a + dx, b + dy]; };
  return prims.map(p => {
    switch (p[0]) {
      case 'l': { const [x1, y1] = tp(p[1], p[2]), [x2, y2] = tp(p[3], p[4]); return ['l', x1, y1, x2, y2, p[5]]; }
      case 'p': return ['p', p[1].map(([x, y]) => tp(x, y)), p[2], p[3]];
      case 'c': { const [x, y] = tp(p[1], p[2]); return ['c', x, y, p[3], p[4]]; }
      case 'a': { const [x, y] = tp(p[1], p[2]); return ['a', x, y, p[3], p[4] + rot, p[5] + rot, p[6]]; }
      case 'r': {
        if (!rot) return ['r', p[1] + dx, p[2] + dy, p[3], p[4], p[5]];
        const pts = [[p[1], p[2]], [p[1] + p[3], p[2]], [p[1] + p[3], p[2] + p[4]], [p[1], p[2] + p[4]]].map(([x, y]) => tp(x, y));
        return ['p', pts, true, p[5]];
      }
      case 't': {
        const [x, y] = tp(p[1], p[2]);
        // keep text upright; for rotated symbols nudge anchors so labels stay readable
        return ['t', x, y, p[3], p[4], p[5], p[6]];
      }
      case 'img': return ['img', p[1] + dx, p[2] + dy, p[3], p[4], p[5]];
      default: return p;
    }
  });
}

export const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const n = v => Math.round(v * 1000) / 1000;

export const FONT = 'Arial, "Segoe UI", Helvetica, sans-serif';

function stroke(o, def) {
  let s = '';
  if (o?.w) s += ` stroke-width="${o.w}"`;
  if (o?.dash) s += ` stroke-dasharray="${o.dash === true ? '1.6 0.8' : o.dash}"`;
  if (o?.color) s += ` stroke="${o.color}"`;
  if (o?.cls) s += ` class="${o.cls}"`;
  return s;
}

/** Primitives → SVG markup (stroke/fill inherit currentColor from the parent). */
export const linkId = (page, sym) => `wd-${page}${sym ? `-${sym}` : ''}`;
const textParts = (parts, linkable) => parts.map(({ t, page, sym }) => (page && linkable?.(page)
  ? `<a href="#${esc(linkId(page, sym))}" data-page="${esc(page)}"${sym ? ` data-sym="${esc(sym)}"` : ''}><tspan>${esc(t)}</tspan></a>`
  : esc(t))).join('');

/** opts.linkable(pageId) says which link targets exist; other link parts print as plain text. */
export function svgOf(prims, opts = {}) {
  let s = '';
  for (const p of prims) {
    switch (p[0]) {
      case 'l': s += `<line x1="${n(p[1])}" y1="${n(p[2])}" x2="${n(p[3])}" y2="${n(p[4])}"${stroke(p[5])}/>`; break;
      case 'p': {
        const tag = p[2] ? 'polygon' : 'polyline';
        s += `<${tag} points="${p[1].map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}"${p[3]?.fill ? ' fill="currentColor"' : ' fill="none"'}${stroke(p[3])}/>`;
        break;
      }
      case 'c': s += `<circle cx="${n(p[1])}" cy="${n(p[2])}" r="${n(p[3])}"${p[4]?.fill ? ' fill="currentColor"' : ' fill="none"'}${stroke(p[4])}/>`; break;
      case 'a': {
        const [cx, cy, r, a0, a1] = p.slice(1, 6);
        const rad = d => d * Math.PI / 180;
        const x0 = cx + r * Math.cos(rad(a0)), y0 = cy + r * Math.sin(rad(a0));
        const x1 = cx + r * Math.cos(rad(a1)), y1 = cy + r * Math.sin(rad(a1));
        const sweep = ((a1 - a0) % 360 + 360) % 360;
        s += `<path d="M${n(x0)} ${n(y0)}A${n(r)} ${n(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${n(x1)} ${n(y1)}" fill="none"${stroke(p[6])}/>`;
        break;
      }
      case 'r': s += `<rect x="${n(p[1])}" y="${n(p[2])}" width="${n(p[3])}" height="${n(p[4])}"${p[5]?.fill ? ` fill="${p[5].fill === true ? 'currentColor' : p[5].fill}"` : ' fill="none"'}${stroke(p[5])}/>`; break;
      case 't': {
        if (p[3] === '') break;
        const o = p[6] || {};
        s += `<text x="${n(p[1])}" y="${n(p[2])}" font-size="${p[4]}"${p[5] !== 'start' ? ` text-anchor="${p[5]}"` : ''}${o.bold ? ' font-weight="bold"' : ''}${o.cls ? ` class="${o.cls}"` : ''}${o.rot ? ` transform="rotate(${o.rot} ${n(p[1])} ${n(p[2])})"` : ''}>${o.parts ? textParts(o.parts, opts.linkable) : esc(p[3])}</text>`;
        break;
      }
      case 'img': if (p[5]) s += `<image x="${n(p[1])}" y="${n(p[2])}" width="${n(p[3])}" height="${n(p[4])}" href="${esc(p[5])}" preserveAspectRatio="xMidYMid meet"/>`; break;
    }
  }
  return s;
}

/** Bounding box of primitives (text approximated). */
export function bbox(prims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const g = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of prims) {
    switch (p[0]) {
      case 'l': g(p[1], p[2]); g(p[3], p[4]); break;
      case 'p': p[1].forEach(([x, y]) => g(x, y)); break;
      case 'c': case 'a': g(p[1] - p[3], p[2] - p[3]); g(p[1] + p[3], p[2] + p[3]); break;
      case 'r': case 'img': g(p[1], p[2]); g(p[1] + p[3], p[2] + p[4]); break;
      case 't': { const w = p[3].length * p[4] * 0.6; const x = p[5] === 'end' ? p[1] - w : p[5] === 'middle' ? p[1] - w / 2 : p[1]; g(x, p[2] - p[4]); g(x + w, p[2] + p[4] * 0.25); break; }
    }
  }
  return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}
