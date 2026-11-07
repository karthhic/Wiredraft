// Generated report pages: terminal diagram, cable list, table of contents.
// Rows are computed from the drawing every time, so reports never go stale.

import { BY_ID } from './symbols.js';
import { L, R, T } from './geom.js';
import { frameGeom, reportTitle } from './frames.js';
import { posOf } from './xref.js';
import { addPage, nearestDevices, paperOf, wiresAt } from './model.js';

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

export function terminalStrips(proj) {
  const set = new Set();
  for (const pg of proj.pages) for (const s of pg.items.syms) if (BY_ID[s.sym]?.terminal && s.tag) set.add(s.tag);
  return [...set].sort(natural);
}

const target = (proj, page, c) => BY_ID[c.s.sym]?.xref ? `→ ${c.s.props?.name || '?'}` : `${c.s.tag || BY_ID[c.s.sym]?.name || c.s.sym}:${c.pin}`;

export function terminalRows(proj, strip) {
  const rows = [];
  for (const page of proj.pages) {
    if (page.kind === 'report') continue;
    for (const s of page.items.syms) {
      const sym = BY_ID[s.sym];
      if (!sym?.terminal || s.tag !== strip) continue;
      const pin = side => sym.pins.find(p => p.side === side)?.id;
      const ins = nearestDevices(page, s.id, pin('in'));
      const outs = nearestDevices(page, s.id, pin('out'));
      const ow = wiresAt(page, s.id, pin('out'))[0]?.props || {};
      const iw = wiresAt(page, s.id, pin('in'))[0]?.props || {};
      rows.push({
        term: s.props?.term || '?', bridge: s.props?.bridge || '', pe: sym.id === 'terminal_pe',
        outside: outs.map(c => target(proj, page, c)).join(', '),
        inside: ins.map(c => target(proj, page, c)).join(', '),
        cable: ow.cable || '', core: ow.core || '',
        wire: [ow.size || iw.size, ow.color || iw.color].filter(Boolean).join(' '),
        pos: posOf(proj, page, s.x),
      });
    }
  }
  return rows.sort((a, b) => natural(a.term, b.term));
}

export function cableRows(proj) {
  const used = new Map();
  for (const page of proj.pages) for (const w of page.items.wires) {
    const c = w.props?.cable;
    if (!c) continue;
    if (!used.has(c)) used.set(c, new Set());
    if (w.props.core) used.get(c).add(w.props.core);
  }
  const tags = new Set([...Object.keys(proj.cables), ...used.keys()]);
  const rows = [...tags].sort(natural).map(tag => {
    const c = proj.cables[tag] || {};
    return { tag, type: c.type || '', from: c.from || '', to: c.to || '', cores: [...(used.get(tag) || [])].sort(natural).join(', '), length: c.length || '', desc: c.desc || '' };
  });
  const totals = new Map();
  for (const r of rows) {
    const v = parseFloat(String(r.length).replace(',', '.'));
    if (r.type && isFinite(v)) totals.set(r.type, (totals.get(r.type) || 0) + v);
  }
  return { rows, totals: [...totals].sort((a, b) => natural(a[0], b[0])) };
}

export function tocRows(proj) {
  return proj.pages.map(p => ({ id: p.id, number: p.number, title: p.title, func: p.func || proj.meta.func || '', loc: p.loc || proj.meta.loc || '', date: p.date || proj.meta.date || '' }));
}

const SPECS = {
  terminal: {
    title: (td, r) => `${td('drawing.report.terminal')} ${r.strip}`,
    cols: [['cable', 0.12, 'rep.cable'], ['core', 0.06, 'rep.core'], ['outside', 0.22, 'rep.outside'], ['term', 0.08, 'rep.terminal'],
      ['bridge', 0.06, 'rep.bridge'], ['inside', 0.22, 'rep.inside'], ['wire', 0.14, 'rep.wire'], ['pos', 0.1, 'rep.page']],
    rows: (proj, r) => terminalRows(proj, r.strip),
  },
  cable: {
    title: td => td('drawing.report.cable'),
    cols: [['tag', 0.11, 'rep.cable'], ['type', 0.15, 'rep.type'], ['from', 0.19, 'rep.from'], ['to', 0.19, 'rep.to'],
      ['cores', 0.12, 'rep.coresUsed'], ['length', 0.09, 'rep.length'], ['desc', 0.15, 'rep.desc']],
    rows: proj => cableRows(proj).rows,
  },
  toc: {
    title: td => td('drawing.report.toc'),
    cols: [['number', 0.1, 'rep.page'], ['title', 0.5, 'rep.pageTitle'], ['func', 0.12, 'tb.function'], ['loc', 0.12, 'tb.location'], ['date', 0.16, 'tb.date']],
    rows: proj => tocRows(proj),
  },
};

const ROW = 5, HEAD = 6, TOP = 14;
export const rowsPerPage = paper => Math.floor((frameGeom(paper).draw.h - TOP - HEAD - 14) / ROW);

export function reportPrims(proj, page, paper, ctx = {}) {
  const td = ctx.td || (k => k), r = page.report || {}, spec = SPECS[r.type];
  if (!spec) return [];
  const g = frameGeom(paper), d = g.draw, x0 = d.x + 6, w = d.w - 12, out = [];
  const all = spec.rows(proj, r), per = rowsPerPage(paper), part = r.part || 0;
  const rows = all.slice(part * per, (part + 1) * per);
  out.push(T(x0, d.y + 9, reportTitle({ report: { ...r, part: 0 } }, td) + (part ? ` (${part + 1})` : ''), 4, 'start', { bold: true }));
  let y = d.y + TOP;
  out.push(R(x0, y, w, HEAD, { w: 0.35 }));
  let x = x0;
  for (const [, frac, key] of spec.cols) {
    out.push(T(x + 1, y + 4.2, td(`drawing.${key}`), 2.2, 'start', { bold: true }));
    x += frac * w;
    if (x < x0 + w - 0.1) out.push(L(x, y, x, y + HEAD + rows.length * ROW, { w: 0.18 }));
  }
  y += HEAD;
  for (const row of rows) {
    x = x0;
    for (const [k, frac] of spec.cols) {
      const v = String(row[k] ?? ''), max = Math.max(3, Math.floor((frac * w - 2) / 1.25));
      const text = v.length > max ? v.slice(0, max - 1) + '…' : v;
      out.push(T(x + 1, y + 3.6, text, 2.2, 'start', r.type === 'toc' && (k === 'number' || k === 'title') ? { parts: [{ t: text, page: row.id }] } : undefined));
      x += frac * w;
    }
    y += ROW;
    out.push(L(x0, y, x0 + w, y, { w: 0.13 }));
  }
  out.push(L(x0, d.y + TOP, x0, y, { w: 0.35 }), L(x0 + w, d.y + TOP, x0 + w, y, { w: 0.35 }), L(x0, y, x0 + w, y, { w: 0.35 }));
  if (r.type === 'cable' && (part + 1) * per >= all.length) {
    const { totals } = cableRows(proj);
    totals.forEach(([type, m], i) => out.push(T(x0, y + 6 + i * 4.5, `${td('drawing.rep.total')} ${type}: ${Math.round(m * 10) / 10} m`, 2.4, 'start', i ? undefined : { bold: false })));
  }
  if (!rows.length) out.push(T(x0 + 2, y + 5, td('drawing.rep.empty'), 2.4));
  return out;
}

/** Replace generated report pages: one set per terminal strip, then the cable list. */
export function generateReports(proj, { toc = false, td = k => k } = {}) {
  const keepReport = p => p.kind === 'report' && !p.report?.auto;
  proj.pages = proj.pages.filter(p => p.kind !== 'report' || keepReport(p));
  const paperFor = () => proj.meta.paper;
  const per = rowsPerPage(paperFor());
  const made = [];
  const push = (type, extra, count, title) => {
    const parts = Math.max(1, Math.ceil(count / per));
    for (let part = 0; part < parts; part++)
      made.push(addPage(proj, { title: parts > 1 ? `${title} (${part + 1}/${parts})` : title, kind: 'report', report: { type, auto: true, part, ...extra } }));
  };
  if (toc) push('toc', {}, proj.pages.length + 8, td('drawing.report.toc'));
  for (const strip of terminalStrips(proj)) push('terminal', { strip }, terminalRows(proj, strip).length, `${td('drawing.report.terminal')} ${strip}`);
  push('cable', {}, cableRows(proj).rows.length, td('drawing.report.cable'));
  return made;
}

export const reportPaper = (proj, page) => paperOf(proj, page);
