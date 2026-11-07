import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, resolvePin, getPage } from '../app/core/model.js';
import { applyOps } from '../app/core/ops.js';
import { crossRefs } from '../app/core/xref.js';
import { checkProject } from '../app/core/check.js';
import { terminalRows, cableRows, generateReports } from '../app/core/reports.js';
import { standaloneSVG, wirePoints } from '../app/core/render.js';
import { makeT, langReport } from '../app/core/i18n.js';
import { pageDxf } from '../app/node/dxf.js';
import { zip } from '../app/node/zip.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerSymbols, normalizeSymbol, BY_ID, unregisterSymbol } from '../app/core/symbols.js';

const build = ops => { const r = applyOps(newProject('t'), ops, { page: '2' }); assert.deepEqual(r.errors, []); return r.proj; };

test('ops: add, connect, rename, remove', () => {
  let p = build([
    { op: 'add', sym: 'mcb_1p', tag: '-F1', x: 60, y: 60, props: { rating: 'C10A' } },
    { op: 'add', sym: 'coil', tag: '-K1', x: 60, y: 100 },
    { op: 'connect', from: '-F1:2', to: '-K1:A1', props: { wire: '1' } },
  ]);
  assert.equal(p.devices['-F1'].rating, 'C10A');
  assert.equal(getPage(p, '2').items.wires.length, 1);
  p = applyOps(p, [{ op: 'set', target: '-F1', props: { tag: '-F7' } }], { page: '2' }).proj;
  assert.ok(p.devices['-F7'] && !p.devices['-F1']);
  p = applyOps(p, [{ op: 'remove', target: '-F7' }], { page: '2' }).proj;
  assert.equal(getPage(p, '2').items.wires.length, 0);
});

test('ops: model mistakes are absorbed (decorated tags, off-sheet coordinates)', () => {
  const p = build([{ op: 'add', sym: 'coil', tag: '-K1', x: 60, y: 60 }, { op: 'add', sym: 'contact_no', tag: '-K1_seal_in', x: 999, y: 60 }]);
  const s = getPage(p, '2').items.syms;
  assert.equal(s[1].tag, '-K1');
  assert.ok(s[1].x < 420);
});

test('pins resolve by tag, symbol id and interruption-point name', () => {
  const p = build([{ op: 'add', sym: 'xref', x: 60, y: 30, props: { name: 'L+' } }, { op: 'add', sym: 'pb_no', tag: '-S1', x: 60, y: 60 }]);
  const pg = getPage(p, '2');
  assert.deepEqual(resolvePin(p, pg, 'L+'), { s: pg.items.syms[0].id, p: '1' });
  assert.equal(resolvePin(p, pg, '-S1:13').p, '13');
  assert.throws(() => resolvePin(p, pg, '-S1:99'), /no pin/);
});

test('macros produce correctly wired circuits', () => {
  const p = build([{ op: 'macro', name: 'dol_starter', x: 60, y: 60 }, { op: 'macro', name: 'start_stop', x: 200, y: 40, params: { lamp: '-H1' } }]);
  const pg = getPage(p, '2');
  const id = (tag, sym) => pg.items.syms.find(s => s.tag === tag && s.sym === sym).id;
  const has = (a, b) => pg.items.wires.some(w => (w.a.s === a.s && w.a.p === a.p && w.b.s === b.s && w.b.p === b.p) || (w.a.s === b.s && w.a.p === b.p && w.b.s === a.s && w.b.p === a.p));
  for (const [o, i] of [['2', '1'], ['4', '3'], ['6', '5']]) assert.ok(has({ s: id('-Q1', 'mpcb_3p'), p: o }, { s: id('-K1', 'main_contacts_3p'), p: i }));
  const errors = checkProject(p).filter(i => i.level === 'error');
  assert.deepEqual(errors, []);
});

test('cross-references: interruption points and coil/contact', () => {
  const p = build([
    { op: 'add', sym: 'coil', tag: '-K1', x: 60, y: 100 },
    { op: 'add', sym: 'contact_no', tag: '-K1', x: 300, y: 100, props: { nums: '13-14' } },
    { op: 'add', sym: 'xref', x: 60, y: 30, props: { name: 'L1' } },
    { op: 'add_page', title: 'p3' },
    { op: 'add', sym: 'xref', x: 100, y: 30, props: { name: 'L1' } },
  ]);
  const x = crossRefs(p), pg2 = getPage(p, '2'), pg3 = getPage(p, '3');
  assert.deepEqual(x.get(`${pg2.id}/${pg2.items.syms[1].id}`), ['/2.1']);
  assert.match(x.get(`${pg2.id}/${pg2.items.syms[0].id}`)[0], /13-14 \/2\.7/);
  assert.deepEqual(x.get(`${pg3.id}/${pg3.items.syms[0].id}`), ['→ 2.1']);
});

test('reports: terminal diagram targets and cable list totals', () => {
  const p = build([
    { op: 'add', sym: 'mcb_1p', tag: '-F1', x: 60, y: 60 },
    { op: 'add', sym: 'terminal', tag: '-X1', x: 60, y: 100, props: { term: '1' } },
    { op: 'add', sym: 'lamp', tag: '-H1', x: 60, y: 140 },
    { op: 'connect', from: '-F1:2', to: '-X1:1' },
    { op: 'connect', from: '-X1:2', to: '-H1:X1', props: { cable: '-W1', core: '1' } },
    { op: 'add_cable', tag: '-W1', type: '3G1,5mm²', length: '7,5' },
  ]);
  const [row] = terminalRows(p, '-X1');
  assert.equal(row.inside, '-F1:2');
  assert.equal(row.outside, '-H1:X1');
  assert.equal(row.cable, '-W1');
  assert.deepEqual(cableRows(p).totals, [['3G1,5mm²', 7.5]]);
  generateReports(p);
  assert.ok(p.pages.some(pg => pg.report?.type === 'terminal') && p.pages.some(pg => pg.report?.type === 'cable'));
});

test('render: straight wire between aligned pins, valid SVG', () => {
  const p = build([{ op: 'add', sym: 'mcb_3p', tag: '-F1', x: 60, y: 60 }, { op: 'add', sym: 'main_contacts_3p', tag: '-K1', x: 60, y: 100 }, { op: 'connect', from: '-F1:2', to: '-K1:1' }]);
  const pg = getPage(p, '2');
  assert.equal(wirePoints(p, pg, pg.items.wires[0]).length, 2);
  const svg = standaloneSVG(p, pg);
  assert.match(svg, /^<svg[^>]+viewBox="0 0 420 297"/);
});

test('DXF export is well formed', () => {
  const p = build([{ op: 'add', sym: 'motor3', tag: '-M1', x: 60, y: 60 }]);
  const d = pageDxf(p, getPage(p, '2'));
  assert.match(d, /AC1009/);
  assert.match(d, /0\r\nEOF\r\n$/);
  assert.equal((d.match(/\r\nSECTION\r\n/g) || []).length, 3);
  assert.ok(zip([{ name: 'a.dxf', data: d }]).readUInt32LE(0) === 0x04034b50);
});

test('i18n: plurals, placeholders, fallback; Finnish file is complete', () => {
  const en = JSON.parse(fs.readFileSync(new URL('../lang/en.json', import.meta.url))).strings;
  const fi = JSON.parse(fs.readFileSync(new URL('../lang/fi.json', import.meta.url))).strings;
  const t = makeT(fi, en, 'fi');
  assert.equal(t('reports.done', { n: 1 }), '1 raporttisivu luotu');
  assert.equal(t('reports.done', { n: 3 }), '3 raporttisivua luotu');
  assert.equal(makeT({}, en)('check.openPins', { tag: '-F1', pins: '1' }), '-F1: pins 1 not connected');
  assert.deepEqual(langReport(en, fi).missing, []);
});

test('custom symbols: validate, register, place, embed in the project file', async () => {
  assert.throws(() => normalizeSymbol({ id: 'mcb_1p', prims: [['l', 0, 0, 1, 1]] }), /built-in/);
  assert.throws(() => normalizeSymbol({ id: 'x_sym', prims: [] }), /at least one/);
  assert.throws(() => normalizeSymbol({ id: 'x_sym', prims: [['l', 0, 0, 1, 1]], pins: [{ id: '1', x: 0, y: 0 }, { id: '1', x: 0, y: 4 }] }), /twice/);
  const def = JSON.parse(fs.readFileSync(new URL('../library/symbols/cabinet_fan.json', import.meta.url)));
  assert.deepEqual(registerSymbols([def]).errors, []);
  assert.equal(BY_ID.cabinet_fan.w, 12);
  const p = build([{ op: 'add', sym: 'cabinet_fan', tag: '-M5', x: 60, y: 60, props: { power: '40 W' } }, { op: 'add', sym: 'mcb_1p', tag: '-F1', x: 56, y: 24 }, { op: 'connect', from: '-F1:2', to: '-M5:L' }]);
  assert.match(standaloneSVG(p, getPage(p, '2')), /40 W/);
  process.env.WIREDRAFT_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-'));
  const store = await import('../app/node/store.js');
  store.save({ ...p, name: 'Fan' });
  const pj = JSON.parse(fs.readFileSync(path.join(process.env.WIREDRAFT_PROJECTS, 'Fan.wdp', 'project.json')));
  assert.deepEqual(pj.symbols.map(s => s.id), ['cabinet_fan']);
  unregisterSymbol('cabinet_fan');
  store.load('Fan');                       // a PC without the library gets the symbol from the project
  assert.ok(BY_ID.cabinet_fan);
});

test('image tracing: thick strokes become a straight line and a circle', async () => {
  const { trace, toPrims } = await import('../app/public/trace.js');
  const w = 200, h = 260, gray = new Uint8Array(w * h).fill(240);
  for (let y = 10; y < 100; y++) for (let x = 96; x < 104; x++) gray[y * w + x] = 20;             // lead, 8 px thick
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {                                       // ring, r 60, 8 px thick
    const d = Math.hypot(x - 100, y - 170); if (d > 56 && d < 64) gray[y * w + x] = 20;
  }
  const res = trace({ gray, w, h }, { threshold: 128, mode: 'centerline', detail: 1.2 });
  const { prims } = toPrims(res, { widthMM: 16 });
  assert.ok(prims.some(p => p[0] === 'c'), 'ring recognised as a circle');
  assert.ok(prims.some(p => (p[0] === 'l' && p[1] === p[3]) || (p[0] === 'p' && p[1].every(q => q[0] === p[1][0][0]))), 'lead is a vertical line');
});
