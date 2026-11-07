// Drawing frame (border, 0-9 column strip) and title-block templates.
// Templates are data: cells with a label key (translated into the drawing
// language) and a value pattern filled from project + page fields.

import { L, R, T, P } from './geom.js';
import { PAPERS } from './model.js';

const M = 5, COL_H = 5, TB_H = 20;

export function frameGeom(paper) {
  const { w, h } = PAPERS[paper] || PAPERS.A3;
  const x0 = M, y0 = M, x1 = w - M, y1 = h - M;
  const draw = { x: x0, y: y0 + COL_H, w: x1 - x0, h: y1 - TB_H - (y0 + COL_H) };
  return { W: w, H: h, x0, y0, x1, y1, colW: (x1 - x0) / 10, draw, tb: { x: x0, y: y1 - TB_H, w: x1 - x0, h: TB_H } };
}

export const column = (paper, x) => Math.max(0, Math.min(9, Math.floor((x - M) / frameGeom(paper).colW)));

// Cells: x/w in template units (scaled to the real width when `scale`), y/h in mm.
export const TEMPLATES = {
  standard: {
    name: 'Standard (full width)', ref: 410, scale: true,
    cells: [
      { x: 0, y: 0, w: 34, h: 20, logo: true },
      { x: 34, y: 0, w: 62, h: 20, label: 'tb.company', value: '{company}\n{address}\n{phone}', size: 2.4, bold: true },
      { x: 96, y: 0, w: 104, h: 10, label: 'tb.project', value: '{title}', size: 3, bold: true },
      { x: 96, y: 10, w: 104, h: 10, label: 'tb.description', value: '{description}', size: 2.2 },
      { x: 200, y: 0, w: 90, h: 12, label: 'tb.pageTitle', value: '{page.title}', size: 3.2, bold: true },
      { x: 200, y: 12, w: 90, h: 8, label: 'tb.customer', value: '{customer}', size: 2.2 },
      { x: 290, y: 0, w: 40, h: 20 / 3, label: 'tb.date', value: '{date}' },
      { x: 290, y: 20 / 3, w: 40, h: 20 / 3, label: 'tb.drawnBy', value: '{drawnBy}' },
      { x: 290, y: 40 / 3, w: 40, h: 20 / 3, label: 'tb.approved', value: '{approved}' },
      { x: 330, y: 0, w: 40, h: 20 / 3, label: 'tb.function', value: '={func}' },
      { x: 330, y: 20 / 3, w: 40, h: 20 / 3, label: 'tb.location', value: '+{loc}' },
      { x: 330, y: 40 / 3, w: 40, h: 20 / 3, label: 'tb.revision', value: '{revision}' },
      { x: 370, y: 0, w: 40, h: 20 / 3, label: 'tb.drawingNo', value: '{drawingNo}' },
      { x: 370, y: 20 / 3, w: 40, h: 20 / 3, label: 'tb.page', value: '{page.number}', size: 2.8, bold: true },
      { x: 370, y: 40 / 3, w: 40, h: 20 / 3, label: 'tb.sheet', value: '{page.index} / {pages}' },
    ],
  },
  compact: {
    name: 'Compact (right corner)', ref: 180, scale: false, align: 'right',
    cells: [
      { x: 0, y: 0, w: 30, h: 20, logo: true },
      { x: 30, y: 0, w: 70, h: 10, label: 'tb.project', value: '{title}', size: 2.6, bold: true },
      { x: 30, y: 10, w: 70, h: 10, label: 'tb.pageTitle', value: '{page.title}', size: 2.6, bold: true },
      { x: 100, y: 0, w: 40, h: 10, label: 'tb.company', value: '{company}', size: 2.2 },
      { x: 100, y: 10, w: 40, h: 10, label: 'tb.date', value: '{date}  {drawnBy}', size: 2 },
      { x: 140, y: 0, w: 40, h: 10, label: 'tb.drawingNo', value: '{drawingNo} rev {revision}', size: 2 },
      { x: 140, y: 10, w: 40, h: 10, label: 'tb.page', value: '{page.number}  ({page.index}/{pages})', size: 2.6, bold: true },
    ],
  },
};

/** Title of a generated report page in the drawing language. */
export function reportTitle(page, td = k => k) {
  const r = page.report || {};
  const base = r.type === 'terminal' ? `${td('drawing.report.terminal')} ${r.strip || ''}` : r.type === 'cable' ? td('drawing.report.cable') : td('drawing.report.toc');
  return r.part ? `${base} (${r.part + 1})` : base;
}
export const pageTitle = (page, td) => (page.kind === 'report' && page.report?.auto ? reportTitle(page, td) : page.title || '');

export function fieldValues(proj, page, ctx = {}) {
  const m = proj.meta;
  const f = {
    title: m.title, description: m.description, customer: m.customer, company: m.company, address: m.address,
    phone: m.phone, drawingNo: m.drawingNo, drawnBy: m.drawnBy, approved: m.approved, revision: m.revision,
    func: page.func || m.func, loc: page.loc || m.loc,
    date: ctx.formatDate ? ctx.formatDate(page.date || m.date) : (page.date || m.date || ''),
    'page.title': pageTitle(page, ctx.td), 'page.number': page.number,
    'page.index': proj.pages.indexOf(page) + 1, pages: proj.pages.length,
  };
  return f;
}

const fill = (pattern, f) => pattern.replace(/\{([\w.]+)\}/g, (_, k) => f[k] ?? '').replace(/^[=+]$/gm, '');

export function framePrims(proj, page, paper, ctx = {}) {
  const g = frameGeom(paper), td = ctx.td || (k => k), out = [];
  out.push(R(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0, { w: 0.5 }));
  // column strip
  out.push(L(g.x0, g.y0 + COL_H, g.x1, g.y0 + COL_H, { w: 0.25 }));
  for (let i = 0; i < 10; i++) {
    const x = g.x0 + i * g.colW;
    if (i) out.push(L(x, g.y0, x, g.y0 + COL_H, { w: 0.25 }));
    out.push(T(x + g.colW / 2, g.y0 + 3.6, i, 2.2, 'middle'));
  }
  // title block
  const tpl = TEMPLATES[proj.meta.template] || TEMPLATES.standard;
  const tbW = tpl.scale ? g.tb.w : tpl.ref;
  const k = tbW / tpl.ref, ox = tpl.align === 'right' ? g.x1 - tbW : g.tb.x, oy = g.tb.y;
  out.push(L(g.x0, oy, g.x1, oy, { w: 0.35 }));
  if (tpl.align === 'right') out.push(L(ox, oy, ox, g.y1, { w: 0.35 }));
  const f = fieldValues(proj, page, ctx);
  for (const c of tpl.cells) {
    const x = ox + c.x * k, w = c.w * k, y = oy + c.y;
    out.push(R(x, y, w, c.h, { w: 0.18 }));
    if (c.logo) {
      if (proj.meta.logo) out.push(['img', x + 1, y + 1, w - 2, c.h - 2, proj.meta.logo]);
      continue;
    }
    if (c.label) out.push(T(x + 0.8, y + 2, td(`drawing.${c.label}`), 1.5, 'start', { cls: 'tbl' }));
    const size = c.size || 2.2;
    const lines = fill(c.value || '', f).split('\n').filter(Boolean);
    const maxChars = Math.max(4, Math.floor((w - 1.6) / (size * 0.56)));
    lines.slice(0, Math.max(1, Math.floor((c.h - 2.4) / (size * 1.15)))).forEach((ln, i) => {
      const s = ln.length > maxChars ? ln.slice(0, maxChars - 1) + '…' : ln;
      out.push(T(x + 0.8, y + 2.4 + size + i * size * 1.15, s, size, 'start', c.bold && i === 0 ? { bold: true } : undefined));
    });
  }
  return out;
}

/** Large project block for the cover page. */
export function coverPrims(proj, page, paper, ctx = {}) {
  const g = frameGeom(paper), td = ctx.td || (k => k), m = proj.meta, f = fieldValues(proj, page, ctx);
  const cx = g.draw.x + g.draw.w / 2, y = g.draw.y + g.draw.h * 0.28, out = [];
  if (m.logo) out.push(['img', cx - 30, g.draw.y + 12, 60, 28, m.logo]);
  out.push(T(cx, y, m.title || proj.name, 9, 'middle', { bold: true }));
  if (m.description) out.push(T(cx, y + 10, m.description, 4.5, 'middle'));
  const rows = [
    ['tb.customer', m.customer], ['tb.company', m.company], ['tb.drawingNo', m.drawingNo],
    ['tb.date', f.date], ['tb.drawnBy', m.drawnBy], ['tb.revision', m.revision], ['cover.pages', String(proj.pages.length)],
  ].filter(([, v]) => v);
  const tx = cx - 55, ty = y + 26;
  rows.forEach(([k, v], i) => {
    out.push(T(tx, ty + i * 7, td(`drawing.${k}`), 3, 'start', { cls: 'tbl' }));
    out.push(T(tx + 45, ty + i * 7, v, 3.4, 'start'));
    out.push(L(tx, ty + i * 7 + 2, tx + 110, ty + i * 7 + 2, { w: 0.13 }));
  });
  out.push(P([[g.draw.x + 10, g.draw.y + g.draw.h - 10], [g.draw.x + g.draw.w - 10, g.draw.y + g.draw.h - 10]], false, { w: 0.25 }));
  return out;
}
