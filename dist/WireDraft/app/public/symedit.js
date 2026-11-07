// Symbol editor: draw a symbol with lines, boxes, circles, arcs, polylines and text, place pins,
// set its properties and save it to library/symbols/<id>.json.
import { normalizeSymbol, symbolDef, BY_ID, SYMBOLS, CATEGORIES } from '/core/symbols.js';
import { svgOf, esc, bbox } from '/core/geom.js';
import { loadImage, otsu, trace, toPrims } from '/trace.js';

const TOOLS = ['select', 'line', 'rect', 'circle', 'arc', 'poly', 'text', 'pin'];
const ICON = { select: '⬉', line: '╱', rect: '▭', circle: '◯', arc: '◠', poly: '⌇', text: 'T', pin: '⊙' };
const round = (v, g) => Math.round(v / g) * g;
const r3 = v => Math.round(v * 1000) / 1000;

// Clipboard shared by every editor opened in this window, so parts can be copied between symbols.
let CLIP = null;

/**
 * ctx: { T, api, toast, langs, base: symbol definition or null, editing: true when changing a library symbol,
 *        importImage: data URL to start from, imageMode: 'trace' (convert to lines) | 'background' (draw on top),
 *        onSaved(def), onDeleted(id) }
 */
export function openSymbolEditor(ctx) {
  const { T } = ctx;
  const blank = { id: '', name: '', names: {}, cat: 'custom', letter: 'A', fields: ['desc', 'part'], local: [], show: [], pins: [], prims: [] };
  const E = {
    def: structuredClone(ctx.base ? { ...blank, ...ctx.base, names: { ...(ctx.base.names || {}) } } : blank),
    tool: 'line', sel: new Set(), draft: null, view: { k: 14, x: 0, y: 0 }, undo: [], dash: false, fill: false, mouse: [0, 0], drag: null,
  };
  if (!ctx.editing && ctx.base) { E.def.id = `${ctx.base.id}_custom`.slice(0, 41); E.def.cat = 'custom'; }

  const dlg = document.createElement('dialog');
  dlg.className = 'symdlg';
  const langs = (ctx.langs || []).filter(l => l.code !== 'en');
  const cats = [...new Set([...CATEGORIES, ...SYMBOLS.map(s => s.cat)])];
  dlg.innerHTML = `
  <div class="se">
    <header class="se-head"><h2>${esc(T(ctx.editing ? 'symedit.editTitle' : 'symedit.newTitle'))}</h2>
      <span class="grow"></span>
      <label class="as-button" title="${esc(T('symedit.importHint'))}">${esc(T('symedit.import'))}<input type="file" accept="image/*" class="se-file" hidden></label>
      <label class="as-button" title="${esc(T('symedit.bgHint'))}">${esc(T('symedit.bgButton'))}<input type="file" accept="image/*" class="se-bgfile" hidden></label>
      <button data-a="undo" title="${esc(T('ui.undo'))}">↶</button>
      ${ctx.editing ? `<button data-a="delete">${esc(T('symedit.delete'))}</button>` : ''}
      <button data-a="close">${esc(T('ui.cancel'))}</button>
      <button data-a="save" class="primary">${esc(T('ui.save'))}</button>
    </header>
    <div class="se-body">
      <div class="se-tools">
        ${TOOLS.map(t => `<button data-tool="${t}" title="${esc(T(`symedit.tool.${t}`))}">${ICON[t]}</button>`).join('')}
        <hr><label class="se-chk" title="${esc(T('symedit.dash'))}"><input type="checkbox" data-opt="dash"> ┄</label>
        <label class="se-chk" title="${esc(T('symedit.fill'))}"><input type="checkbox" data-opt="fill"> ■</label>
        <hr>
        <button data-a="copy" title="${esc(T('symedit.copy'))} (Ctrl+C)">⧉</button>
        <button data-a="cut" title="${esc(T('symedit.cut'))} (Ctrl+X)">✂</button>
        <button data-a="paste" title="${esc(T('symedit.paste'))} (Ctrl+V)">📋</button>
        <button data-a="dup" title="${esc(T('symedit.duplicate'))} (Ctrl+D)">⧉+</button>
        <button data-a="selAll" title="${esc(T('symedit.selectAll'))} (Ctrl+A)">⬚</button>
        <label class="se-chk se-undertoggle" title="${esc(T('symedit.underlay'))}" hidden><input type="checkbox" data-underlay checked> 🖼</label>
      </div>
      <div class="se-canvas"><svg class="wd se-svg"><g class="se-vp"></g></svg><div class="se-hint"></div></div>
      <div class="se-side">
        <div class="grid2 se-meta">
          <label>${esc(T('symedit.id'))}<input data-m="id" value="${esc(E.def.id)}" ${ctx.editing ? 'readonly' : ''} placeholder="my_symbol"></label>
          <label>${esc(T('symedit.letter'))}<input data-m="letter" value="${esc(E.def.letter || '')}" placeholder="A"></label>
          <label class="wide">${esc(T('symedit.name'))} (English)<input data-m="name" value="${esc(E.def.name || '')}"></label>
          ${langs.map(l => `<label class="wide">${esc(T('symedit.name'))} (${esc(l.name)})<input data-name="${esc(l.code)}" value="${esc(E.def.names?.[l.code] || '')}"></label>`).join('')}
          <label>${esc(T('symedit.category'))}<input data-m="cat" list="se-cats" value="${esc(E.def.cat || 'custom')}"><datalist id="se-cats">${cats.map(c => `<option value="${esc(c)}">${esc(T(`cat.${c}`))}</option>`).join('')}</datalist></label>
          <label>${esc(T('symedit.role'))}<select data-m="role"><option value="">${esc(T('symedit.role.none'))}</option><option value="main"${E.def.role === 'main' ? ' selected' : ''}>${esc(T('symedit.role.main'))}</option><option value="aux"${E.def.role === 'aux' ? ' selected' : ''}>${esc(T('symedit.role.aux'))}</option></select></label>
          <label class="wide">${esc(T('symedit.fields'))}<input data-m="fields" value="${esc((E.def.fields || []).join(', '))}" placeholder="rating, desc, part"></label>
          <label>${esc(T('symedit.local'))}<input data-m="local" value="${esc((E.def.local || []).join(', '))}" placeholder="nums"></label>
          <label>${esc(T('symedit.show'))}<input data-m="show" value="${esc((E.def.show || []).join(', '))}" placeholder="rating"></label>
          <label class="se-chk wide"><input type="checkbox" data-m="noTag"${E.def.noTag ? ' checked' : ''}> ${esc(T('symedit.noTag'))}</label>
        </div>
        <div class="se-import" hidden></div>
        <div class="se-bg" hidden></div>
        <hr>
        <div class="se-size"></div>
        <hr>
        <div class="se-props"></div>
        <p class="muted small">${esc(T('symedit.help'))}</p>
      </div>
    </div>
  </div>`;
  document.body.append(dlg);
  const $ = s => dlg.querySelector(s);
  const svg = $('.se-svg'), vp = $('.se-vp');

  // ---------------------------------------------------------------- helpers
  const push = () => { E.undo.push(JSON.stringify(E.def)); if (E.undo.length > 60) E.undo.shift(); };
  const toMM = (e, g = 0.5) => {
    const r = svg.getBoundingClientRect();
    return [round((e.clientX - r.left - r.width / 2 - E.view.x) / E.view.k, g), round((e.clientY - r.top - r.height / 2 - E.view.y) / E.view.k, g)];
  };
  const opt = () => { const o = {}; if (E.dash) o.dash = '1.2 0.8'; if (E.fill) o.fill = true; return Object.keys(o).length ? o : undefined; };
  const nextPin = () => { let n = 1; while (E.def.pins.some(p => p.id === String(n))) n++; return String(n); };

  function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0;
    return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
  }
  function hit([x, y]) {
    let best = null, bd = 1.2;
    E.def.pins.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = `n${i}`; } });
    if (best) return best;
    E.def.prims.forEach((p, i) => {
      let d = Infinity;
      if (p[0] === 'l') d = distSeg(x, y, p[1], p[2], p[3], p[4]);
      else if (p[0] === 'r') { const [a, b, w, h] = p.slice(1, 5); d = Math.min(distSeg(x, y, a, b, a + w, b), distSeg(x, y, a + w, b, a + w, b + h), distSeg(x, y, a + w, b + h, a, b + h), distSeg(x, y, a, b + h, a, b)); }
      else if (p[0] === 'c' || p[0] === 'a') d = Math.abs(Math.hypot(x - p[1], y - p[2]) - p[3]);
      else if (p[0] === 'p') for (let k = 1; k < p[1].length + (p[2] ? 1 : 0); k++) { const a = p[1][k - 1], b = p[1][k % p[1].length]; d = Math.min(d, distSeg(x, y, a[0], a[1], b[0], b[1])); }
      else if (p[0] === 't') { const w = p[3].length * p[4] * 0.6, x0 = p[5] === 'end' ? p[1] - w : p[5] === 'middle' ? p[1] - w / 2 : p[1]; d = x >= x0 - 0.5 && x <= x0 + w + 0.5 && y <= p[2] + 0.5 && y >= p[2] - p[4] - 0.5 ? 0 : Infinity; }
      if (d < bd) { bd = d; best = `p${i}`; }
    });
    return best;
  }
  /**
   * Traced or freehand lines rarely end exactly on the 2 mm pin grid. If a line end is near the click,
   * put the pin on the grid point next to it and move the line end there (a vertical or horizontal
   * lead stays straight), so wires meet the symbol cleanly.
   */
  function snapPinToLineEnd([x, y]) {
    let best = null, bd = 2.5;
    E.def.prims.forEach(p => {
      const ends = p[0] === 'l' ? [[1, 2, 3, 4], [3, 4, 1, 2]] : p[0] === 'p' && !p[2] ? [['first'], ['last']] : [];
      for (const e of ends) {
        const pt = p[0] === 'l' ? [p[e[0]], p[e[1]]] : e[0] === 'first' ? p[1][0] : p[1].at(-1);
        const d = Math.hypot(pt[0] - x, pt[1] - y);
        if (d < bd) { bd = d; best = { p, e, pt }; }
      }
    });
    if (!best) return null;
    const g = [round(best.pt[0], 2), round(best.pt[1], 2)], { p, e } = best;
    if (p[0] === 'l') {
      const [ix, iy, ox, oy] = e;
      const vertical = Math.abs(p[ix] - p[ox]) < 0.6, horizontal = Math.abs(p[iy] - p[oy]) < 0.6;
      const far = [p[ox], p[oy]];
      if (vertical) p[ox] = g[0];        // keep a vertical lead vertical
      if (horizontal) p[oy] = g[1];      // keep a horizontal lead horizontal
      p[ix] = g[0]; p[iy] = g[1];
      // the trace may split one straight lead into several segments (e.g. where another line crosses):
      // shift the whole straight run so it stays in line
      if (vertical) shiftRun(far, 0, g[0] - far[0], p);
      if (horizontal) shiftRun(far, 1, g[1] - far[1], p);
    } else {
      const pts = p[1], i = e[0] === 'first' ? 0 : pts.length - 1, j = e[0] === 'first' ? 1 : pts.length - 2;
      if (pts[j] && Math.abs(pts[i][0] - pts[j][0]) < 0.6) pts[j][0] = g[0];
      if (pts[j] && Math.abs(pts[i][1] - pts[j][1]) < 0.6) pts[j][1] = g[1];
      pts[i] = g;
    }
    return g;
  }

  /** Move straight line segments chained from point `from` along axis 0 (x, vertical run) or 1 (y, horizontal run). */
  function shiftRun(from, axis, delta, skip) {
    if (!delta) return;
    const near = (a, b) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
    let open = [from];
    const done = new Set([skip]);
    while (open.length) {
      const pt = open.pop();
      for (const q of E.def.prims) {
        if (q[0] !== 'l' || done.has(q)) continue;
        const a = [q[1], q[2]], b = [q[3], q[4]];
        const straight = Math.abs(a[axis] - b[axis]) < 0.6;
        if (!straight || !(near(a, pt) || near(b, pt))) continue;
        done.add(q);
        open.push(near(a, pt) ? b : a);
        q[1 + axis] = r3(q[1 + axis] + delta); q[3 + axis] = r3(q[3 + axis] + delta);
      }
    }
  }

  // ---------------------------------------------------------------- selection (keys: p<i> = drawing element, n<i> = pin)
  const single = () => (E.sel.size === 1 ? [...E.sel][0] : null);
  const hasPins = () => [...E.sel].some(k => k[0] === 'n');
  function movePrim(p, dx, dy) {
    if (p[0] === 'l') { p[1] = r3(p[1] + dx); p[2] = r3(p[2] + dy); p[3] = r3(p[3] + dx); p[4] = r3(p[4] + dy); }
    else if (p[0] === 'p') p[1] = p[1].map(([a, b]) => [r3(a + dx), r3(b + dy)]);
    else { p[1] = r3(p[1] + dx); p[2] = r3(p[2] + dy); }
  }
  function moveSel(dx, dy) {
    for (const k of E.sel) {
      const i = +k.slice(1);
      if (k[0] === 'n') { const p = E.def.pins[i]; p.x = r3(p.x + dx); p.y = r3(p.y + dy); }
      else movePrim(E.def.prims[i], dx, dy);
    }
  }
  /** Everything whose extent lies completely inside the rectangle. */
  function inBox([x0, y0], [x1, y1]) {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const keys = [];
    E.def.prims.forEach((p, i) => { const b = bbox([p]); if (b.x >= ax && b.y >= ay && b.x + b.w <= bx && b.y + b.h <= by) keys.push(`p${i}`); });
    E.def.pins.forEach((p, i) => { if (p.x >= ax && p.x <= bx && p.y >= ay && p.y <= by) keys.push(`n${i}`); });
    return keys;
  }
  function deleteSel() {
    if (!E.sel.size) return;
    push();
    const pr = new Set(), pn = new Set();
    for (const k of E.sel) (k[0] === 'n' ? pn : pr).add(+k.slice(1));
    E.def.prims = E.def.prims.filter((_, i) => !pr.has(i));
    E.def.pins = E.def.pins.filter((_, i) => !pn.has(i));
    E.sel = new Set(); render();
  }
  function copySel() {
    if (!E.sel.size) return false;
    const keys = [...E.sel];
    CLIP = { prims: structuredClone(keys.filter(k => k[0] === 'p').map(k => E.def.prims[+k.slice(1)])), pins: structuredClone(keys.filter(k => k[0] === 'n').map(k => E.def.pins[+k.slice(1)])), n: 0 };
    ctx.toast(T('symedit.copied', { n: keys.length }), false, 1800);
    return true;
  }
  function paste() {
    if (!CLIP || (!CLIP.prims.length && !CLIP.pins.length)) { ctx.toast(T('symedit.clipEmpty'), true); return; }
    push();
    CLIP.n++;
    const d = 2 * CLIP.n, fresh = new Set();          // 2 mm steps keep pasted pins on the pin grid
    for (const p0 of CLIP.prims) { const p = structuredClone(p0); movePrim(p, d, d); E.def.prims.push(p); fresh.add(`p${E.def.prims.length - 1}`); }
    for (const p0 of CLIP.pins) {
      const id = E.def.pins.some(p => p.id === p0.id) ? nextPin() : p0.id;
      E.def.pins.push({ id, x: r3(p0.x + d), y: r3(p0.y + d) }); fresh.add(`n${E.def.pins.length - 1}`);
    }
    E.sel = fresh; E.tool = 'select'; render();
  }
  function selectAll() {
    E.sel = new Set([...E.def.prims.map((_, i) => `p${i}`), ...E.def.pins.map((_, i) => `n${i}`)]);
    E.tool = 'select'; render();
  }

  // ---------------------------------------------------------------- drawing
  function draft() {
    const d = E.draft, [mx, my] = E.mouse;
    if (!d) return [];
    const [x0, y0] = d.pts[0];
    switch (E.tool) {
      case 'line': return [['l', x0, y0, mx, my, opt()]];
      case 'rect': return [['r', Math.min(x0, mx), Math.min(y0, my), Math.abs(mx - x0), Math.abs(my - y0), opt()]];
      case 'circle': return [['c', x0, y0, Math.hypot(mx - x0, my - y0), opt()]];
      case 'arc': {
        const r = d.pts[1] ? Math.hypot(d.pts[1][0] - x0, d.pts[1][1] - y0) : Math.hypot(mx - x0, my - y0);
        if (!d.pts[1]) return [['c', x0, y0, r, { dash: '0.5 0.5' }]];
        const a0 = Math.atan2(d.pts[1][1] - y0, d.pts[1][0] - x0) * 180 / Math.PI, a1 = Math.atan2(my - y0, mx - x0) * 180 / Math.PI;
        return [['a', x0, y0, r, a0, a1]];
      }
      case 'poly': return [['p', [...d.pts, [mx, my]], false, opt()]];
      default: return [];
    }
  }
  // props=false redraws only the canvas, so typing in the side panel is never interrupted
  function render(props = true) {
    const r = svg.getBoundingClientRect(), k = E.view.k;
    const W = r.width / k, H = r.height / k, cx = -E.view.x / k, cy = -E.view.y / k;
    let grid = '';
    for (let x = Math.floor((cx - W / 2) / 1); x <= cx + W / 2; x++) grid += `<line x1="${x}" y1="${cy - H / 2}" x2="${x}" y2="${cy + H / 2}" class="${x % 4 ? 'g1' : 'g4'}"/>`;
    for (let y = Math.floor((cy - H / 2) / 1); y <= cy + H / 2; y++) grid += `<line x1="${cx - W / 2}" y1="${y}" x2="${cx + W / 2}" y2="${y}" class="${y % 4 ? 'g1' : 'g4'}"/>`;
    const axes = `<line x1="${cx - W / 2}" y1="0" x2="${cx + W / 2}" y2="0" class="ax"/><line x1="0" y1="${cy - H / 2}" x2="0" y2="${cy + H / 2}" class="ax"/>`;
    const prims = E.def.prims.map((p, i) => `<g class="${E.sel.has(`p${i}`) ? 'se-sel' : ''}">${svgOf([p])}</g>`).join('');
    const pins = E.def.pins.map((p, i) => `<g class="se-pin${E.sel.has(`n${i}`) ? ' se-sel' : ''}"><circle cx="${p.x}" cy="${p.y}" r="0.8"/><text x="${p.x + 1.1}" y="${p.y - 0.9}" font-size="1.6">${esc(p.id)}</text></g>`).join('');
    vp.setAttribute('transform', `translate(${r.width / 2 + E.view.x} ${r.height / 2 + E.view.y}) scale(${k})`);
    const u = E.under && E.showUnder ? `<image href="${E.under.src}" x="${E.under.x}" y="${E.under.y}" width="${E.under.w}" height="${E.under.h}" opacity="${E.bgOpacity ?? 0.28}" preserveAspectRatio="none"/>` : '';
    const preview = E.img?.prims ? `<g class="se-draft">${svgOf(E.img.prims)}</g>` : '';
    vp.innerHTML = `<g class="se-grid">${grid}${axes}</g>${u}<g class="se-ink">${prims}<g class="se-draft">${svgOf(draft())}</g>${preview}</g>${pins}${marquee()}`;
    for (const b of dlg.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === E.tool);
    const ut = $('.se-undertoggle'); ut.hidden = !E.under; ut.querySelector('input').checked = !!E.showUnder;
    $('.se-hint').textContent = `${T(`symedit.hint.${E.tool}`)}   (${E.mouse[0]}, ${E.mouse[1]}) mm`;
    if (props) { renderProps(); renderSize(); renderBackground(); }
  }

  function marquee() {
    const b = E.drag?.box; if (!b) return '';
    const [x0, y0] = b, [x1, y1] = E.mouseFine || E.mouse;
    return `<rect class="marquee" x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" style="stroke-width:${1.2 / E.view.k}"/>`;
  }
  function renderProps() {
    const el = $('.se-props');
    if (!E.sel.size) { el.innerHTML = `<div class="muted small">${esc(T('symedit.nothing', { p: E.def.prims.length, n: E.def.pins.length }))}</div>`; return; }
    if (E.sel.size > 1) {
      el.innerHTML = `<h3>${esc(T('symedit.multi', { n: E.sel.size }))}</h3>
        <div class="row"><button data-a="copy">${esc(T('symedit.copy'))}</button><button data-a="cut">${esc(T('symedit.cut'))}</button><button data-a="dup">${esc(T('symedit.duplicate'))}</button><button data-a="delSel">${esc(T('ui.delete'))}</button></div>
        <p class="muted small">${esc(T('symedit.multiHelp'))}</p>`;
      return;
    }
    const key = single(), i = +key.slice(1);
    const f = (k, label, v, type = 'number') => `<label>${esc(label)}<input data-p="${k}" type="${type}" step="0.5" value="${esc(v)}"></label>`;
    if (key[0] === 'n') {
      const p = E.def.pins[i];
      el.innerHTML = `<h3>${esc(T('symedit.tool.pin'))}</h3><div class="grid2">${f('id', T('symedit.pinName'), p.id, 'text')}<span></span>${f('x', 'x', p.x)}${f('y', 'y', p.y)}</div>`;
      return;
    }
    const p = E.def.prims[i], o = p[0] === 't' ? p[6] : p[0] === 'p' ? p[3] : p.at(-1);
    const names = { l: ['x1', 'y1', 'x2', 'y2'], r: ['x', 'y', 'w', 'h'], c: ['cx', 'cy', 'r'], a: ['cx', 'cy', 'r', '°1', '°2'] }[p[0]];
    let h = `<h3>${esc(T(`symedit.kind.${p[0]}`))}</h3><div class="grid2">`;
    if (names) names.forEach((n, k) => { h += f(String(k + 1), n, p[k + 1]); });
    if (p[0] === 't') h += f('3', T('prop.text'), p[3], 'text') + f('4', T('prop.size'), p[4]) + `<label>${esc(T('prop.anchor'))}<select data-p="5">${['start', 'middle', 'end'].map(a => `<option${p[5] === a ? ' selected' : ''}>${a}</option>`).join('')}</select></label>`;
    if (p[0] === 'p') h += `<label class="se-chk"><input type="checkbox" data-p="closed"${p[2] ? ' checked' : ''}> ${esc(T('symedit.closed'))}</label>`;
    if (p[0] !== 't') h += `<label class="se-chk"><input type="checkbox" data-p="dash"${o && typeof o === 'object' && o.dash ? ' checked' : ''}> ${esc(T('symedit.dash'))}</label>`;
    if (p[0] === 'c' || p[0] === 'p' || p[0] === 'r') h += `<label class="se-chk"><input type="checkbox" data-p="fill"${o && typeof o === 'object' && o.fill ? ' checked' : ''}> ${esc(T('symedit.fill'))}</label>`;
    el.innerHTML = h + '</div>';
  }

  // ---------------------------------------------------------------- events
  dlg.addEventListener('click', e => {
    const t = e.target.closest('[data-tool]');
    if (t) { E.tool = t.dataset.tool; E.draft = null; render(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    if (a === 'undo' && E.undo.length) { E.def = JSON.parse(E.undo.pop()); E.sel = new Set(); render(); }
    if (a === 'copy') copySel();
    if (a === 'cut' && copySel()) deleteSel();
    if (a === 'paste') paste();
    if (a === 'dup' && copySel()) paste();
    if (a === 'delSel') deleteSel();
    if (a === 'selAll') selectAll();
    if (a === 'save') save();
    if (a === 'centre') centre();
    if (a === 'bgRemove') { E.under = null; E.bg = false; renderBackground(); render(); }
    if (a === 'impApply') finishImport(true);
    if (a === 'impAdd') finishImport(false);
    if (a === 'impCancel') { E.img = null; renderImport(); render(false); }
    if (a === 'delete') remove();
  });
  dlg.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.opt) { E[el.dataset.opt] = el.checked; return; }
    if ('underlay' in el.dataset) { E.showUnder = el.checked; render(false); return; }
    if (el.dataset.m) {
      const k = el.dataset.m;
      E.def[k] = el.type === 'checkbox' ? el.checked : ['fields', 'local', 'show'].includes(k) ? el.value.split(',').map(s => s.trim()).filter(Boolean) : el.value.trim();
      return;
    }
    if (el.dataset.name) { E.def.names ||= {}; if (el.value.trim()) E.def.names[el.dataset.name] = el.value.trim(); else delete E.def.names[el.dataset.name]; return; }
    if (el.dataset.p && single()) {
      push();
      const key = single(), i = +key.slice(1), k = el.dataset.p;
      if (key[0] === 'n') { const p = E.def.pins[i]; p[k] = k === 'id' ? el.value.trim() : r3(+el.value); }
      else {
        const p = E.def.prims[i], oi = p[0] === 't' ? 6 : p[0] === 'p' ? 3 : { l: 5, r: 5, c: 4, a: 6 }[p[0]];
        if (k === 'dash' || k === 'fill') { const o = { ...(p[oi] || {}) }; if (el.checked) o[k] = k === 'dash' ? '1.2 0.8' : true; else delete o[k]; p[oi] = Object.keys(o).length ? o : undefined; }
        else if (k === 'closed') p[2] = el.checked;
        else if (p[0] === 't' && (k === '3' || k === '5')) p[+k] = el.value;
        else p[+k] = r3(+el.value);
      }
      render();
    }
  });

  svg.addEventListener('pointermove', e => {
    E.mouse = toMM(e, E.tool === 'pin' ? 2 : 0.5);
    E.mouseFine = toMM(e, 0.01);
    if (E.drag?.pan) { E.view.x = E.drag.vx + e.clientX - E.drag.cx; E.view.y = E.drag.vy + e.clientY - E.drag.cy; }
    else if (E.drag?.box) { render(false); return; }
    else if (E.drag) {
      const g = hasPins() ? 2 : 0.5, p = toMM(e, g);
      const dx = p[0] - E.drag.last[0], dy = p[1] - E.drag.last[1];
      if (dx || dy) { if (!E.drag.moved) push(); E.drag.moved = true; moveSel(dx, dy); E.drag.last = p; render(); return; }
    }
    render(false);
  });
  svg.addEventListener('pointerdown', e => {
    // leave any side-panel field (commits it), so Delete/arrow keys act on the drawing
    if (document.activeElement?.closest('.se-side')) document.activeElement.blur();
    svg.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2) { E.drag = { pan: true, cx: e.clientX, cy: e.clientY, vx: E.view.x, vy: E.view.y }; return; }
    const p = toMM(e, E.tool === 'pin' ? 2 : 0.5);
    const d = E.draft;
    const add = prim => { push(); E.def.prims.push(prim); E.draft = null; };
    switch (E.tool) {
      case 'select': {
        const k = hit(toMM(e, 0.01));
        if (!k) {                                   // empty space: start a selection box
          if (!e.shiftKey) E.sel = new Set();
          E.drag = { box: toMM(e, 0.01), add: e.shiftKey };
          break;
        }
        if (e.shiftKey) { E.sel.has(k) ? E.sel.delete(k) : E.sel.add(k); break; }
        if (!E.sel.has(k)) E.sel = new Set([k]);
        E.drag = { last: toMM(e, hasPins() ? 2 : 0.5), moved: false };
        break;
      }
      case 'line': if (!d) E.draft = { pts: [p] }; else if (p[0] !== d.pts[0][0] || p[1] !== d.pts[0][1]) add(['l', ...d.pts[0], ...p, opt()]); break;
      case 'rect': if (!d) E.draft = { pts: [p] }; else { const [x0, y0] = d.pts[0]; if (p[0] !== x0 && p[1] !== y0) add(['r', Math.min(x0, p[0]), Math.min(y0, p[1]), Math.abs(p[0] - x0), Math.abs(p[1] - y0), opt()]); } break;
      case 'circle': if (!d) E.draft = { pts: [p] }; else { const r = r3(Math.hypot(p[0] - d.pts[0][0], p[1] - d.pts[0][1])); if (r) add(['c', ...d.pts[0], r, opt()]); } break;
      case 'arc':
        if (!d) E.draft = { pts: [p] };
        else if (!d.pts[1]) d.pts.push(p);
        else {
          const [cx, cy] = d.pts[0], [sx, sy] = d.pts[1];
          const r = r3(Math.hypot(sx - cx, sy - cy)), a0 = Math.round(Math.atan2(sy - cy, sx - cx) * 180 / Math.PI), a1 = Math.round(Math.atan2(p[1] - cy, p[0] - cx) * 180 / Math.PI);
          if (r && a0 !== a1) add(['a', cx, cy, r, a0, a1, opt()]);
        }
        break;
      case 'poly':
        if (!d) E.draft = { pts: [p] };
        else if (e.detail === 2) { if (d.pts.length > 1) add(['p', d.pts, !!E.fill, opt()]); }
        else d.pts.push(p);
        break;
      case 'text': push(); E.def.prims.push(['t', ...p, 'Text', 2, 'middle']); E.sel = new Set([`p${E.def.prims.length - 1}`]); E.tool = 'select'; setTimeout(() => { const f = $('[data-p="3"]'); f?.focus(); f?.select(); }, 20); break;
      case 'pin': {
        push();
        const at = snapPinToLineEnd(toMM(e, 0.01)) || p;
        E.def.pins.push({ id: nextPin(), x: at[0], y: at[1] }); E.sel = new Set([`n${E.def.pins.length - 1}`]); break;
      }
    }
    render();
  });
  svg.addEventListener('pointerup', e => {
    const d = E.drag; E.drag = null;
    if (d?.box) {
      const end = toMM(e, 0.01);
      if (Math.abs(end[0] - d.box[0]) > 0.3 || Math.abs(end[1] - d.box[1]) > 0.3)
        for (const k of inBox(d.box, end)) E.sel.add(k);
      render();
    }
  });
  svg.addEventListener('contextmenu', e => e.preventDefault());
  svg.addEventListener('wheel', e => { e.preventDefault(); E.view.k = Math.min(60, Math.max(4, E.view.k * Math.exp(-e.deltaY * 0.0015))); render(); }, { passive: false });
  dlg.addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea')) return;
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod && key === 'c') { e.preventDefault(); copySel(); return; }
    if (mod && key === 'x') { e.preventDefault(); if (copySel()) deleteSel(); return; }
    if (mod && key === 'v') { e.preventDefault(); paste(); return; }
    if (mod && key === 'd') { e.preventDefault(); if (copySel()) paste(); return; }
    if (mod && key === 'a') { e.preventDefault(); selectAll(); return; }
    if (e.key === 'Escape') { e.preventDefault(); if (E.draft) { if (E.tool === 'poly' && E.draft.pts.length > 1) { push(); E.def.prims.push(['p', E.draft.pts, !!E.fill, opt()]); } E.draft = null; } else E.sel = new Set(); render(); }
    else if (e.key === 'Enter' && E.tool === 'poly' && E.draft?.pts.length > 1) { push(); E.def.prims.push(['p', E.draft.pts, !!E.fill, opt()]); E.draft = null; render(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && E.sel.size) deleteSel();
    else if (e.key.startsWith('Arrow') && E.sel.size) {
      e.preventDefault(); push(); const g = hasPins() ? 2 : 0.5;
      moveSel(e.key === 'ArrowLeft' ? -g : e.key === 'ArrowRight' ? g : 0, e.key === 'ArrowUp' ? -g : e.key === 'ArrowDown' ? g : 0); render();
    } else if (mod && key === 'z' && E.undo.length) { E.def = JSON.parse(E.undo.pop()); E.sel = new Set(); render(); }
  });
  dlg.addEventListener('cancel', e => { e.preventDefault(); if (E.draft || E.sel.size) { E.draft = null; E.sel = new Set(); render(); } else close(); });

  // ---------------------------------------------------------------- size: scale, resize, centre
  E.lock = true;
  const box = () => bbox(E.def.prims);
  function transformAll(fx, fy, sr = 1, ss = 1) {
    for (const p of E.def.prims) {
      if (p[0] === 'l') { [p[1], p[2]] = [fx(p[1]), fy(p[2])]; [p[3], p[4]] = [fx(p[3]), fy(p[4])]; }
      else if (p[0] === 'r') { const x2 = fx(p[1] + p[3]), y2 = fy(p[2] + p[4]); p[1] = fx(p[1]); p[2] = fy(p[2]); p[3] = r3(x2 - p[1]); p[4] = r3(y2 - p[2]); }
      else if (p[0] === 'c' || p[0] === 'a') { p[1] = fx(p[1]); p[2] = fy(p[2]); p[3] = r3(Math.max(0.1, p[3] * sr)); }
      else if (p[0] === 'p') p[1] = p[1].map(([x, y]) => [fx(x), fy(y)]);
      else if (p[0] === 't') { p[1] = fx(p[1]); p[2] = fy(p[2]); p[4] = r3(Math.max(0.8, p[4] * ss)); }
    }
    for (const p of E.def.pins) { p.x = round(fx(p.x), 2); p.y = round(fy(p.y), 2); }   // pins stay on the 2 mm grid
    if (E.under) {
      const x2 = fx(E.under.x + E.under.w), y2 = fy(E.under.y + E.under.h);
      E.under.x = fx(E.under.x); E.under.y = fy(E.under.y); E.under.w = x2 - E.under.x; E.under.h = y2 - E.under.y;
    }
  }
  function scale(sx, sy) {
    if (!E.def.prims.length || !(sx > 0) || !(sy > 0)) return;
    push();
    transformAll(x => r3(x * sx), y => r3(y * sy), (sx + sy) / 2, sy);
    render();
  }
  function centre() {
    const b = box(); if (!b.w && !b.h) return;
    const dx = -round(b.x + b.w / 2, 0.5), dy = -round(b.y + b.h / 2, 0.5);
    if (!dx && !dy) return;
    push(); transformAll(x => r3(x + dx), y => r3(y + dy)); render();
  }
  function renderSize() {
    const el = $('.se-size'), b = box();
    const v = n => Math.round(n * 10) / 10;
    el.innerHTML = `<h3>${esc(T('symedit.size'))}: ${v(b.w)} × ${v(b.h)} mm</h3>
      <div class="grid2">
        <label>${esc(T('symedit.width'))}<input type="number" step="0.5" min="1" data-size="w" value="${v(b.w)}"></label>
        <label>${esc(T('symedit.height'))}<input type="number" step="0.5" min="1" data-size="h" value="${v(b.h)}"></label>
        <label>${esc(T('symedit.scale'))}<input type="number" step="5" min="5" data-size="pct" value="100"></label>
        <label class="se-chk"><input type="checkbox" data-size="lock"${E.lock ? ' checked' : ''}> ${esc(T('symedit.keepRatio'))}</label>
      </div>
      <div class="row"><button data-a="centre">${esc(T('symedit.centre'))}</button></div>`;
  }
  dlg.addEventListener('change', e => {
    const k = e.target.dataset.size; if (!k) return;
    e.stopPropagation();
    const b = box(), val = +e.target.value;
    if (k === 'lock') { E.lock = e.target.checked; return; }
    if (k === 'pct' && val > 0) scale(val / 100, val / 100);
    if (k === 'w' && b.w && val > 0) { const f = val / b.w; scale(f, E.lock ? f : 1); }
    if (k === 'h' && b.h && val > 0) { const f = val / b.h; scale(E.lock ? f : 1, f); }
  }, true);

  // ---------------------------------------------------------------- image → symbol
  async function startImport(src) {
    try { E.img = { image: await loadImage(src), opts: { mode: 'centerline', detail: 1.2, widthMM: 16, invert: false, fill: false } }; }
    catch (err) { ctx.toast(err.message, true); return; }
    E.img.opts.threshold = otsu(E.img.image.gray);
    E.showUnder = true;
    renderImport(); retrace();
  }
  function retrace() {
    if (!E.img) return;
    const o = E.img.opts, res = trace(E.img.image, o), out = toPrims(res, o);
    E.img.prims = out.prims;
    // underlay: the whole image, placed so the traced part lines up with the preview
    const k = out.px2mm, [cx, cy] = out.center;
    E.under = { src: E.img.image.src, x: -cx * k, y: -cy * k, w: E.img.image.w * k, h: E.img.image.h * k };
    const info = $('.se-imp-info'); if (info) info.textContent = T('symedit.traced', { n: out.prims.length, w: out.box.w, h: out.box.h });
    render(false);
  }
  function renderImport() {
    const el = $('.se-import'), o = E.img?.opts;
    el.hidden = !E.img;
    if (!E.img) return;
    const sel = (v, opts) => opts.map(([val, key]) => `<option value="${val}"${v === val ? ' selected' : ''}>${esc(T(key))}</option>`).join('');
    el.innerHTML = `<h3>${esc(T('symedit.importTitle'))}</h3>
      <div class="grid2">
        <label class="wide">${esc(T('symedit.mode'))}<select data-imp="mode">${sel(o.mode, [['centerline', 'symedit.mode.centerline'], ['outline', 'symedit.mode.outline'], ['background', 'symedit.mode.background']])}</select></label>
        <label>${esc(T('symedit.width'))}<input type="number" step="1" min="2" max="200" data-imp="widthMM" value="${o.widthMM}"></label>
        <label>${esc(T('symedit.detail'))}<input type="range" min="0.4" max="4" step="0.2" data-imp="detail" value="${o.detail}"></label>
        <label class="wide">${esc(T('symedit.threshold'))}<input type="range" min="10" max="245" step="1" data-imp="threshold" value="${o.threshold}"></label>
        <label class="se-chk"><input type="checkbox" data-imp="invert"${o.invert ? ' checked' : ''}> ${esc(T('symedit.invert'))}</label>
        <label class="se-chk"><input type="checkbox" data-imp="fill"${o.fill ? ' checked' : ''}> ${esc(T('symedit.fill'))}</label>
        <label class="se-chk wide"><input type="checkbox" data-imp="under"${E.showUnder ? ' checked' : ''}> ${esc(T('symedit.underlay'))}</label>
      </div>
      <div class="muted small se-imp-info"></div>
      <div class="row"><button class="primary" data-a="impApply">${esc(T(E.def.prims.length ? 'symedit.replace' : 'symedit.apply'))}</button>${E.def.prims.length ? `<button data-a="impAdd">${esc(T('symedit.add'))}</button>` : ''}<button data-a="impCancel">${esc(T('ui.cancel'))}</button></div>`;
  }
  dlg.addEventListener('input', e => {
    const k = e.target.dataset.imp; if (!k || !E.img) return;
    if (k === 'under') { E.showUnder = e.target.checked; render(false); return; }
    if (k === 'mode' && e.target.value === 'background') { const src = E.img.image.src; E.img = null; renderImport(); startBackground(src, E.under?.w); return; }
    E.img.opts[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.tagName === 'SELECT' ? e.target.value : +e.target.value;
    clearTimeout(E.img.timer); E.img.timer = setTimeout(retrace, 120);
  });
  function finishImport(replace) {
    if (!E.img?.prims?.length) { ctx.toast(T('symedit.nothingTraced'), true); return; }
    push();
    E.def.prims = replace ? E.img.prims : [...E.def.prims, ...E.img.prims];
    E.img = null; renderImport();
    E.tool = 'pin'; E.sel = new Set();
    render();
    ctx.toast(T('symedit.placePins'), false, 6000);
  }
  $('.se-file').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const rd = new FileReader(); rd.onload = () => startImport(rd.result); rd.readAsDataURL(f);
  });

  // ---------------------------------------------------------------- background image (draw by hand on top)
  // The picture is only a guide: it lives in E.under and is never written into the symbol.
  function startBackground(src, widthMM) {
    const img = new Image();
    img.onload = () => {
      const w = widthMM || 24, h = w * img.height / img.width;
      E.under = { src, x: -w / 2, y: -h / 2, w, h, ratio: img.height / img.width };
      E.showUnder = true; E.bgOpacity ??= 0.35; E.bg = true;
      E.img = null; renderImport(); renderBackground();
      E.tool = 'line'; render();
      ctx.toast(T('symedit.bgStarted'), false, 6000);
    };
    img.onerror = () => ctx.toast(T('symedit.bgError'), true);
    img.src = src;
  }
  function renderBackground() {
    const el = $('.se-bg');
    el.hidden = !(E.bg && E.under);
    if (el.hidden) return;
    const u = E.under, v = n => Math.round(n * 10) / 10;
    el.innerHTML = `<h3>${esc(T('symedit.bgTitle'))}</h3>
      <div class="grid2">
        <label>${esc(T('symedit.width'))}<input type="number" step="1" min="2" max="300" data-bg="w" value="${v(u.w)}"></label>
        <label>${esc(T('symedit.bgOpacity'))}<input type="range" min="0.1" max="0.9" step="0.05" data-bg="opacity" value="${E.bgOpacity}"></label>
        <label>${esc(T('symedit.bgOffsetX'))}<input type="number" step="0.5" data-bg="x" value="${v(u.x + u.w / 2)}"></label>
        <label>${esc(T('symedit.bgOffsetY'))}<input type="number" step="0.5" data-bg="y" value="${v(u.y + u.h / 2)}"></label>
        <label class="se-chk wide"><input type="checkbox" data-underlay ${E.showUnder ? 'checked' : ''}> ${esc(T('symedit.underlay'))}</label>
      </div>
      <p class="muted small">${esc(T('symedit.bgNote'))}</p>
      <div class="row"><button data-a="bgRemove">${esc(T('symedit.bgRemove'))}</button></div>`;
  }
  dlg.addEventListener('input', e => {
    const k = e.target.dataset.bg; if (!k || !E.under) return;
    const u = E.under, val = +e.target.value, cx = u.x + u.w / 2, cy = u.y + u.h / 2;
    if (k === 'opacity') E.bgOpacity = val;
    if (k === 'w' && val > 0) { u.w = val; u.h = val * (u.ratio || u.h / u.w); u.x = cx - u.w / 2; u.y = cy - u.h / 2; }
    if (k === 'x' && Number.isFinite(val)) u.x = val - u.w / 2;
    if (k === 'y' && Number.isFinite(val)) u.y = val - u.h / 2;
    render(false);
  });
  $('.se-bgfile').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const rd = new FileReader(); rd.onload = () => startBackground(rd.result); rd.readAsDataURL(f);
  });

  // ---------------------------------------------------------------- save / delete
  async function save() {
    for (const el of dlg.querySelectorAll('[data-m], [data-name]')) el.dispatchEvent(new Event('change', { bubbles: true }));
    let def;
    try { def = symbolDef(normalizeSymbol({ ...E.def, role: E.def.role || undefined })); }
    catch (err) { ctx.toast(err.message, true, 6000); return; }
    if (!ctx.editing && BY_ID[def.id]?.custom && !confirm(T('symedit.overwrite', { id: def.id }))) return;
    try { const saved = await ctx.api('PUT', `/api/library/symbols/${def.id}`, def); ctx.onSaved(saved); ctx.toast(T('symedit.saved', { id: def.id }) + (E.under ? ` ${T('symedit.bgDropped')}` : '')); close(); }
    catch (err) { ctx.toast(err.message, true, 6000); }
  }
  async function remove() {
    if (!confirm(T('symedit.confirmDelete', { id: E.def.id }))) return;
    try { await ctx.api('DELETE', `/api/library/symbols/${E.def.id}`); ctx.onDeleted(E.def.id); close(); }
    catch (err) { ctx.toast(err.message, true); }
  }
  function close() { dlg.close(); dlg.remove(); }

  dlg.showModal();
  requestAnimationFrame(render);
  if (ctx.importImage && ctx.imageMode === 'background') startBackground(ctx.importImage);
  else if (ctx.importImage) startImport(ctx.importImage);
  E.tool = ctx.base ? 'select' : 'line';
}
