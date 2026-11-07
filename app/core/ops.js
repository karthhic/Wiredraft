// Operation engine: every edit from the AI and MCP (and many UI actions) is a JSON op.
// applyOps never mutates its input; it returns { proj, log, errors, created }.

import { BY_ID, SYMBOLS } from './symbols.js';
import { PAPERS, addPage, clone, dims, getPage, itemIds, nextTag, normTag, resolvePin, snap, uid } from './model.js';
import { frameGeom } from './frames.js';
import { normRot } from './geom.js';
import { MACROS, MACROS_HELP } from './macros.js';

export const OPS_HELP = `Operations (JSON objects in an "ops" array). "page" is a page number or id; it defaults to the current page.
{"op":"add","sym":"mcb_3p","tag":"-F1","x":100,"y":80,"props":{"rating":"C16A"}}   tag/x/y optional (auto tag, auto place)
{"op":"connect","from":"-F1:2","to":"-K1:1","props":{"size":"2,5 mm²","color":"BK","wire":"101"}}
{"op":"connect","pins":["-S1:14","-K1:A1"]}          chain of pins
{"op":"add","sym":"xref","x":200,"y":30,"rot":180,"props":{"name":"L+"}}   interruption point (rot 180 at the top, rot 0 at the bottom)
{"op":"connect","from":"L+","to":"-S0:11"}            interruption points are referenced by their name
{"op":"set","target":"-F1","props":{"rating":"C10A"}} device (tag), symbol id, or wire id; props.tag renames a device
{"op":"move","target":"s3","x":120,"y":60,"rot":90}
{"op":"remove","target":"-F1"}                         removes the device's symbols on the page (and their wires), or a wire id
{"op":"add_text","x":20,"y":30,"text":"SUPPLY 400VAC","size":3}
{"op":"add_line","x1":10,"y1":150,"x2":400,"y2":150,"style":"dashdot"}
{"op":"add_page","number":"3","title":"24VDC supply"}   becomes the current page for following ops
{"op":"set_page","page":"3","title":"...","paper":"A3"}
{"op":"add_cable","tag":"-W1","type":"3x1,5mm²","length":"12","from":"-X1","to":"-M1"}
{"op":"set_cable","tag":"-W1","length":"14"}
{"op":"set_project","title":"...","customer":"..."}
{"op":"macro","name":"dol_starter","x":60,"y":60,"params":{"motor":"-M1","contactor":"-K1","protection":"-Q1","power":"4 kW"}}
Macros (PREFER these for standard circuits; they are always wired correctly):
${MACROS_HELP}
Pins: TAG:PIN, e.g. -F1:2, -K1:A1, -X1:1 (several terminals share a strip tag; use the symbol id like s7.1 to be exact).
Coordinates are millimetres on the sheet, origin top-left; omit x/y to auto-place.`;

const OP_ALIASES = {
  add: 'add', add_symbol: 'add', place: 'add', add_component: 'add', add_device: 'add',
  connect: 'connect', wire: 'connect', add_wire: 'connect',
  set: 'set', update: 'set', set_props: 'set', set_properties: 'set', rename: 'set',
  move: 'move', rotate: 'rotate', remove: 'remove', delete: 'remove',
  add_text: 'add_text', text: 'add_text', add_line: 'add_line', line: 'add_line', add_rect: 'add_rect',
  add_page: 'add_page', new_page: 'add_page', set_page: 'set_page', remove_page: 'remove_page',
  add_cable: 'add_cable', set_cable: 'set_cable', remove_cable: 'remove_cable',
  set_project: 'set_project', meta: 'set_project', macro: 'macro', add_macro: 'macro',
};

const norm = s => String(s ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
const isNum = v => v !== null && v !== '' && Number.isFinite(+v);

export function resolveSym(t) {
  const k = norm(t);
  if (BY_ID[k]) return k;
  const s = SYMBOLS.find(s => norm(s.name) === k);
  return s?.id || null;
}

function mergeProps(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null || v === '') delete target[k];
    else if (typeof v !== 'object') target[k] = String(v);
  }
}

/** Split props into device-level and placement-local according to the symbol. */
function splitProps(sym, props) {
  const dev = {}, loc = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'tag') continue;
    if (sym.local.includes(k) || sym.noTag || k === 'showTag') loc[k] = v; else dev[k] = v;
  }
  return { dev, loc };
}

function findTargets(page, target) {
  const id = String(target ?? '');
  const byId = page.items.syms.filter(s => s.id === id);
  if (byId.length) return byId;
  const tag = normTag(id);
  return page.items.syms.filter(s => s.tag === tag);
}

export function autoPlace(proj, page, s) {
  const paper = page.paper || proj.meta.paper;
  const g = frameGeom(PAPERS[paper] ? paper : 'A3');
  const others = page.items.syms.filter(o => o !== s);
  const d = dims(proj, s);
  const free = (x, y) => others.every(o => { const e = dims(proj, o); return Math.abs(o.x - x) >= (e.w + d.w) / 2 + 12 || Math.abs(o.y - y) >= (e.h + d.h) / 2 + 10; });
  for (let y = g.draw.y + 24; y < g.draw.y + g.draw.h - 12; y += 32)
    for (let x = g.draw.x + 24; x < g.draw.x + g.draw.w - 16; x += 24)
      if (free(x, y)) { s.x = snap(x); s.y = snap(y); return; }
  s.x = snap(g.draw.x + 24); s.y = snap(g.draw.y + 24);
}

function run(proj, o, st) {
  const op = OP_ALIASES[norm(o.op ?? o.action)];
  const pageOf = () => {
    const p = o.page != null ? getPage(proj, o.page) : st.page;
    if (!p) throw new Error(o.page != null ? `no page "${o.page}"` : 'no current page');
    return p;
  };

  switch (op) {
    case 'add': {
      const page = pageOf();
      const id = resolveSym(o.sym ?? o.symbol ?? o.type);
      // models sometimes "add" a macro as if it were a symbol
      if (!id && MACROS[norm(o.sym ?? o.symbol ?? o.type)]) return run(proj, { op: 'macro', name: norm(o.sym ?? o.symbol ?? o.type), x: o.x, y: o.y, page: o.page, params: { ...(o.props || {}), ...(o.params || {}), ...(o.tag ? { strip: o.tag, contactor: o.tag } : {}) } }, st);
      if (!id) throw new Error(`unknown symbol "${o.sym ?? o.type}"`);
      const sym = BY_ID[id];
      const props = { ...(o.props || {}) };
      for (const f of [...sym.fields, ...sym.local]) if (o[f] != null && props[f] == null) props[f] = o[f];
      let tag = '';
      if (!sym.noTag) {
        // tolerate decorated tags from models ("-K1_seal_in", "-K1 (contact)") by keeping the IEC part
        const raw = normTag(o.tag ?? props.tag);
        const m = raw.match(/^([-=+][A-Za-z]+\d+(?:\.\d+)?)[_\s(]/);
        tag = (m ? m[1] : raw) || nextTag(proj, sym.letter || 'A');
      }
      const { dev, loc } = splitProps(sym, props);
      const s = { id: uid('s', itemIds(page)), sym: id, tag, x: 0, y: 0, rot: normRot(o.rot ?? 0), props: {} };
      mergeProps(s.props, loc);
      if (tag) { proj.devices[tag] ||= {}; mergeProps(proj.devices[tag], dev); }
      page.items.syms.push(s);
      const g = frameGeom(PAPERS[page.paper || proj.meta.paper] ? (page.paper || proj.meta.paper) : 'A3').draw;
      const inside = isNum(o.x) && isNum(o.y) && +o.x > g.x + 4 && +o.x < g.x + g.w - 4 && +o.y > g.y + 4 && +o.y < g.y + g.h - 4;
      if (inside) { s.x = snap(+o.x); s.y = snap(+o.y); } else autoPlace(proj, page, s);
      st.created.push(s.id);
      return `added ${tag || id} (${sym.name}) as ${s.id} at ${s.x},${s.y} on page ${page.number}`;
    }

    case 'connect': {
      const page = pageOf();
      const chain = Array.isArray(o.pins) ? o.pins : [o.from ?? o.a, o.to ?? o.b];
      if (chain.length < 2 || chain.some(x => x == null)) throw new Error('connect needs "from" and "to"');
      const msgs = [];
      for (let i = 0; i < chain.length - 1; i++) {
        const a = resolvePin(proj, page, chain[i]), b = resolvePin(proj, page, chain[i + 1]);
        if (a.s === b.s && a.p === b.p) throw new Error('cannot connect a pin to itself');
        const same = (x, y) => x.s === y.s && x.p === y.p;
        if (page.items.wires.some(w => (same(w.a, a) && same(w.b, b)) || (same(w.a, b) && same(w.b, a)))) { msgs.push(`${chain[i]}–${chain[i + 1]} already connected`); continue; }
        const w = { id: uid('w', itemIds(page)), a, b, props: {} };
        mergeProps(w.props, { ...(o.props || {}), ...(o.wire ? { wire: o.wire } : {}), ...(o.size ? { size: o.size } : {}), ...(o.color ? { color: o.color } : {}) });
        page.items.wires.push(w);
        msgs.push(`${w.id}: ${chain[i]} → ${chain[i + 1]}`);
      }
      return msgs.join('; ');
    }

    case 'set': {
      const page = pageOf();
      const target = String(o.target ?? o.ref ?? o.id ?? o.tag ?? '');
      const w = page.items.wires.find(w => w.id === target);
      if (w) { w.props ||= {}; mergeProps(w.props, o.props); if (o.pts === null) delete w.pts; return `updated wire ${w.id}`; }
      const syms = findTargets(page, target);
      const tag = syms[0]?.tag || (proj.devices[normTag(target)] ? normTag(target) : '');
      if (!syms.length && !tag) throw new Error(`nothing called "${target}" on page ${page.number}`);
      const props = { ...(o.props || {}) };
      const newTag = props.tag != null ? normTag(props.tag) : null;
      delete props.tag;
      for (const s of syms) { const { loc } = splitProps(BY_ID[s.sym], props); mergeProps(s.props, loc); }
      const sym = syms[0] ? BY_ID[syms[0].sym] : { local: [], fields: [] };
      const { dev } = splitProps(sym, props);
      if (tag) { proj.devices[tag] ||= {}; mergeProps(proj.devices[tag], dev); }
      if (newTag && tag && newTag !== tag) {
        if (proj.devices[newTag] && proj.pages.some(p => p.items.syms.some(s => s.tag === newTag))) throw new Error(`tag ${newTag} already used`);
        proj.devices[newTag] = { ...proj.devices[tag], ...(proj.devices[newTag] || {}) };
        delete proj.devices[tag];
        for (const p of proj.pages) for (const s of p.items.syms) if (s.tag === tag) s.tag = newTag;
        return `renamed ${tag} → ${newTag}`;
      }
      if (newTag && syms.length && !tag) { for (const s of syms) s.tag = newTag; proj.devices[newTag] ||= {}; }
      return `updated ${tag || target}`;
    }

    case 'move': case 'rotate': {
      const page = pageOf();
      const syms = findTargets(page, o.target ?? o.ref ?? o.id);
      if (!syms.length) throw new Error(`nothing called "${o.target}" on page ${page.number}`);
      const s = syms[0];
      if (op === 'rotate') s.rot = normRot((s.rot || 0) + (isNum(o.angle) ? +o.angle : 90));
      if (isNum(o.x)) s.x = snap(+o.x);
      if (isNum(o.y)) s.y = snap(+o.y);
      if (isNum(o.dx)) s.x = snap(s.x + +o.dx);
      if (isNum(o.dy)) s.y = snap(s.y + +o.dy);
      if (o.rot != null && op === 'move') s.rot = normRot(o.rot);
      return `moved ${s.tag || s.id} to ${s.x},${s.y} rot ${s.rot}`;
    }

    case 'remove': {
      const page = pageOf();
      const target = String(o.target ?? o.ref ?? o.id ?? '');
      for (const kind of ['wires', 'texts', 'lines', 'rects']) {
        const i = page.items[kind].findIndex(x => x.id === target);
        if (i >= 0) { page.items[kind].splice(i, 1); return `removed ${target}`; }
      }
      const syms = findTargets(page, target);
      if (!syms.length) throw new Error(`nothing called "${target}" on page ${page.number}`);
      const ids = new Set(syms.map(s => s.id));
      page.items.syms = page.items.syms.filter(s => !ids.has(s.id));
      page.items.wires = page.items.wires.filter(w => !ids.has(w.a.s) && !ids.has(w.b.s));
      return `removed ${syms.length} symbol(s) ${target}`;
    }

    case 'macro': {
      const page = pageOf();
      const mac = MACROS[norm(o.name ?? o.macro)];
      if (!mac) throw new Error(`unknown macro "${o.name}" (macros: ${Object.keys(MACROS).join(', ')})`);
      const g = frameGeom(PAPERS[page.paper || proj.meta.paper] ? (page.paper || proj.meta.paper) : 'A3').draw;
      const x = isNum(o.x) ? snap(Math.min(Math.max(+o.x, g.x + 24), g.x + g.w - 40)) : snap(g.x + 40);
      const top = mac.h > 40 ? 40 : 8, y = isNum(o.y) ? snap(Math.min(Math.max(+o.y, g.y + top), g.y + g.h - (mac.h ?? 140))) : snap(g.y + 44);
      const ids = {}, sub = { ...st, page, created: [] };
      for (const step of mac.build({ ...(o.params || {}), ...o }, x, y)) {
        if (step.op) { run(proj, step.op, sub); if (step.key) ids[step.key] = sub.created.at(-1); }
        else if (step.wire) { const w = step.wire(ids); run(proj, { op: 'connect', from: w.from, to: w.to, props: w.props }, sub); }
      }
      st.created.push(...sub.created);
      return `macro ${o.name}: ${sub.created.length} symbols at ${x},${y} on page ${page.number}`;
    }

    case 'add_text': {
      const page = pageOf();
      const t = { id: uid('t', itemIds(page)), x: +o.x || 20, y: +o.y || 20, text: String(o.text ?? ''), size: +o.size || 2.5 };
      if (o.bold) t.bold = true;
      page.items.texts.push(t);
      return `added text ${t.id}`;
    }
    case 'add_line': {
      const page = pageOf();
      const l = { id: uid('l', itemIds(page)), x1: +o.x1, y1: +o.y1, x2: +o.x2, y2: +o.y2, style: o.style || 'solid' };
      if (![l.x1, l.y1, l.x2, l.y2].every(isFinite)) throw new Error('add_line needs x1, y1, x2, y2');
      page.items.lines.push(l);
      return `added line ${l.id}`;
    }
    case 'add_rect': {
      const page = pageOf();
      const r = { id: uid('r', itemIds(page)), x: +o.x, y: +o.y, w: +o.w, h: +o.h, style: o.style || 'dash' };
      page.items.rects.push(r);
      return `added box ${r.id}`;
    }

    case 'add_page': {
      const page = addPage(proj, { number: o.number, title: o.title || '', kind: o.kind || 'schematic', after: o.after, paper: o.paper });
      st.page = page;
      return `added page ${page.number} "${page.title}"`;
    }
    case 'set_page': {
      const page = pageOf();
      for (const k of ['title', 'number', 'func', 'loc', 'date']) if (o[k] != null) page[k] = String(o[k]);
      if (o.paper != null) { if (o.paper && !PAPERS[o.paper]) throw new Error('paper must be A4, A3 or A2'); if (o.paper) page.paper = o.paper; else delete page.paper; }
      return `updated page ${page.number}`;
    }
    case 'remove_page': {
      const page = pageOf();
      if (proj.pages.length < 2) throw new Error('a project needs at least one page');
      proj.pages = proj.pages.filter(p => p !== page);
      if (st.page === page) st.page = proj.pages[0];
      return `removed page ${page.number}`;
    }

    case 'add_cable': case 'set_cable': {
      const tag = normTag(o.tag);
      if (!tag) throw new Error('cable needs a tag');
      if (op === 'add_cable' && proj.cables[tag]) throw new Error(`cable ${tag} exists`);
      proj.cables[tag] ||= {};
      mergeProps(proj.cables[tag], Object.fromEntries(['type', 'length', 'from', 'to', 'desc'].filter(k => o[k] !== undefined).map(k => [k, o[k]])));
      return `${op === 'add_cable' ? 'added' : 'updated'} cable ${tag}`;
    }
    case 'remove_cable': {
      const tag = normTag(o.tag);
      delete proj.cables[tag];
      return `removed cable ${tag}`;
    }

    case 'set_project': {
      const keys = ['title', 'description', 'customer', 'company', 'address', 'phone', 'drawingNo', 'paper', 'language', 'func', 'loc', 'template', 'date', 'drawnBy', 'approved', 'revision'];
      for (const k of keys) if (o[k] !== undefined) proj.meta[k] = String(o[k]);
      if (o.paper && !PAPERS[o.paper]) throw new Error('paper must be A4, A3 or A2');
      return 'updated project settings';
    }

    default:
      throw new Error(`unknown op "${o.op ?? o.action}"`);
  }
}

export function applyOps(proj0, ops, { page } = {}) {
  const proj = clone(proj0);
  const st = { page: getPage(proj, page) || proj.pages.find(p => p.kind === 'schematic') || proj.pages[0], alias: {}, created: [] };
  const log = [], errors = [];
  (Array.isArray(ops) ? ops : [ops]).forEach((o, i) => {
    try { const m = run(proj, o || {}, st); if (m) log.push(m); }
    catch (e) { errors.push(`op ${i + 1} (${o?.op ?? '?'}): ${e.message}`); }
  });
  return { proj, log, errors, created: st.created, page: st.page?.id };
}
