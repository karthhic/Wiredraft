// DXF (AutoCAD R12 ASCII) writer: one drawing per page, one layer per object kind.
// R12 is the most widely readable DXF dialect (AutoCAD, BricsCAD, DraftSight, LibreCAD, QCAD).

import { pageLayers } from '../core/render.js';
import { crossRefs } from '../core/xref.js';

const LAYERS = { FRAME: 8, SYMBOL: 7, LABEL: 5, WIRE: 1, WIRELABEL: 3, TEXT: 7, GRAPHICS: 6, REPORT: 7 };

// Non-ASCII characters as \U+XXXX, which AutoCAD and most readers understand in R12 text.
const txt = s => String(s).replace(/[^\x20-\x7e]/g, ch => `\\U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
const f = v => (Math.round(v * 10000) / 10000).toString();

export function pageDxf(proj, page, ctx = {}) {
  const { W, H, layers } = pageLayers(proj, page, { ...ctx, xrefs: ctx.xrefs || crossRefs(proj) });
  const out = [];
  const g = (code, v) => out.push(String(code), String(v));
  const Y = y => H - y;
  const lt = o => (o?.dash ? 'DASHED' : null);

  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$EXTMIN'); g(10, 0); g(20, 0); g(30, 0);
  g(9, '$EXTMAX'); g(10, f(W)); g(20, f(H)); g(30, 0);
  g(9, '$LIMMAX'); g(10, f(W)); g(20, f(H));
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, '__ __ __'); g(72, 65); g(73, 2); g(40, 2.4); g(49, 1.6); g(49, -0.8);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, Object.keys(LAYERS).length);
  for (const [name, color] of Object.entries(LAYERS)) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
  g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 0.85); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'arial.ttf'); g(4, '');
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  const head = (type, layer, o) => { g(0, type); g(8, layer); const l = lt(o); if (l) g(6, l); };
  const emit = (p, layer) => {
    switch (p[0]) {
      case 'l': head('LINE', layer, p[5]); g(10, f(p[1])); g(20, f(Y(p[2]))); g(30, 0); g(11, f(p[3])); g(21, f(Y(p[4]))); g(31, 0); break;
      case 'p': case 'r': {
        const pts = p[0] === 'r' ? [[p[1], p[2]], [p[1] + p[3], p[2]], [p[1] + p[3], p[2] + p[4]], [p[1], p[2] + p[4]]] : p[1];
        const closed = p[0] === 'r' || p[2], o = p[0] === 'r' ? p[5] : p[3];
        if (o?.fill && pts.length === 3) {
          head('SOLID', layer); [0, 1, 2, 2].forEach((i, k) => { g(10 + k, f(pts[i][0])); g(20 + k, f(Y(pts[i][1]))); g(30 + k, 0); });
          break;
        }
        head('POLYLINE', layer, o); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
        for (const [x, y] of pts) { g(0, 'VERTEX'); g(8, layer); g(10, f(x)); g(20, f(Y(y))); g(30, 0); }
        g(0, 'SEQEND'); g(8, layer);
        break;
      }
      case 'c': head('CIRCLE', layer, p[4]); g(10, f(p[1])); g(20, f(Y(p[2]))); g(30, 0); g(40, f(p[3])); break;
      case 'a': head('ARC', layer, p[6]); g(10, f(p[1])); g(20, f(Y(p[2]))); g(30, 0); g(40, f(p[3]));
        g(50, f(((-p[5]) % 360 + 360) % 360)); g(51, f(((-p[4]) % 360 + 360) % 360)); break;
      case 't': {
        if (!p[3]) break;
        const just = { start: 0, middle: 1, end: 2 }[p[5]] ?? 0;
        head('TEXT', layer); g(10, f(p[1])); g(20, f(Y(p[2]))); g(30, 0); g(40, f(p[4])); g(1, txt(p[3])); g(7, 'STANDARD');
        if (p[6]?.rot) g(50, f(-p[6].rot));
        if (just) { g(72, just); g(11, f(p[1])); g(21, f(Y(p[2]))); g(31, 0); }
        break;
      }
    }
  };
  for (const ly of layers) {
    for (const p of ly.prims) emit(p, ly.layer);
    for (const p of ly.labels || []) emit(p, ly.layer === 'WIRE' ? 'WIRELABEL' : 'LABEL');
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
