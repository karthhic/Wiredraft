// WireDraft editor.
import { SYMBOLS, BY_ID, CATEGORIES, shapeOf, registerSymbols, unregisterSymbol, symbolDef } from '/core/symbols.js';
import { openSymbolEditor } from '/symedit.js';
import { PAPERS, GRID, snap, clone, getPage, addPage, nextTag, normTag, itemIds, uid, pinWorld, paperOf, placements } from '/core/model.js';
import { pageSVG, STYLE, wirePoints } from '/core/render.js';
import { svgOf, place, bbox, esc } from '/core/geom.js';
import { checkProject } from '/core/check.js';
import { makeT } from '/core/i18n.js';
import { applyOps } from '/core/ops.js';
import { generateReports } from '/core/reports.js';
import { crossRefs, posOf } from '/core/xref.js';
import { pageTitle } from '/core/frames.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const CLIENT = Math.random().toString(36).slice(2);
const svg = $('#sheet'), vp = $('#vp'), content = $('#content'), overlay = $('#overlay');
$('#sheetStyle').textContent = STYLE;

const S = {
  info: null, list: [], proj: null, pageId: null, sel: new Set(), tool: 'select', placing: null, wire: null,
  drag: null, view: { x: 20, y: 20, k: 2 }, undo: [], redo: [], dirty: false, saving: null, clip: null,
  chat: {}, mouse: { x: 0, y: 0 }, space: false, lastMain: {}, issues: [], back: [],
};
const dicts = {};
let T = k => k, TD = k => k;

// ================================================================== i18n
async function loadDict(code) {
  if (dicts[code]) return dicts[code];
  try { dicts[code] = (await (await fetch(`/lang/${code}.json`)).json()).strings || {}; } catch { dicts[code] = {}; }
  return dicts[code];
}
async function setLang(code, persist = true) {
  const en = await loadDict('en'), d = await loadDict(code);
  T = makeT(d, en, code);
  document.documentElement.lang = code;
  for (const el of $$('[data-i18n]')) el.textContent = T(el.dataset.i18n);
  for (const el of $$('[data-i18n-title]')) el.title = T(el.dataset.i18nTitle);
  for (const el of $$('[data-i18n-placeholder]')) el.placeholder = T(el.dataset.i18nPlaceholder);
  $('#langSel').value = code;
  if (persist) api('POST', '/api/config', { language: code }).catch(() => {});
  await setDrawingLang();
  renderPalette(); renderAll();
}
async function setDrawingLang() {
  const code = S.proj?.meta.language || T.locale || 'en';
  const en = await loadDict('en'), d = await loadDict(code);
  TD = makeT(d, en, code);
}
const symName = s => s.names?.[T.locale] || (T(`sym.${s.id}`) !== `sym.${s.id}` ? T(`sym.${s.id}`) : s.name);

// ================================================================== API
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-client': CLIENT }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw Object.assign(new Error(data?.error || r.statusText), { status: r.status, data });
  return data;
}
function toast(msg, err = false, ms = 3800) {
  const d = document.createElement('div');
  d.textContent = msg; if (err) d.className = 'err';
  $('#toast').append(d); setTimeout(() => d.remove(), ms);
}
const setStatus = k => { $('#status').textContent = k ? T(k) : ''; };

// ================================================================== project state
const page = () => getPage(S.proj, S.pageId) || S.proj?.pages[0];
const readOnly = () => page()?.kind === 'report';
const snapshot = () => JSON.stringify(S.proj);
function pushUndo(snap) { S.undo.push(snap); if (S.undo.length > 80) S.undo.shift(); S.redo = []; }
function commit(snap) {
  if (snap === snapshot()) { renderAll(); return; }
  pushUndo(snap); S.dirty = true; scheduleSave(); renderAll();
}
function edit(fn) { const snap = snapshot(); fn(); commit(snap); }
function runOps(ops) {
  const snap = snapshot();
  const r = applyOps(S.proj, ops, { page: S.pageId });
  if (r.errors.length) toast(r.errors.join('\n'), true);
  S.proj = r.proj; commit(snap);
  return r;
}
function restore(json) {
  const rev = S.proj.rev;
  S.proj = JSON.parse(json); S.proj.rev = rev;
  if (!getPage(S.proj, S.pageId)) S.pageId = S.proj.pages[0]?.id;
  pruneSel(); S.dirty = true; scheduleSave(); renderAll();
}
function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); }
function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); }
function pruneSel() {
  const pg = page(); if (!pg) return S.sel.clear();
  const ids = itemIds(pg);
  for (const id of [...S.sel]) if (!ids.has(id)) S.sel.delete(id);
}

let saveTimer;
function scheduleSave() { setStatus('status.unsaved'); clearTimeout(saveTimer); saveTimer = setTimeout(save, 700); }
async function save() {
  clearTimeout(saveTimer);
  if (!S.dirty || !S.proj) return;
  if (S.saving) { await S.saving; return save(); }
  S.dirty = false; setStatus('status.saving');
  const body = S.proj, name = S.proj.name;
  S.saving = api('PUT', `/api/projects/${encodeURIComponent(name)}`, body)
    .then(r => { if (S.proj.name === name) S.proj.rev = r.rev; setStatus('status.saved'); })
    .catch(async e => {
      if (e.status === 409 && e.data?.current) { replaceProject(e.data.current); toast(T('status.conflict')); }
      else { S.dirty = true; setStatus('status.saveFailed'); toast(e.message, true); }
    })
    .finally(() => { S.saving = null; });
  await S.saving;
}
function replaceProject(p, keepUndo = true) {
  registerSymbols(p.symbols || [], { override: false });
  delete p.symbols;
  if (keepUndo && S.proj) pushUndo(snapshot());
  S.proj = p;
  if (!getPage(p, S.pageId)) S.pageId = p.pages.find(x => x.kind === 'schematic')?.id || p.pages[0]?.id;
  pruneSel(); setDrawingLang().then(renderAll);
}

async function openProject(name) {
  await save();
  const p = await api('GET', `/api/projects/${encodeURIComponent(name)}`);
  registerSymbols(p.symbols || [], { override: false });
  delete p.symbols;
  S.proj = p; S.undo = []; S.redo = []; S.back = []; S.sel.clear();
  S.pageId = p.pages.find(x => x.kind === 'schematic')?.id || p.pages[0]?.id;
  try { localStorage.setItem('wd.project', name); } catch { /* private mode */ }
  $('#projSel').value = name;
  await setDrawingLang();
  renderAll(); fit();
}
async function refreshList() {
  S.list = await api('GET', '/api/projects');
  $('#projSel').innerHTML = S.list.map(p => `<option value="${esc(p.name)}">${esc(p.title || p.name)}</option>`).join('');
  if (S.proj) $('#projSel').value = S.proj.name;
}

// ================================================================== rendering
let xrefCache = null;
function renderAll() {
  if (!S.proj) return;
  xrefCache = crossRefs(S.proj);
  renderSheet(); renderPages(); renderProps(); renderDevices(); renderCables(); scheduleCheck(); updateButtons();
  $('#readonly').hidden = !readOnly();
}
function renderSheet() {
  const pg = page(); if (!pg) return;
  const { W, H, svg: inner } = pageSVG(S.proj, pg, { interactive: true, sel: S.sel, td: TD, formatDate: TD.formatDate, xrefs: xrefCache });
  $('#paper').setAttribute('width', W); $('#paper').setAttribute('height', H);
  content.innerHTML = inner;
  drawOverlay();
}
function applyView() { vp.setAttribute('transform', `translate(${S.view.x} ${S.view.y}) scale(${S.view.k})`); }
function fit() {
  const pg = page(); if (!pg) return;
  const { w, h } = PAPERS[paperOf(S.proj, pg)];
  const r = svg.getBoundingClientRect();
  const k = Math.min((r.width - 40) / w, (r.height - 40) / h);
  S.view = { k, x: (r.width - w * k) / 2, y: (r.height - h * k) / 2 };
  applyView();
}
function updateButtons() {
  $('#back').disabled = !S.back.length; $('#undo').disabled = !S.undo.length; $('#redo').disabled = !S.redo.length;
  $('#del').disabled = !S.sel.size; $('#rotate').disabled = !S.sel.size;
  for (const b of $$('#tools button')) b.classList.toggle('on', b.dataset.tool === S.tool);
  svg.classList.toggle('placing', !!S.placing); svg.classList.toggle('wiring', !!S.wire || S.tool === 'wire');
  for (const t of ['text', 'line', 'rect']) svg.classList.toggle(`tool-${t}`, S.tool === t);
  let h = '';
  if (readOnly()) h = T('hint.report');
  else if (S.placing) h = T('hint.placing', { name: symName(BY_ID[S.placing.sym]) });
  else if (S.wire) h = T('hint.wiring');
  else if (S.tool === 'wire') h = T('hint.wireTool');
  else if (S.tool === 'text') h = T('hint.text');
  else if (S.tool === 'line' || S.tool === 'rect') h = T('hint.draw');
  else h = T('hint.select');
  $('#hint').textContent = h;
}

// ---------------------------------------------------------------- overlay (ghost, rubber band, marquee)
function drawOverlay() {
  let s = '';
  const m = S.mouse;
  if (S.placing) {
    const sym = BY_ID[S.placing.sym];
    const sh = shapeOf(sym, { props: {} });
    s += `<g class="ghost">${svgOf(place(sh.prims, snap(m.x), snap(m.y), S.placing.rot))}</g>`;
  }
  if (S.wire) {
    const pg = page(), from = pg.items.syms.find(x => x.id === S.wire.from.s);
    const a = from && pinWorld(S.proj, from, S.wire.from.p);
    if (a) {
      const pts = [[a.x, a.y], ...S.wire.pts, [snap(m.x, 2), snap(m.y, 2)]];
      s += `<polyline class="rubber" points="${pts.map(p => p.join(',')).join(' ')}" stroke-width="0.3"/>`;
    }
  }
  if (S.drag?.kind === 'marquee' || S.drag?.kind === 'rect') {
    const d = S.drag, x = Math.min(d.x0, m.x), y = Math.min(d.y0, m.y);
    s += `<rect class="marquee" x="${x}" y="${y}" width="${Math.abs(m.x - d.x0)}" height="${Math.abs(m.y - d.y0)}"/>`;
  }
  if (S.drag?.kind === 'line') s += `<line class="rubber" x1="${S.drag.x0}" y1="${S.drag.y0}" x2="${snap(m.x, 2)}" y2="${snap(m.y, 2)}" stroke-width="0.3"/>`;
  overlay.innerHTML = s;
}

// ================================================================== sheet interaction
const toMM = e => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - S.view.x) / S.view.k, y: (e.clientY - r.top - S.view.y) / S.view.k }; };

function selectOnly(ids) { S.sel = new Set(ids); renderAll(); }

function newSymbol(symId, x, y, rot = 0) {
  const pg = page(), sym = BY_ID[symId];
  const s = { id: uid('s', itemIds(pg)), sym: symId, tag: '', x: snap(x), y: snap(y), rot, props: {} };
  if (!sym.noTag) {
    if (sym.terminal || symId === 'plug') {
      const strip = S.lastMain.X || '-X1';
      s.tag = strip;
      const used = placements(S.proj, strip).map(p => parseInt(p.s.props?.term, 10)).filter(isFinite);
      s.props.term = String(used.length ? Math.max(...used) + 1 : 1);
    } else if (sym.role === 'aux' && S.lastMain[sym.letter]) s.tag = S.lastMain[sym.letter];
    else if (sym.cable) {
      const nums = Object.keys(S.proj.cables).map(t => +t.match(/^-W(\d+)$/)?.[1]).filter(isFinite);
      s.tag = `-W${nums.length ? Math.max(...nums) + 1 : 1}`;
      S.proj.cables[s.tag] ||= {};
    } else s.tag = nextTag(S.proj, sym.letter || 'A');
    if (s.tag && !sym.cable) S.proj.devices[s.tag] ||= {};
    if (sym.role === 'main' || (!sym.role && sym.letter === 'K')) S.lastMain[sym.letter] = s.tag;
  }
  if (sym.box) Object.assign(s.props, { pinsTop: '1,2', pinsBottom: '3,4', w: '24', h: '16' });
  pg.items.syms.push(s);
  return s;
}

function connect(a, b, pts = []) {
  const pg = page();
  if (a.s === b.s && a.p === b.p) return null;
  const same = (x, y) => x.s === y.s && x.p === y.p;
  if (pg.items.wires.some(w => (same(w.a, a) && same(w.b, b)) || (same(w.a, b) && same(w.b, a)))) return null;
  const w = { id: uid('w', itemIds(pg)), a, b, props: {} };
  if (pts.length) w.pts = pts;
  pg.items.wires.push(w);
  return w;
}

/** Split a wire at a point with a new connection point (T-junction). Returns the node pin. */
function splitWire(wid, pt) {
  const pg = page(), w = pg.items.wires.find(x => x.id === wid);
  const pts = wirePoints(S.proj, pg, w);
  let best = null, bd = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    const cx = x1 === x2 ? x1 : Math.max(Math.min(x1, x2), Math.min(Math.max(x1, x2), snap(pt.x)));
    const cy = y1 === y2 ? y1 : Math.max(Math.min(y1, y2), Math.min(Math.max(y1, y2), snap(pt.y)));
    const d = Math.hypot(cx - pt.x, cy - pt.y);
    if (d < bd) { bd = d; best = [cx, cy]; }
  }
  const node = { id: uid('s', itemIds(pg)), sym: 'node', tag: '', x: best[0], y: best[1], rot: 0, props: {} };
  pg.items.syms.push(node);
  pg.items.wires = pg.items.wires.filter(x => x !== w);
  const w1 = { id: uid('w', itemIds(pg)), a: w.a, b: { s: node.id, p: '1' }, props: { ...w.props } };
  pg.items.wires.push(w1);
  const w2 = { id: uid('w', itemIds(pg)), a: { s: node.id, p: '1' }, b: w.b, props: { ...w.props } };
  pg.items.wires.push(w2);
  return { s: node.id, p: '1' };
}

function itemsIn(x0, y0, x1, y1) {
  const pg = page(), [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  const inside = (x, y) => x >= ax && x <= bx && y >= ay && y <= by;
  const ids = [];
  for (const s of pg.items.syms) if (inside(s.x, s.y)) ids.push(s.id);
  for (const t of pg.items.texts) if (inside(t.x, t.y)) ids.push(t.id);
  for (const l of pg.items.lines) if (inside(l.x1, l.y1) && inside(l.x2, l.y2)) ids.push(l.id);
  for (const r of pg.items.rects) if (inside(r.x, r.y) && inside(r.x + r.w, r.y + r.h)) ids.push(r.id);
  for (const w of pg.items.wires) { const pts = wirePoints(S.proj, pg, w); if (pts?.every(([x, y]) => inside(x, y))) ids.push(w.id); }
  return ids;
}

function cancelModes() { S.placing = null; S.wire = null; S.drag = null; for (const t of $$('.tile.on')) t.classList.remove('on'); drawOverlay(); updateButtons(); }

svg.addEventListener('contextmenu', e => { e.preventDefault(); cancelModes(); });

// references are tiny at fit-page zoom: empty space just beside one still counts as clicking it
function linkNear(e, reach = 6) {
  return [...svg.querySelectorAll('a[data-page]')].find(a => {
    const r = a.getBoundingClientRect();
    return e.clientX >= r.left - reach && e.clientX <= r.right + reach && e.clientY >= r.top - reach && e.clientY <= r.bottom + reach;
  });
}
svg.addEventListener('click', e => { if (e.target.closest('a[data-page]')) e.preventDefault(); });
svg.addEventListener('pointerdown', e => {
  if (document.activeElement?.closest('aside')) document.activeElement.blur();
  const m = toMM(e); S.mouse = m;
  if (e.button === 1 || (e.button === 0 && S.space)) {
    S.drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, vx: S.view.x, vy: S.view.y };
    svg.classList.add('panning'); svg.setPointerCapture(e.pointerId); return;
  }
  if (e.button !== 0 || !S.proj) return;
  const linkEl = e.target.closest('a[data-page]') || (!e.target.closest('.it') && linkNear(e));
  if (linkEl && !S.placing && !S.wire && S.tool === 'select') { followLink(linkEl.dataset.page, linkEl.dataset.sym); return; }
  if (readOnly()) { S.drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, vx: S.view.x, vy: S.view.y }; svg.setPointerCapture(e.pointerId); return; }
  const pg = page();
  const pinEl = e.target.closest('.pin'), itEl = e.target.closest('.it');

  if (S.placing) {
    edit(() => { const s = newSymbol(S.placing.sym, m.x, m.y, S.placing.rot); S.sel = new Set([s.id]); });
    return;
  }
  if (pinEl) {
    const pin = { s: pinEl.dataset.s, p: pinEl.dataset.p };
    if (!S.wire) { S.wire = { from: pin, pts: [] }; S.sel.clear(); renderAll(); return; }
    const from = S.wire.from, pts = S.wire.pts;
    S.wire = null;
    edit(() => { const w = connect(from, pin, pts); if (w) S.sel = new Set([w.id]); });
    return;
  }
  if (S.wire) {
    if (itEl?.classList.contains('wire')) {
      const from = S.wire.from, pts = S.wire.pts;
      S.wire = null;
      edit(() => { const node = splitWire(itEl.dataset.id, m); connect(from, node, pts); });
      return;
    }
    const last = S.wire.pts.at(-1) || (() => { const s = pg.items.syms.find(x => x.id === S.wire.from.s); const w = pinWorld(S.proj, s, S.wire.from.p); return [w.x, w.y]; })();
    let p = [snap(m.x, 2), snap(m.y, 2)];
    p = Math.abs(p[0] - last[0]) > Math.abs(p[1] - last[1]) ? [p[0], last[1]] : [last[0], p[1]];
    S.wire.pts.push(p); drawOverlay(); return;
  }
  if (S.tool === 'text') {
    let id;
    edit(() => { id = uid('t', itemIds(pg)); pg.items.texts.push({ id, x: snap(m.x, 1), y: snap(m.y, 1), text: T('ui.newText'), size: 2.5 }); S.sel = new Set([id]); });
    setTimeout(() => { const el = $('#pane-props [data-k="text"]'); el?.focus(); el?.select(); }, 30);
    return;
  }
  if (S.tool === 'line') { S.drag = { kind: 'line', x0: snap(m.x, 2), y0: snap(m.y, 2) }; svg.setPointerCapture(e.pointerId); return; }
  if (S.tool === 'rect') { S.drag = { kind: 'rect', x0: snap(m.x, 2), y0: snap(m.y, 2) }; svg.setPointerCapture(e.pointerId); return; }

  if (itEl) {
    const id = itEl.dataset.id;
    if (e.shiftKey) { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); renderAll(); return; }
    if (!S.sel.has(id)) S.sel = new Set([id]);
    if (e.detail === 2) { renderAll(); setTimeout(() => $('#pane-props input:not([readonly]), #pane-props select')?.focus(), 30); return; }
    const movable = [...S.sel].map(i => pg.items.syms.find(s => s.id === i) || pg.items.texts.find(t => t.id === i)).filter(Boolean);
    const lines = [...S.sel].map(i => pg.items.lines.find(l => l.id === i) || pg.items.rects.find(r => r.id === i)).filter(Boolean);
    S.drag = { kind: 'move', x0: m.x, y0: m.y, snap: snapshot(), items: movable.map(o => ({ o, x: o.x, y: o.y })), lines: lines.map(o => ({ o, ...o })), moved: false };
    svg.setPointerCapture(e.pointerId);
    renderAll();
    return;
  }
  S.sel.clear();
  S.drag = { kind: 'marquee', x0: m.x, y0: m.y };
  svg.setPointerCapture(e.pointerId);
  renderAll();
});

svg.addEventListener('pointermove', e => {
  const m = toMM(e); S.mouse = m;
  const d = S.drag;
  if (d?.kind === 'pan') { S.view.x = d.vx + e.clientX - d.cx; S.view.y = d.vy + e.clientY - d.cy; applyView(); return; }
  if (d?.kind === 'move') {
    const dx = snap(m.x - d.x0), dy = snap(m.y - d.y0);
    if (!dx && !dy && !d.moved) return;
    d.moved = true;
    for (const it of d.items) { it.o.x = it.x + dx; it.o.y = it.y + dy; }
    for (const l of d.lines) {
      if ('x1' in l.o) Object.assign(l.o, { x1: l.x1 + dx, y1: l.y1 + dy, x2: l.x2 + dx, y2: l.y2 + dy });
      else Object.assign(l.o, { x: l.x + dx, y: l.y + dy });
    }
    xrefCache = crossRefs(S.proj); renderSheet(); return;
  }
  if (S.placing || S.wire || d) drawOverlay();
});

svg.addEventListener('pointerup', e => {
  const d = S.drag; S.drag = null; svg.classList.remove('panning');
  if (!d) return;
  const m = toMM(e);
  if (d.kind === 'move' && d.moved) commit(d.snap);
  else if (d.kind === 'marquee') { if (Math.abs(m.x - d.x0) > 1 || Math.abs(m.y - d.y0) > 1) selectOnly(itemsIn(d.x0, d.y0, m.x, m.y)); else drawOverlay(); }
  else if (d.kind === 'line') {
    const x2 = snap(m.x, 2), y2 = snap(m.y, 2);
    if (Math.hypot(x2 - d.x0, y2 - d.y0) > 1) edit(() => { const pg = page(); const id = uid('l', itemIds(pg)); pg.items.lines.push({ id, x1: d.x0, y1: d.y0, x2, y2, style: 'solid' }); S.sel = new Set([id]); });
    else drawOverlay();
  } else if (d.kind === 'rect') {
    const x = Math.min(d.x0, snap(m.x, 2)), y = Math.min(d.y0, snap(m.y, 2)), w = Math.abs(snap(m.x, 2) - d.x0), h = Math.abs(snap(m.y, 2) - d.y0);
    if (w > 1 && h > 1) edit(() => { const pg = page(); const id = uid('r', itemIds(pg)); pg.items.rects.push({ id, x, y, w, h, style: 'dash' }); S.sel = new Set([id]); });
    else drawOverlay();
  }
});

svg.addEventListener('wheel', e => {
  e.preventDefault();
  const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const k = Math.min(40, Math.max(0.5, S.view.k * Math.exp(-e.deltaY * 0.0015)));
  S.view.x = mx - (mx - S.view.x) * k / S.view.k; S.view.y = my - (my - S.view.y) * k / S.view.k; S.view.k = k;
  applyView();
}, { passive: false });

window.addEventListener('resize', () => fit());

// ---------------------------------------------------------------- selection actions
function deleteSel() {
  if (!S.sel.size || readOnly()) return;
  edit(() => {
    const pg = page(), ids = S.sel;
    pg.items.syms = pg.items.syms.filter(s => !ids.has(s.id));
    pg.items.wires = pg.items.wires.filter(w => !ids.has(w.id) && pg.items.syms.some(s => s.id === w.a.s) && pg.items.syms.some(s => s.id === w.b.s));
    for (const k of ['texts', 'lines', 'rects']) pg.items[k] = pg.items[k].filter(x => !ids.has(x.id));
    S.sel.clear();
  });
}
function rotateSel() {
  if (S.placing) { S.placing.rot = (S.placing.rot + 90) % 360; drawOverlay(); return; }
  if (!S.sel.size || readOnly()) return;
  edit(() => { for (const s of page().items.syms) if (S.sel.has(s.id)) s.rot = ((s.rot || 0) + 90) % 360; });
}
function nudge(dx, dy) {
  if (!S.sel.size || readOnly()) return;
  edit(() => {
    const pg = page();
    for (const s of pg.items.syms) if (S.sel.has(s.id)) { s.x += dx; s.y += dy; }
    for (const t of pg.items.texts) if (S.sel.has(t.id)) { t.x += dx; t.y += dy; }
  });
}
function copySel() {
  const pg = page(); if (!S.sel.size) return;
  const syms = pg.items.syms.filter(s => S.sel.has(s.id));
  const ids = new Set(syms.map(s => s.id));
  S.clip = {
    syms: clone(syms), devices: Object.fromEntries(syms.filter(s => s.tag).map(s => [s.tag, clone(S.proj.devices[s.tag] || {})])),
    wires: clone(pg.items.wires.filter(w => ids.has(w.a.s) && ids.has(w.b.s))),
    texts: clone(pg.items.texts.filter(t => S.sel.has(t.id))), lines: clone(pg.items.lines.filter(l => S.sel.has(l.id))),
  };
  toast(T('ui.copied', { n: syms.length + S.clip.texts.length }));
}
function paste(offset = 8) {
  if (!S.clip || readOnly()) return;
  edit(() => {
    const pg = page(), map = new Map(), tagMap = new Map(), fresh = [];
    for (const s0 of S.clip.syms) {
      const s = clone(s0), sym = BY_ID[s.sym];
      s.id = uid('s', itemIds(pg)); s.x += offset; s.y += offset;
      if (s.tag && !sym.noTag && !sym.terminal && !sym.cable) {
        if (!tagMap.has(s.tag)) { const t = nextTag(S.proj, sym.letter || 'A'); tagMap.set(s.tag, t); S.proj.devices[t] = clone(S.clip.devices[s.tag] || {}); }
        s.tag = tagMap.get(s.tag);
      } else if (sym.terminal && s.tag) {
        const used = placements(S.proj, s.tag).map(p => parseInt(p.s.props?.term, 10)).filter(isFinite);
        s.props.term = String((used.length ? Math.max(...used) : 0) + 1);
      }
      map.set(s0.id, s.id); pg.items.syms.push(s); fresh.push(s.id);
    }
    for (const w0 of S.clip.wires) { const w = clone(w0); w.id = uid('w', itemIds(pg)); w.a.s = map.get(w.a.s); w.b.s = map.get(w.b.s); if (w.pts) w.pts = w.pts.map(([x, y]) => [x + offset, y + offset]); pg.items.wires.push(w); fresh.push(w.id); }
    for (const t0 of S.clip.texts) { const t = { ...t0, id: uid('t', itemIds(pg)), x: t0.x + offset, y: t0.y + offset }; pg.items.texts.push(t); fresh.push(t.id); }
    for (const l0 of S.clip.lines) { const l = { ...l0, id: uid('l', itemIds(pg)), x1: l0.x1 + offset, y1: l0.y1 + offset, x2: l0.x2 + offset, y2: l0.y2 + offset }; pg.items.lines.push(l); fresh.push(l.id); }
    S.sel = new Set(fresh);
  });
}

// ---------------------------------------------------------------- keyboard
window.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select, dialog')) { if (e.key === 'Escape') e.target.blur(); return; }
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
  else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 's') { e.preventDefault(); save(); }
  else if (mod && k === 'c') copySel();
  else if (mod && k === 'v') paste();
  else if (mod && k === 'd') { e.preventDefault(); copySel(); paste(); }
  else if (mod && k === 'a') { e.preventDefault(); selectOnly(itemsIn(-1e4, -1e4, 1e4, 1e4)); }
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
  else if (k === 'r') rotateSel();
  else if (e.key === 'Escape') { cancelModes(); S.sel.clear(); setTool('select'); renderAll(); }
  else if (k === 'f') fit();
  else if (k === 'v' && !mod) setTool('select');
  else if (k === 'w') setTool('wire');
  else if (k === 't') setTool('text');
  else if (k === 'l') setTool('line');
  else if (k === 'b') setTool('rect');
  else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); stepPage(e.key === 'PageDown' ? 1 : -1); }
  else if (e.key.startsWith('Arrow')) { e.preventDefault(); const d = e.shiftKey ? 1 : GRID; nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0); }
  else if (e.key === ' ') { S.space = true; e.preventDefault(); }
});
window.addEventListener('keyup', e => { if (e.key === ' ') S.space = false; });

function setTool(t) { S.tool = t; S.placing = null; S.wire = null; for (const x of $$('.tile.on')) x.classList.remove('on'); drawOverlay(); updateButtons(); }
for (const b of $$('#tools button')) b.onclick = () => setTool(b.dataset.tool);
$('#back').onclick = goBack; $('#undo').onclick = undo; $('#redo').onclick = redo; $('#rotate').onclick = rotateSel; $('#del').onclick = deleteSel; $('#fit').onclick = fit;

// ================================================================== pages
function goPage(id) { S.pageId = id; S.sel.clear(); cancelModes(); renderAll(); fit(); }
function followLink(pageId, symId) {
  S.back.push({ pageId: S.pageId, view: { ...S.view } });
  goPage(pageId);
  if (symId) { S.sel = new Set([symId]); renderAll(); }
}
function goBack() {
  const b = S.back.pop();
  if (!b) return;
  goPage(getPage(S.proj, b.pageId) ? b.pageId : S.pageId);
  S.view = b.view; applyView();
}
function stepPage(d) { const i = S.proj.pages.indexOf(page()); const p = S.proj.pages[i + d]; if (p) goPage(p.id); }
function renderPages() {
  const kindLbl = p => p.kind === 'schematic' ? '' : T(`pages.kind.${p.kind}`);
  $('#pageList').innerHTML = S.proj.pages.map(p => `<li data-id="${p.id}" class="${p.id === page().id ? 'on' : ''}"><span class="num">${esc(p.number)}</span><span>${esc(pageTitle(p, TD))}</span><span class="kind">${esc(kindLbl(p))}</span></li>`).join('');
}
$('#pageList').onclick = e => { const li = e.target.closest('li'); if (li) goPage(li.dataset.id); };
$('#addPage').onclick = () => {
  let id;
  edit(() => { id = addPage(S.proj, { title: T('pages.newTitle'), after: page().id }).id; });
  goPage(id);
};
$('#dupPage').onclick = () => {
  const src = page(); if (src.kind !== 'schematic') return;
  let id;
  edit(() => {
    const p = addPage(S.proj, { title: `${src.title}`, after: src.id });
    p.items = clone(src.items);
    const tagMap = new Map();
    for (const s of p.items.syms) {
      const sym = BY_ID[s.sym];
      if (!s.tag || sym?.noTag || sym?.terminal || sym?.cable) continue;
      if (!tagMap.has(s.tag)) { const t = nextTag(S.proj, sym.letter || 'A'); tagMap.set(s.tag, t); S.proj.devices[t] = clone(S.proj.devices[s.tag] || {}); }
      s.tag = tagMap.get(s.tag);
    }
    id = p.id;
  });
  goPage(id);
};
$('#upPage').onclick = () => movePage(-1);
$('#downPage').onclick = () => movePage(1);
function movePage(d) {
  const i = S.proj.pages.indexOf(page()), j = i + d;
  if (j < 0 || j >= S.proj.pages.length) return;
  edit(() => { const [p] = S.proj.pages.splice(i, 1); S.proj.pages.splice(j, 0, p); });
}
$('#delPage').onclick = async () => {
  if (S.proj.pages.length < 2) return;
  const pg = page();
  if (!(await confirmDlg(T('pages.confirmDelete', { n: pg.number, title: pg.title })))) return;
  const i = S.proj.pages.indexOf(pg);
  edit(() => { S.proj.pages.splice(i, 1); S.pageId = S.proj.pages[Math.max(0, i - 1)].id; });
  fit();
};

// ================================================================== symbol palette
function symTile(s) {
  const sh = shapeOf(s, { props: s.box ? { pinsTop: '1,2', pinsBottom: '3,4' } : {} });
  const b = bbox(sh.prims.filter(p => p[0] !== 't'));
  const pad = 2.5, vb = `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;
  return `<div class="tile${s.custom ? ' custom' : ''}" data-sym="${s.id}" title="${esc(symName(s))} · ${esc(T(s.custom ? 'symedit.tileEdit' : 'symedit.tileCopy'))}"><svg viewBox="${vb}" class="wd" preserveAspectRatio="xMidYMid meet"><g style="stroke-width:.35">${svgOf(sh.prims.filter(p => p[0] !== 't'))}</g></svg><span>${esc(symName(s))}</span></div>`;
}
function renderPalette() {
  const q = $('#symSearch').value.trim().toLowerCase();
  const match = s => !q || symName(s).toLowerCase().includes(q) || s.id.includes(q) || (s.letter && `-${s.letter.toLowerCase()}` === q);
  const cats = [...new Set([...CATEGORIES, ...SYMBOLS.map(s => s.cat)])];
  const catName = c => (T(`cat.${c}`) !== `cat.${c}` ? T(`cat.${c}`) : c);
  $('#symList').innerHTML = cats.map(c => {
    const list = SYMBOLS.filter(s => s.cat === c && match(s));
    return list.length ? `<div class="symcat">${esc(catName(c))}</div><div class="symgrid">${list.map(symTile).join('')}</div>` : '';
  }).join('') + `<p class="muted small">${esc(T('symedit.paletteHint'))}</p>`;
}

// ---------------------------------------------------------------- custom symbols
function editSymbol(id, importImage, imageMode) {
  const s = id && BY_ID[id];
  openSymbolEditor({
    T, api, toast, langs: S.info.langs, importImage, imageMode,
    base: s ? symbolDef(s) : null, editing: !!s?.custom,
    onSaved: def => { registerSymbols([def]); renderPalette(); renderAll(); },
    onDeleted: id => {
      if (!S.proj.pages.some(p => p.items.syms.some(x => x.sym === id))) unregisterSymbol(id);
      renderPalette(); toast(T('symedit.deleted', { id }));
    },
  });
}
async function reloadLibrary() {
  try { registerSymbols((await api('GET', '/api/library')).symbols); } catch { /* offline */ }
  renderPalette(); if (S.proj) renderAll();
}
$('#newSymbol').onclick = () => editSymbol(null);
$('#importSymbol').onchange = e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const rd = new FileReader(); rd.onload = () => editSymbol(null, rd.result); rd.readAsDataURL(f);
};
$('#bgSymbol').onchange = e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const rd = new FileReader(); rd.onload = () => editSymbol(null, rd.result, 'background'); rd.readAsDataURL(f);
};
$('#symList').addEventListener('contextmenu', e => {
  const t = e.target.closest('.tile'); if (!t) return;
  e.preventDefault(); editSymbol(t.dataset.sym);
});
$('#symSearch').oninput = renderPalette;
$('#symList').onclick = e => {
  const t = e.target.closest('.tile'); if (!t || readOnly()) return;
  for (const x of $$('.tile.on')) x.classList.remove('on');
  t.classList.add('on');
  S.tool = 'select'; S.wire = null; S.placing = { sym: t.dataset.sym, rot: 0 };
  updateButtons(); drawOverlay();
};

// ================================================================== devices & cables
function renderDevices() {
  const q = $('#devSearch').value.trim().toLowerCase();
  const map = new Map();
  for (const pg of S.proj.pages) {
    if (pg.kind === 'report') continue;
    for (const s of pg.items.syms) if (s.tag && !BY_ID[s.sym]?.noTag && !BY_ID[s.sym]?.cable) { if (!map.has(s.tag)) map.set(s.tag, []); map.get(s.tag).push({ pg, s }); }
  }
  const rows = [...map].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .filter(([tag]) => !q || tag.toLowerCase().includes(q) || (S.proj.devices[tag]?.desc || '').toLowerCase().includes(q));
  $('#devList').innerHTML = rows.map(([tag, list]) => {
    const d = S.proj.devices[tag] || {};
    const where = [...new Set(list.map(({ pg, s }) => posOf(S.proj, pg, s.x)))].join(', ');
    return `<li data-tag="${esc(tag)}"><span class="num">${esc(tag)}</span><span class="muted small">${esc(d.desc || d.rating || '')}</span><span class="kind">${esc(where)}</span></li>`;
  }).join('') || `<li class="muted">${esc(T('devices.none'))}</li>`;
}
$('#devSearch').oninput = renderDevices;
$('#devList').onclick = e => {
  const li = e.target.closest('li[data-tag]'); if (!li) return;
  const first = placements(S.proj, li.dataset.tag).find(p => p.page.kind !== 'report');
  if (first) { goPage(first.page.id); selectOnly([first.s.id]); }
};

function renderCables() {
  const tags = Object.keys(S.proj.cables).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!tags.length) { $('#cableList').innerHTML = `<p class="muted small">${esc(T('cables.none'))}</p>`; return; }
  const f = (tag, k, w) => `<input data-cable="${esc(tag)}" data-k="${k}" value="${esc(S.proj.cables[tag][k] || '')}" ${w ? `style="width:${w}"` : ''}>`;
  $('#cableList').innerHTML = `<table class="cables"><tr><th>${esc(T('cables.tag'))}</th><th>${esc(T('cables.type'))}</th><th>${esc(T('cables.length'))}</th><th></th></tr>`
    + tags.map(t => `<tr><td>${f(t, 'tag')}</td><td>${f(t, 'type')}</td><td>${f(t, 'length')}</td><td class="x"><button data-delcable="${esc(t)}" title="${esc(T('ui.delete'))}">✕</button></td></tr>
      <tr><td></td><td colspan="2" class="small">${f(t, 'from')} → ${f(t, 'to')}</td><td></td></tr>`).join('') + '</table>'
    + `<p class="muted small">${esc(T('cables.help'))}</p>`;
  for (const el of $$('#cableList input')) {
    if (el.dataset.k === 'tag') el.value = el.dataset.cable;
    if (el.dataset.k === 'from' || el.dataset.k === 'to') { el.placeholder = T(`cables.${el.dataset.k}`); el.style.width = '45%'; }
  }
}
$('#cableList').addEventListener('change', e => {
  const el = e.target, tag = el.dataset.cable, k = el.dataset.k; if (!tag) return;
  edit(() => {
    if (k === 'tag') {
      const nt = normTag(el.value);
      if (!nt || nt === tag || S.proj.cables[nt]) return;
      S.proj.cables[nt] = S.proj.cables[tag]; delete S.proj.cables[tag];
      for (const pg of S.proj.pages) { for (const w of pg.items.wires) if (w.props?.cable === tag) w.props.cable = nt; for (const s of pg.items.syms) if (BY_ID[s.sym]?.cable && s.tag === tag) s.tag = nt; }
    } else { if (el.value.trim()) S.proj.cables[tag][k] = el.value.trim(); else delete S.proj.cables[tag][k]; }
  });
});
$('#cableList').addEventListener('click', e => {
  const t = e.target.closest('[data-delcable]')?.dataset.delcable; if (!t) return;
  edit(() => { delete S.proj.cables[t]; });
});
$('#addCable').onclick = () => edit(() => {
  const nums = Object.keys(S.proj.cables).map(t => +t.match(/^-W(\d+)$/)?.[1]).filter(isFinite);
  S.proj.cables[`-W${nums.length ? Math.max(...nums) + 1 : 1}`] = {};
});

// ================================================================== properties panel
const inp = (k, v, attrs = '') => `<input data-k="${k}" value="${esc(v ?? '')}" ${attrs}>`;
const field = (label, html) => `<label><span>${esc(label)}</span>${html}</label>`;
const sel = (k, opts, v) => `<select data-k="${k}">${opts.map(([val, lbl]) => `<option value="${esc(val)}"${String(v ?? '') === String(val) ? ' selected' : ''}>${esc(lbl)}</option>`).join('')}</select>`;
const COLORS = ['BK', 'BN', 'BU', 'DBU', 'GY', 'OG', 'RD', 'VT', 'WH', 'GNYE'];

function renderProps() {
  const el = $('#pane-props'), pg = page();
  const active = document.activeElement?.closest('#pane-props') ? document.activeElement.dataset.k : null;
  let h = '<div class="props">';
  const ids = [...S.sel];
  const one = ids.length === 1 ? ids[0] : null;
  const s = one && pg.items.syms.find(x => x.id === one);
  const w = one && pg.items.wires.find(x => x.id === one);
  const t = one && pg.items.texts.find(x => x.id === one);
  const ln = one && (pg.items.lines.find(x => x.id === one) || pg.items.rects.find(x => x.id === one));

  if (s) {
    const sym = BY_ID[s.sym], dev = S.proj.devices[s.tag] || {};
    h += `<h3>${esc(symName(sym))}</h3><div data-scope="sym" data-id="${s.id}" class="props">`;
    if (!sym.noTag) h += field(sym.cable ? T('prop.cable') : sym.terminal ? T('prop.strip') : T('prop.tag'), inp('@tag', s.tag));
    if (sym.cable) {
      const c = S.proj.cables[s.tag] || {};
      h += field(T('cables.type'), `<input data-cablek="type" value="${esc(c.type || '')}">`) + field(T('cables.length'), `<input data-cablek="length" value="${esc(c.length || '')}">`);
    }
    for (const f of sym.local) h += field(T(`prop.${f}`), inp(`loc.${f}`, s.props?.[f]));
    for (const f of sym.fields) h += field(T(`prop.${f}`), inp(`dev.${f}`, dev[f]));
    h += field(T('prop.rotation'), sel('@rot', [0, 90, 180, 270].map(r => [r, `${r}°`]), s.rot || 0));
    const others = placements(S.proj, s.tag).filter(p => p.s !== s && p.page.kind !== 'report' && s.tag && !sym.terminal);
    if (others.length) h += `<div class="sub">${esc(T('prop.otherViews'))}</div><div class="links">${others.map(o => `<a data-goto="${o.page.id}|${o.s.id}">${esc(posOf(S.proj, o.page, o.s.x))} ${esc(symName(BY_ID[o.s.sym]))}</a>`).join('')}</div>`;
    if (s.tag && !sym.terminal && !sym.cable && !sym.noTag) h += `<button data-act="renameDevice">${esc(T('prop.renameDevice'))}</button>`;
    h += '</div>';
  } else if (w) {
    const cables = Object.keys(S.proj.cables);
    h += `<h3>${esc(T('prop.wire'))}</h3><div data-scope="wire" data-id="${w.id}" class="props">`;
    h += field(T('prop.wireNo'), inp('wire', w.props?.wire)) + field(T('prop.potential'), inp('potential', w.props?.potential));
    h += field(T('prop.size'), inp('size', w.props?.size, 'list="sizes" placeholder="2,5 mm²"')) + field(T('prop.color'), inp('color', w.props?.color, 'list="colors"'));
    h += field(T('prop.cable'), sel('cable', [['', '—'], ...cables.map(c => [c, `${c} ${S.proj.cables[c].type || ''}`])], w.props?.cable)) + field(T('prop.core'), inp('core', w.props?.core));
    h += `<datalist id="colors">${COLORS.map(c => `<option value="${c}">`).join('')}</datalist><datalist id="sizes">${['0,75 mm²', '1 mm²', '1,5 mm²', '2,5 mm²', '4 mm²', '6 mm²', '10 mm²', '16 mm²'].map(c => `<option value="${c}">`).join('')}</datalist>`;
    if (w.pts?.length) h += `<button data-act="resetRoute">${esc(T('prop.resetRoute'))}</button>`;
    h += '</div>';
  } else if (t) {
    h += `<h3>${esc(T('prop.text'))}</h3><div data-scope="text" data-id="${t.id}" class="props">`;
    h += field(T('prop.text'), inp('text', t.text)) + field(T('prop.size'), sel('size', [1.8, 2.5, 3.5, 5, 7].map(v => [v, `${v} mm`]), t.size));
    h += field(T('prop.bold'), sel('bold', [['', T('ui.no')], ['1', T('ui.yes')]], t.bold ? '1' : ''));
    h += field(T('prop.anchor'), sel('anchor', [['start', T('prop.left')], ['middle', T('prop.center')], ['end', T('prop.right')]], t.anchor || 'start'));
    h += '</div>';
  } else if (ln) {
    h += `<h3>${esc(T('x1' in ln ? 'prop.line' : 'prop.box'))}</h3><div data-scope="line" data-id="${ln.id}" class="props">`;
    h += field(T('prop.style'), sel('style', [['solid', T('prop.solid')], ['dash', T('prop.dash')], ['dashdot', T('prop.dashdot')]], ln.style || 'solid'));
    h += '</div>';
  } else if (ids.length > 1) {
    h += `<h3>${esc(T('prop.multi', { n: ids.length }))}</h3>`;
  } else {
    h += `<h3>${esc(T('prop.page'))} ${esc(pg.number)}</h3><div data-scope="page" class="props">`;
    h += field(T('prop.pageNo'), inp('number', pg.number)) + field(T('prop.pageTitle'), inp('title', pg.title));
    h += field(T('prop.paper'), sel('paper', [['', `${T('prop.inherit')} (${S.proj.meta.paper})`], ...Object.keys(PAPERS).map(p => [p, `${p} ${T('prop.landscape')}`])], pg.paper || ''));
    h += field(T('tbl.function'), inp('func', pg.func, `placeholder="${esc(S.proj.meta.func || '')}"`)) + field(T('tbl.location'), inp('loc', pg.loc, `placeholder="${esc(S.proj.meta.loc || '')}"`));
    h += field(T('tbl.date'), inp('date', pg.date, `type="date"`));
    if (pg.kind === 'report') h += `<div class="sub">${esc(T('prop.reportInfo'))}</div>`;
    h += `</div><hr><div class="kbd">${T('help.keys')}</div>`;
  }
  el.innerHTML = h + '</div>';
  if (active) { const a = el.querySelector(`[data-k="${CSS.escape(active)}"]`); if (a) a.focus(); }
}

$('#pane-props').addEventListener('change', e => {
  const el = e.target, scope = el.closest('[data-scope]'); if (!scope) return;
  const pg = page(), id = scope.dataset.id, k = el.dataset.k, v = el.value.trim();
  if (el.dataset.cablek) {
    const s = pg.items.syms.find(x => x.id === id);
    return edit(() => { S.proj.cables[s.tag] ||= {}; if (v) S.proj.cables[s.tag][el.dataset.cablek] = v; else delete S.proj.cables[s.tag][el.dataset.cablek]; });
  }
  if (!k) return;
  edit(() => {
    switch (scope.dataset.scope) {
      case 'sym': {
        const s = pg.items.syms.find(x => x.id === id), sym = BY_ID[s.sym];
        if (k === '@tag') {
          const nt = normTag(v); const old = s.tag;
          if (!nt || nt === old) return;
          const alone = placements(S.proj, old).length === 1;
          if (sym.cable) { S.proj.cables[nt] ||= alone ? (S.proj.cables[old] || {}) : {}; }
          else if (!S.proj.devices[nt]) S.proj.devices[nt] = alone ? (S.proj.devices[old] || {}) : clone(S.proj.devices[old] || {});
          if (alone && !sym.cable) delete S.proj.devices[old];
          s.tag = nt;
          if (sym.terminal) S.lastMain.X = nt;
          if (sym.role === 'main') S.lastMain[sym.letter] = nt;
        } else if (k === '@rot') s.rot = +v;
        else if (k.startsWith('loc.')) { const f = k.slice(4); if (v) s.props[f] = v; else delete s.props[f]; }
        else if (k.startsWith('dev.')) { const f = k.slice(4); S.proj.devices[s.tag] ||= {}; if (v) S.proj.devices[s.tag][f] = v; else delete S.proj.devices[s.tag][f]; }
        break;
      }
      case 'wire': { const w = pg.items.wires.find(x => x.id === id); w.props ||= {}; if (v) w.props[k] = v; else delete w.props[k]; break; }
      case 'text': { const t = pg.items.texts.find(x => x.id === id); if (k === 'size') t.size = +v; else if (k === 'bold') { if (v) t.bold = true; else delete t.bold; } else t[k] = el.value; break; }
      case 'line': { const l = pg.items.lines.find(x => x.id === id) || pg.items.rects.find(x => x.id === id); l.style = v; break; }
      case 'page': {
        if (k === 'paper') { if (v) pg.paper = v; else delete pg.paper; setTimeout(fit, 0); }
        else if (v) pg[k] = v; else if (k !== 'number') delete pg[k];
        break;
      }
    }
  });
});
$('#pane-props').addEventListener('click', async e => {
  const g = e.target.closest('[data-goto]');
  if (g) { const [pid, sid] = g.dataset.goto.split('|'); goPage(pid); selectOnly([sid]); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  const pg = page(), id = [...S.sel][0];
  if (act === 'resetRoute') edit(() => { delete pg.items.wires.find(w => w.id === id).pts; });
  if (act === 'renameDevice') {
    const s = pg.items.syms.find(x => x.id === id);
    const v = await promptDlg(T('prop.renameDevice'), s.tag);
    if (v && normTag(v) !== s.tag) runOps([{ op: 'set', page: pg.id, target: s.id, props: { tag: v } }]);
  }
});

// ================================================================== checks
let checkTimer;
function scheduleCheck() { clearTimeout(checkTimer); checkTimer = setTimeout(renderChecks, 250); }
function renderChecks() {
  S.issues = checkProject(S.proj);
  const bad = S.issues.filter(i => i.level === 'error').length, warn = S.issues.filter(i => i.level === 'warning').length;
  const b = $('#checkBadge'); b.textContent = bad || warn || ''; b.className = `badge${bad ? '' : ' warn'}`;
  $('#issues').innerHTML = S.issues.map((i, n) => `<li class="${i.level}" data-n="${n}">${i.pageNo ? `<span class="pg">${esc(T('check.page', { n: i.pageNo }))}</span>` : ''}${esc(T(i.key, i.args))}</li>`).join('') || `<li>${esc(T('check.ok'))}</li>`;
}
$('#issues').onclick = e => {
  const li = e.target.closest('li[data-n]'); if (!li) return;
  const i = S.issues[+li.dataset.n];
  if (i.page) { if (i.page !== S.pageId) goPage(i.page); if (i.id) selectOnly([i.id]); }
  else if (i.key === 'check.noLength') switchTab('left', 'cables');
};

// ================================================================== tabs
function switchTab(side, tab) {
  for (const b of $$(`#${side}Tabs button`)) b.classList.toggle('on', b.dataset.tab === tab);
  const panes = side === 'left' ? ['pages', 'symbols', 'devices', 'cables'] : ['props', 'check', 'ai'];
  for (const p of panes) $(`#pane-${p}`).hidden = p !== tab;
  if (tab === 'ai') loadModels();
}
for (const b of $$('#leftTabs button')) b.onclick = () => switchTab('left', b.dataset.tab);
for (const b of $$('#rightTabs button')) b.onclick = () => switchTab('right', b.dataset.tab);

// ================================================================== dialogs
function dialog(html, init) {
  const dlg = $('#dlg'), form = $('#dlgForm');
  form.innerHTML = html;
  init?.(form);
  return new Promise(resolve => {
    const done = v => { dlg.close(); form.onsubmit = null; resolve(v); };
    form.onsubmit = e => { e.preventDefault(); done(e.submitter?.value === 'cancel' ? null : new FormData(form)); };
    dlg.oncancel = () => done(null);
    dlg.showModal();
    form.querySelector('input:not([type=file]), select')?.focus();
  });
}
const actions = (ok = T('ui.ok')) => `<div class="dlg-actions"><button value="cancel" formnovalidate>${esc(T('ui.cancel'))}</button><button class="primary" value="ok">${esc(ok)}</button></div>`;
async function confirmDlg(msg) { return !!(await dialog(`<p>${esc(msg)}</p>${actions()}`)); }
async function promptDlg(title, value = '') { const f = await dialog(`<h2>${esc(title)}</h2><input name="v" value="${esc(value)}" required>${actions()}`); return f?.get('v')?.trim() || null; }

const langOpts = (v, follow = true) => (follow ? `<option value=""${!v ? ' selected' : ''}>${esc(T('proj.followUi'))}</option>` : '') + (S.info?.langs || []).map(l => `<option value="${esc(l.code)}"${l.code === v ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
const paperOpts = v => Object.keys(PAPERS).map(p => `<option value="${p}"${p === v ? ' selected' : ''}>${p} ${esc(T('prop.landscape'))}</option>`).join('');

$('#newProj').onclick = async () => {
  const f = await dialog(`<h2>${esc(T('proj.new'))}</h2><div class="grid2">
    <label class="wide">${esc(T('proj.name'))}<input name="name" required pattern="[\\w\\- ]+"></label>
    <label class="wide">${esc(T('tbl.project'))}<input name="title"></label>
    <label>${esc(T('prop.paper'))}<select name="paper">${paperOpts(S.info.config.paper)}</select></label>
    <label>${esc(T('proj.drawingLang'))}<select name="language">${langOpts('')}</select></label>
    </div>${actions(T('ui.create'))}`);
  if (!f) return;
  try {
    const p = await api('POST', '/api/projects', { name: f.get('name'), meta: { title: f.get('title') || f.get('name'), paper: f.get('paper'), language: f.get('language') } });
    await refreshList(); await openProject(p.name);
  } catch (e) { toast(e.message, true); }
};

$('#projSettings').onclick = async () => {
  if (!S.proj) return;
  const m = S.proj.meta;
  const tf = (k, label, type = 'text', wide = false) => `<label${wide ? ' class="wide"' : ''}>${esc(label)}<input name="${k}" type="${type}" value="${esc(m[k] || '')}"></label>`;
  let logo = m.logo || null;
  const f = await dialog(`<h2>${esc(T('ui.projectSettings'))}</h2><div class="grid2">
    ${tf('title', T('tbl.project'), 'text', true)}${tf('description', T('tbl.description'), 'text', true)}
    ${tf('customer', T('tbl.customer'))}${tf('drawingNo', T('tbl.drawingNo'))}
    ${tf('company', T('tbl.company'))}${tf('phone', T('proj.phone'))}
    ${tf('address', T('proj.address'), 'text', true)}
    ${tf('date', T('tbl.date'), 'date')}${tf('revision', T('tbl.revision'))}
    ${tf('drawnBy', T('tbl.drawnBy'))}${tf('approved', T('tbl.approved'))}
    ${tf('func', T('tbl.function'))}${tf('loc', T('tbl.location'))}
    <label>${esc(T('prop.paper'))}<select name="paper">${paperOpts(m.paper)}</select></label>
    <label>${esc(T('proj.drawingLang'))}<select name="language">${langOpts(m.language)}</select></label>
    <label>${esc(T('proj.template'))}<select name="template">${(S.info.templates || []).map(t => `<option value="${t.id}"${t.id === m.template ? ' selected' : ''}>${esc(T(`template.${t.id}`) !== `template.${t.id}` ? T(`template.${t.id}`) : t.name)}</option>`).join('')}</select></label>
    <div class="field">${esc(T('proj.logo'))}<div class="row"><img id="logoPrev" class="logo-prev" ${logo ? `src="${logo}"` : 'hidden'}><label class="as-button">${esc(T('proj.chooseLogo'))}<input type="file" id="logoIn" accept="image/*" hidden></label><button type="button" id="logoRm">${esc(T('ui.remove'))}</button></div></div>
    </div>${actions(T('ui.save'))}`, form => {
    form.querySelector('#logoIn').onchange = async ev => {
      const file = ev.target.files[0]; if (!file) return;
      logo = await imageToDataUrl(file, 600, 'image/png');
      const img = form.querySelector('#logoPrev'); img.src = logo; img.hidden = false;
    };
    form.querySelector('#logoRm').onclick = () => { logo = null; form.querySelector('#logoPrev').hidden = true; };
  });
  if (!f) return;
  edit(() => { for (const [k, v] of f.entries()) if (typeof v === 'string') S.proj.meta[k] = v; S.proj.meta.logo = logo; });
  await setDrawingLang(); renderAll(); refreshList(); fit();
};

function imageToDataUrl(file, max, type = 'image/png', quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL(type, quality)); URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

$('#projSel').onchange = e => openProject(e.target.value);
$('#langSel').onchange = e => setLang(e.target.value);

// ================================================================== reports & export
$('#reports').onclick = () => {
  edit(() => { generateReports(S.proj, { td: TD }); });
  const n = S.proj.pages.filter(p => p.kind === 'report').length;
  toast(T('reports.done', { n }));
};
$('#exportBtn').onclick = e => { e.stopPropagation(); $('#exportMenu').hidden = !$('#exportMenu').hidden; };
document.addEventListener('click', e => { if (!e.target.closest('.menu')) $('#exportMenu').hidden = true; });
$('#exportMenu').addEventListener('click', async e => {
  const kind = e.target.closest('[data-export]')?.dataset.export; if (!kind) return;
  $('#exportMenu').hidden = true;
  await save();
  if (kind === 'wdp') return download(new Blob([JSON.stringify(S.proj, null, 1)], { type: 'application/json' }), `${S.proj.name}.wdp.json`);
  const format = kind === 'pdf-page' ? 'pdf' : kind;
  const pages = kind === 'pdf-page' || kind === 'svg' ? page().number : '';
  toast(T('export.working', { f: format.toUpperCase() }), false, 2500);
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(S.proj.name)}/export?format=${format}${pages ? `&pages=${encodeURIComponent(pages)}` : ''}`);
    if (!r.ok) throw new Error((await r.json()).error);
    const name = (r.headers.get('content-disposition') || '').match(/filename="(.+?)"/)?.[1] || `${S.proj.name}.${format}`;
    download(await r.blob(), name);
    toast(T('export.saved', { path: decodeURIComponent(r.headers.get('x-saved-to') || name) }), false, 6000);
  } catch (err) { toast(err.message, true, 8000); }
});
$('#importFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const proj = JSON.parse(await file.text());
    const p = await api('POST', '/api/projects/import', { proj, name: proj.name });
    await refreshList(); await openProject(p.name); toast(T('export.imported', { name: p.name }));
  } catch (err) { toast(err.message, true); }
};
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ================================================================== AI
let modelsLoaded = false;
async function loadModels() {
  if (modelsLoaded) return;
  const st = $('#aiStatus');
  st.textContent = T('ai.connecting');
  try {
    const { models, defaults } = await api('GET', '/api/ai/models');
    const pick = (list, want) => list.find(m => m.name === want)?.name;
    const saved = (() => { try { return localStorage.getItem('wd.model'); } catch { return null; } })();
    $('#modelSel').innerHTML = models.map(m => `<option value="${esc(m.name)}">${esc(m.name)}${m.vision ? ' 👁' : ''}</option>`).join('');
    const chatModels = models.filter(m => !m.vision && !/embed/i.test(m.name));
    $('#modelSel').value = pick(models, saved) || pick(models, defaults.chat) || chatModels[0]?.name || models[0]?.name || '';
    const vis = models.filter(m => m.vision);
    S.visionModel = pick(vis, defaults.vision) || vis.find(m => /qwen2\.5vl/.test(m.name))?.name || vis[0]?.name;
    st.textContent = models.length ? T('ai.ready', { n: models.length }) : T('ai.noModels');
    modelsLoaded = true;
  } catch (e) { st.textContent = `${T('ai.unavailable')} ${e.message}`; }
}
$('#modelSel').onchange = e => { try { localStorage.setItem('wd.model', e.target.value); } catch { /* ignore */ } };
const chatHist = () => (S.chat[S.proj.name] ||= []);
function addMsg(cls, html) { const d = document.createElement('div'); d.className = `msg ${cls}`; d.innerHTML = html; $('#chatLog').append(d); d.scrollIntoView({ block: 'end' }); return d; }
const listHtml = (items, cls = '') => items.length ? `<ul class="${cls}">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

$('#chatForm').onsubmit = async e => {
  e.preventDefault();
  const msg = $('#chatIn').value.trim(); if (!msg || !S.proj) return;
  $('#chatIn').value = '';
  addMsg('user', esc(msg));
  const wait = addMsg('bot', esc(T('ai.thinking')));
  await save();
  try {
    const r = await api('POST', '/api/ai/chat', { project: S.proj.name, page: S.pageId, message: msg, history: chatHist(), model: $('#modelSel').value });
    chatHist().push({ role: 'user', content: msg }, { role: 'assistant', content: r.assistant });
    wait.innerHTML = esc(r.reply || T('ai.done')) + listHtml(r.log) + (r.errors.length ? `<div class="small">${esc(T('ai.failed'))}</div>${listHtml(r.errors)}` : '');
    if (r.log.length) { replaceProject(r.proj); if (r.page && r.page !== S.pageId) goPage(r.page); }
  } catch (err) { wait.className = 'msg err'; wait.textContent = err.message; }
};
$('#chatIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatForm').requestSubmit(); } });
$('#aiReview').onclick = async () => {
  if (!S.proj) return;
  await save();
  const wait = addMsg('bot', esc(T('ai.reviewing')));
  try { const r = await api('POST', '/api/ai/review', { project: S.proj.name, model: $('#modelSel').value, lang: T.locale }); wait.textContent = r.text; }
  catch (err) { wait.className = 'msg err'; wait.textContent = err.message; }
};
$('#imgIn').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file || !S.proj) return;
  if (!S.visionModel) { toast(T('ai.noVision'), true); return; }
  await save();
  const image = await imageToDataUrl(file, 1280, 'image/jpeg', 0.88);
  addMsg('user', `<img src="${image}" style="max-width:100%;border-radius:6px">`);
  const wait = addMsg('bot', esc(T('ai.reading', { model: S.visionModel })));
  try {
    const r = await api('POST', '/api/ai/vision', { project: S.proj.name, page: S.pageId, image, hint: $('#chatIn').value.trim(), model: S.visionModel });
    wait.innerHTML = esc(T('ai.visionResult', { c: r.found.components, w: r.found.connections })) + listHtml(r.log) + listHtml(r.errors);
    replaceProject(r.proj);
  } catch (err) { wait.className = 'msg err'; wait.textContent = err.message; }
};

// ================================================================== live updates
function listen() {
  const es = new EventSource('/api/events');
  es.onmessage = async ev => {
    const m = JSON.parse(ev.data);
    if (m.type === 'list') return refreshList();
    if (m.type === 'library') { if (m.origin !== CLIENT) reloadLibrary(); return; }
    if (m.type !== 'changed' || !S.proj || m.name !== S.proj.name || m.origin === CLIENT || m.rev <= S.proj.rev) return;
    if (S.dirty) { await save(); return; }
    const p = await api('GET', `/api/projects/${encodeURIComponent(m.name)}`);
    replaceProject(p);
    toast(T('status.external'));
  };
}

// ================================================================== start
(async function init() {
  S.info = await api('GET', '/api/info');
  try { registerSymbols((await api('GET', '/api/library')).symbols); } catch { /* no library */ }
  $('#langSel').innerHTML = S.info.langs.map(l => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('');
  await setLang(S.info.config.language || 'en', false);
  await refreshList();
  let start = null;
  try { start = localStorage.getItem('wd.project'); } catch { /* ignore */ }
  if (!S.list.some(p => p.name === start)) start = S.list[0]?.name;
  if (start) await openProject(start);
  else {
    const p = await api('POST', '/api/projects', { name: 'My-First-Project', meta: { title: 'My first project' } });
    await refreshList(); await openProject(p.name);
  }
  applyView(); listen();
  window.addEventListener('beforeunload', () => {
    if (S.dirty && S.proj) fetch(`/api/projects/${encodeURIComponent(S.proj.name)}`, { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json', 'x-client': CLIENT }, body: JSON.stringify(S.proj) });
  });
})();
