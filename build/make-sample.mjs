// Builds samples/Demo-Panel.wdp (copied into projects/ on first run).
// Modelled on a typical panel: 400 V supply distribution, a DOL motor starter and its 24 V control.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.WIREDRAFT_PROJECTS = path.join(ROOT, 'samples');
fs.rmSync(path.join(ROOT, 'samples', 'Demo-Panel.wdp'), { recursive: true, force: true });

const { newProject } = await import('../app/core/model.js');
const { applyOps } = await import('../app/core/ops.js');
const { generateReports } = await import('../app/core/reports.js');
const store = await import('../app/node/store.js');
const { translator } = await import('../app/node/lang.js');

let p = newProject('Demo-Panel', {
  title: 'Demo panel', description: 'Pump station control panel', customer: 'Example Customer Oy', company: 'WireDraft demo',
  address: 'Example street 1, Helsinki', drawingNo: 'WD-0001', func: 'PS1', loc: 'CP', drawnBy: 'WD', approved: '', revision: '0', date: '2026-10-31',
});
p.pages[1].title = 'Power supply';

const node = (x, y) => ({ op: 'add', sym: 'node', x, y });
const ops = [];
let n = 0;
const N = (x, y) => { ops.push({ ...node(x, y), _id: `n${++n}` }); return `n${n}`; };

// ---------------------------------------------------------------- page 2: power supply
ops.push(
  { op: 'add', sym: 'box', tag: '-SUPPLY', x: 56, y: 252, props: { pinsTop: 'L1,L2,L3,N,PE', pinsBottom: '', w: 48, h: 12, desc: '400 V 3/N/PE 50 Hz 16 A' } },
  ...['L1', 'L2', 'L3', 'N'].map((t, i) => ({ op: 'add', sym: 'terminal', tag: '-X0', x: 40 + i * 8, y: 220, props: { term: t } })),
  { op: 'add', sym: 'terminal_pe', tag: '-X0', x: 72, y: 220, props: { term: 'PE' } },
  { op: 'add', sym: 'disconnector_3p', tag: '-Q1', x: 48, y: 160, props: { rating: '25 A', desc: 'Main switch' } },
  { op: 'add', sym: 'mcb_3p', tag: '-F1', x: 48, y: 96, props: { rating: 'C16A' } },
  { op: 'add', sym: 'mcb_1p', tag: '-F2', x: 140, y: 96, props: { rating: 'D10A', desc: 'Control voltage' } },
  { op: 'add', sym: 'mcb_1p', tag: '-F6', x: 220, y: 96, props: { rating: 'C10A', desc: 'Service socket' } },
  { op: 'add', sym: 'socket', tag: '-X100', x: 224, y: 152, props: { rating: '10 A' } },
  { op: 'add', sym: 'mcb_1p', tag: '-F8', x: 300, y: 96, props: { rating: 'D10A' } },
  { op: 'add', sym: 'psu', tag: '-G1', x: 304, y: 152, props: { rating: '5 A', output: '24 V DC' } },
  { op: 'add', sym: 'xref', x: 300, y: 188, props: { name: 'L+_G1' } },
  { op: 'add', sym: 'xref', x: 308, y: 188, props: { name: 'M_G1' } },
  { op: 'add', sym: 'xref', x: 140, y: 136, props: { name: 'L1_F2' } },
  ...['L1', 'L2', 'L3', 'N', 'PE'].map((nm, i) => ({ op: 'add', sym: 'xref', x: 396, y: 36 + i * 8, rot: 270, props: { name: nm } })),
  { op: 'add_text', x: 20, y: 268, text: 'POWER SUPPLY 400 VAC, N, PE 16 A 50 Hz', size: 2.5 },
  { op: 'add_text', x: 124, y: 160, text: 'CONTROL VOLTAGE', size: 2.5 },
  { op: 'add_text', x: 204, y: 180, text: 'SERVICE SOCKET', size: 2.5 },
  { op: 'add_text', x: 280, y: 210, text: 'SUPPLY FOR 24 VDC', size: 2.5 },
  { op: 'add_line', x1: 8, y1: 236, x2: 412, y2: 236, style: 'dashdot' },
  { op: 'add_text', x: 330, y: 233, text: 'CP-CABINET', size: 2.2 },
  { op: 'add_text', x: 330, y: 241, text: 'FIELD', size: 2.2 },
);
const busY = { L1: 36, L2: 44, L3: 52, N: 60, PE: 68 };
const taps = { L1: [40, 140], L2: [48, 220], L3: [56, 300], N: [64, 148, 224, 304], PE: [72, 228, 308] };

let r = applyOps(p, ops.map(({ _id, ...o }) => o), { page: '2' });
p = r.proj;
const pg2 = p.pages[1];
// bus connection points
const nodes = {};
const tmp = [];
for (const [bus, xs] of Object.entries(taps)) for (const x of xs) tmp.push({ op: 'add', sym: 'node', x, y: busY[bus] });
r = applyOps(p, tmp, { page: '2' }); p = r.proj;
const page2 = p.pages[1];
for (const [bus, xs] of Object.entries(taps)) nodes[bus] = xs.map(x => page2.items.syms.find(s => s.sym === 'node' && s.x === x && s.y === busY[bus]).id);
const xr = nm => page2.items.syms.find(s => s.sym === 'xref' && s.props.name === nm).id;
const bus = [];
for (const [b, ids] of Object.entries(nodes)) bus.push({ op: 'connect', pins: [...ids.map(id => `${id}.1`), `${xr(b)}.1`], props: { potential: b } });
const term = t => page2.items.syms.find(s => s.tag === '-X0' && s.props.term === t).id;
const wires = [
  ...['L1', 'L2', 'L3', 'N', 'PE'].map((t, i) => ({ op: 'connect', from: `-SUPPLY:${t}`, to: `${term(t)}.2`, props: { cable: '-W0', core: ['1', '2', '3', 'BU', 'GNYE'][i] } })),
  { op: 'connect', from: `${term('L1')}.1`, to: '-Q1:2', props: { size: '6 mm²', color: 'BK' } },
  { op: 'connect', from: `${term('L2')}.1`, to: '-Q1:4', props: { size: '6 mm²', color: 'BK' } },
  { op: 'connect', from: `${term('L3')}.1`, to: '-Q1:6', props: { size: '6 mm²', color: 'BK' } },
  { op: 'connect', from: `${term('N')}.1`, to: `${nodes.N[0]}.1`, props: { size: '6 mm²', color: 'BU' } },
  { op: 'connect', from: `${term('PE')}.1`, to: `${nodes.PE[0]}.1`, props: { size: '6 mm²', color: 'GNYE' } },
  { op: 'connect', from: '-Q1:1', to: '-F1:2' }, { op: 'connect', from: '-Q1:3', to: '-F1:4' }, { op: 'connect', from: '-Q1:5', to: '-F1:6' },
  { op: 'connect', from: '-F1:1', to: `${nodes.L1[0]}.1` }, { op: 'connect', from: '-F1:3', to: `${nodes.L2[0]}.1` }, { op: 'connect', from: '-F1:5', to: `${nodes.L3[0]}.1` },
  { op: 'connect', from: '-F2:1', to: `${nodes.L1[1]}.1` }, { op: 'connect', from: '-F2:2', to: `${xr('L1_F2')}.1` },
  { op: 'connect', from: '-F6:1', to: `${nodes.L2[1]}.1` }, { op: 'connect', from: '-F6:2', to: '-X100:L', props: { size: '1,5 mm²' } },
  { op: 'connect', from: `${nodes.N[2]}.1`, to: '-X100:N', props: { size: '1,5 mm²', color: 'BU' } },
  { op: 'connect', from: `${nodes.PE[1]}.1`, to: '-X100:PE', props: { size: '1,5 mm²', color: 'GNYE' } },
  { op: 'connect', from: '-F8:1', to: `${nodes.L3[1]}.1` }, { op: 'connect', from: '-F8:2', to: '-G1:L', props: { size: '1,5 mm²' } },
  { op: 'connect', from: `${nodes.N[3]}.1`, to: '-G1:N', props: { size: '1,5 mm²', color: 'BU' } },
  { op: 'connect', from: `${nodes.PE[2]}.1`, to: '-G1:PE', props: { size: '1,5 mm²', color: 'GNYE' } },
  { op: 'connect', from: '-G1:+', to: `${xr('L+_G1')}.1`, props: { size: '2,5 mm²', color: 'DBU' } },
  { op: 'connect', from: '-G1:-', to: `${xr('M_G1')}.1`, props: { size: '2,5 mm²', color: 'DBU' } },
  { op: 'add', sym: 'xref', x: 148, y: 136, props: { name: 'N_F2' } },
  { op: 'connect', from: `${nodes.N[1]}.1`, to: 's$NF2' },
  { op: 'add_cable', tag: '-W0', type: '5G2,5mm²', length: '6', from: 'Supply', to: '-X0' },
];
// the N_F2 xref id is only known after it is added: split the batch
const nf2 = wires.findIndex(o => o.to === 's$NF2');
r = applyOps(p, [...bus, ...wires.slice(0, nf2)], { page: '2' }); p = r.proj;
if (r.errors.length) console.error(r.errors);
const nf2id = r.created.at(-1);
r = applyOps(p, [{ op: 'connect', from: `${nodes.N[1]}.1`, to: `${nf2id}.1`, props: { color: 'BU' } }, ...wires.slice(nf2 + 1)], { page: '2' }); p = r.proj;
if (r.errors.length) console.error(r.errors);

// ---------------------------------------------------------------- page 3: motor starter and 24 V control
r = applyOps(p, [
  { op: 'add_page', title: 'Pump motor -M1' },
  ...['L1', 'L2', 'L3'].map((nm, i) => ({ op: 'add', sym: 'xref', x: 40 + i * 8, y: 24, rot: 180, props: { name: nm } })),
  { op: 'add', sym: 'mpcb_3p', tag: '-Q2', x: 48, y: 64, props: { rating: '4-6.3 A', setting: '5.5 A', desc: 'Pump motor protection' } },
  { op: 'add', sym: 'main_contacts_3p', tag: '-K1', x: 48, y: 108 },
  ...['1', '2', '3'].map((t, i) => ({ op: 'add', sym: 'terminal', tag: '-X1', x: 40 + i * 8, y: 148, props: { term: t } })),
  { op: 'add', sym: 'terminal_pe', tag: '-X1', x: 64, y: 148, props: { term: 'PE' } },
  { op: 'add', sym: 'cable_mark', tag: '-W1', x: 56, y: 172 },
  { op: 'add', sym: 'motor3', tag: '-M1', x: 48, y: 204, props: { power: '4 kW', voltage: '400 V', desc: 'Pump' } },
  { op: 'add_cable', tag: '-W1', type: '4G1,5mm²', length: '12', from: '-X1', to: '-M1' },
  { op: 'add', sym: 'xref', x: 200, y: 24, rot: 180, props: { name: 'L+_G1' } },
  { op: 'add', sym: 'estop', tag: '-S0', x: 200, y: 60, props: { desc: 'Emergency stop' } },
  { op: 'add', sym: 'pb_nc', tag: '-S1', x: 200, y: 84, props: { desc: 'Stop' } },
  { op: 'add', sym: 'pb_no', tag: '-S2', x: 200, y: 116, props: { desc: 'Start' } },
  { op: 'add', sym: 'contact_no', tag: '-K1', x: 228, y: 116, props: { nums: '13-14' } },
  { op: 'add', sym: 'coil', tag: '-K1', x: 200, y: 156, props: { voltage: '24 V DC', desc: 'Pump contactor' } },
  { op: 'add', sym: 'contact_no', tag: '-K1', x: 268, y: 116, props: { nums: '23-24' } },
  { op: 'add', sym: 'lamp', tag: '-H1', x: 268, y: 156, props: { color: 'green', desc: 'Pump running' } },
  { op: 'add', sym: 'xref', x: 200, y: 192, props: { name: 'M_G1' } },
  { op: 'add_text', x: 24, y: 262, text: 'PUMP MOTOR 4 kW', size: 2.5 },
  { op: 'add_text', x: 184, y: 214, text: 'PUMP START / STOP 24 VDC', size: 2.5 },
], { page: '2' });
p = r.proj;
if (r.errors.length) console.error(r.errors);
const pg3 = p.pages[2];
const id3 = (pred) => pg3.items.syms.find(pred).id;
const xr3 = nm => id3(s => s.sym === 'xref' && s.props.name === nm);
const t1 = t => id3(s => s.tag === '-X1' && s.props.term === t);
const k1a = id3(s => s.tag === '-K1' && s.props.nums === '13-14'), k1b = id3(s => s.tag === '-K1' && s.props.nums === '23-24');
r = applyOps(p, [
  { op: 'add', sym: 'node', x: 200, y: 44 }, { op: 'add', sym: 'node', x: 200, y: 100 }, { op: 'add', sym: 'node', x: 200, y: 132 },
  { op: 'add', sym: 'node', x: 200, y: 176 }, { op: 'add', sym: 'node', x: 268, y: 176 },
], { page: pg3.id });
p = r.proj;
const [n0, n1, n2, n3, n4] = r.created;
const c = { size: '0,75 mm²', color: 'DBU' };
r = applyOps(p, [
  { op: 'connect', from: `${xr3('L1')}.1`, to: '-Q2:1' }, { op: 'connect', from: `${xr3('L2')}.1`, to: '-Q2:3' }, { op: 'connect', from: `${xr3('L3')}.1`, to: '-Q2:5' },
  { op: 'connect', from: '-Q2:2', to: `${id3(s => s.sym === 'main_contacts_3p')}.1` }, { op: 'connect', from: '-Q2:4', to: `${id3(s => s.sym === 'main_contacts_3p')}.3` }, { op: 'connect', from: '-Q2:6', to: `${id3(s => s.sym === 'main_contacts_3p')}.5` },
  { op: 'connect', from: `${id3(s => s.sym === 'main_contacts_3p')}.2`, to: `${t1('1')}.1`, props: { size: '1,5 mm²', color: 'BK' } },
  { op: 'connect', from: `${id3(s => s.sym === 'main_contacts_3p')}.4`, to: `${t1('2')}.1`, props: { size: '1,5 mm²', color: 'BK' } },
  { op: 'connect', from: `${id3(s => s.sym === 'main_contacts_3p')}.6`, to: `${t1('3')}.1`, props: { size: '1,5 mm²', color: 'BK' } },
  { op: 'connect', from: `${t1('1')}.2`, to: '-M1:U', props: { cable: '-W1', core: '1' } },
  { op: 'connect', from: `${t1('2')}.2`, to: '-M1:V', props: { cable: '-W1', core: '2' } },
  { op: 'connect', from: `${t1('3')}.2`, to: '-M1:W', props: { cable: '-W1', core: '3' } },
  { op: 'connect', from: `${t1('PE')}.2`, to: '-M1:PE', props: { cable: '-W1', core: 'GNYE' } },
  { op: 'connect', from: `${xr3('L+_G1')}.1`, to: `${n0}.1`, props: { ...c, wire: '101' } },
  { op: 'connect', from: `${n0}.1`, to: '-S0:11', props: { ...c, wire: '101' } },
  { op: 'connect', from: '-S0:12', to: '-S1:11', props: { ...c, wire: '102' } },
  { op: 'connect', from: '-S1:12', to: `${n1}.1`, props: { ...c, wire: '103' } },
  { op: 'connect', from: `${n1}.1`, to: '-S2:13', props: { ...c, wire: '103' } },
  { op: 'connect', from: `${n1}.1`, to: `${k1a}.1`, props: { ...c, wire: '103' } },
  { op: 'connect', from: '-S2:14', to: `${n2}.1`, props: { ...c, wire: '104' } },
  { op: 'connect', from: `${k1a}.2`, to: `${n2}.1`, props: { ...c, wire: '104' } },
  { op: 'connect', from: `${n2}.1`, to: '-K1:A1', props: { ...c, wire: '104' } },
  { op: 'connect', from: '-K1:A2', to: `${n3}.1`, props: { ...c, wire: '100' } },
  { op: 'connect', from: `${n3}.1`, to: `${xr3('M_G1')}.1`, props: { ...c, wire: '100' } },
  { op: 'connect', from: `${n0}.1`, to: `${k1b}.1`, props: { ...c, wire: '101' } },
  { op: 'connect', from: `${k1b}.2`, to: '-H1:X1', props: { ...c, wire: '105' } },
  { op: 'connect', from: '-H1:X2', to: `${n4}.1`, props: { ...c, wire: '100' } },
  { op: 'connect', from: `${n4}.1`, to: `${n3}.1`, props: { ...c, wire: '100' } },
], { page: pg3.id });
p = r.proj;
if (r.errors.length) console.error(r.errors);

// PE of the motor terminal comes from the PE bus: show it with an interruption point
r = applyOps(p, [{ op: 'add', sym: 'xref', x: 64, y: 24, rot: 180, props: { name: 'PE' } }], { page: pg3.id }); p = r.proj;
const pe3 = r.created[0];
r = applyOps(p, [{ op: 'connect', from: `${pe3}.1`, to: `${t1('PE')}.1`, props: { size: '1,5 mm²', color: 'GNYE' } }], { page: pg3.id }); p = r.proj;

generateReports(p, { td: translator('en') });
const saved = store.save(p);
console.log(`Wrote ${saved.name} rev ${saved.rev}: ${saved.pages.map(x => `${x.number} ${x.title}`).join(' | ')}`);
