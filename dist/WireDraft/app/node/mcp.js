// MCP server over stdio (newline-delimited JSON-RPC 2.0), no SDK.
// Started with `WireDraft.exe --mcp`. Works on the same project files as the
// editor; an open editor window updates live because the server watches the folder.

import fs from 'node:fs';
import readline from 'node:readline';
import * as store from './store.js';
import { applyOps, OPS_HELP } from '../core/ops.js';
import { checkProject } from '../core/check.js';
import { symbolCatalog, describePage, describeProject } from '../core/describe.js';
import { terminalRows, cableRows, terminalStrips, generateReports } from '../core/reports.js';
import { getPage } from '../core/model.js';
import { translator, drawingTranslator } from './lang.js';
import { loadConfig } from './config.js';
import { exportProject, renderPng } from './exporter.js';
import path from 'node:path';
import { loadLibrary, saveSymbol, listLibrary } from './library.js';
import { DATA } from './paths.js';

const VERSION = '0.1.0';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = d => ({ type: 'string', description: d });

function summarizeChecks(proj) {
  const td = translator('en');
  const issues = checkProject(proj);
  if (!issues.length) return 'Checks: no issues.';
  const counts = ['error', 'warning', 'info'].map(l => `${issues.filter(i => i.level === l).length} ${l}`).join(', ');
  return `Checks: ${counts}\n` + issues.slice(0, 25).map(i => `- ${i.level}${i.pageNo ? ` p${i.pageNo}` : ''}: ${td(i.key, i.args)}`).join('\n');
}

const TOOLS = [
  { name: 'list_projects', description: 'List WireDraft projects.', inputSchema: S({}),
    run: () => JSON.stringify(store.list(), null, 1) },
  { name: 'create_project', description: 'Create a project (A4/A3/A2 landscape, drawing language en/fi...).',
    inputSchema: S({ name: str('folder name'), title: str('project title'), paper: { type: 'string', enum: ['A4', 'A3', 'A2'] }, language: str('fixed drawing language code (en, fi...); omit to follow the interface language'), customer: str(''), company: str('') }, ['name']),
    run: a => { const p = store.create(a.name, Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== 'name' && v))); return `Created ${p.name}.\n${describeProject(p)}`; } },
  { name: 'get_project', description: 'Project summary: title block data, pages, devices, cables.', inputSchema: S({ project: str('project name') }, ['project']),
    run: a => describeProject(store.load(a.project)) },
  { name: 'get_page', description: 'Symbols, wires and texts on one page (mm coordinates, pins, cross-references).', inputSchema: S({ project: str(''), page: str('page number or id') }, ['project', 'page']),
    run: a => { const p = store.load(a.project); const pg = getPage(p, a.page); if (!pg) throw new Error(`no page ${a.page}`); return describePage(p, pg); } },
  { name: 'list_symbols', description: 'The IEC symbol library: ids, pins and properties.', inputSchema: S({}),
    run: () => symbolCatalog() },
  { name: 'save_symbol', description: `Create or update a custom symbol in the user library (library/symbols). Units mm, origin = symbol centre, y down, pins on a 4 mm grid, current flows top → bottom.
Format: {"id":"cabinet_fan","name":"Cabinet fan","names":{"fi":"Kaappituuletin"},"cat":"custom","letter":"M","role":null,
 "pins":[{"id":"L","x":-4,"y":-8},{"id":"N","x":4,"y":-8}],
 "prims":[["c",0,0,5],["l",-4,-8,-4,-3],["l",4,-8,4,-3],["t",0,1,"FAN",2,"middle"]],
 "fields":["power","voltage","desc","part"],"local":[],"show":["power"]}
prims: ["l",x1,y1,x2,y2,{dash}] line, ["r",x,y,w,h] rectangle, ["c",cx,cy,r,{fill:true}] circle, ["a",cx,cy,r,startDeg,endDeg] arc (clockwise, 0° = right),
["p",[[x,y],...],closed,{fill:true}] polyline, ["t",x,y,"text",size,"start|middle|end"] text. role: "main" (coil) or "aux" (contact) for cross-references.`,
    inputSchema: S({ symbol: { type: 'object' } }, ['symbol']),
    run: a => { const s = saveSymbol(a.symbol); return `Saved symbol ${s.id} (${s.pins.length} pins). Place it with {"op":"add","sym":"${s.id}"}.`; } },
  { name: 'list_custom_symbols', description: 'The custom symbols in the user library, as JSON definitions.', inputSchema: S({}),
    run: () => JSON.stringify(listLibrary(), null, 1) },
  { name: 'apply_ops', description: `Edit a project with a batch of operations (the main editing tool).\n${OPS_HELP}`,
    inputSchema: S({ project: str(''), page: str('default page number or id'), ops: { type: 'array', items: { type: 'object' } } }, ['project', 'ops']),
    run: a => {
      const proj = store.load(a.project);
      const r = applyOps(proj, a.ops, { page: a.page });
      const saved = store.save(r.proj, { expectRev: proj.rev });
      return [`Saved ${saved.name} rev ${saved.rev}.`, ...r.log.map(l => `✓ ${l}`), ...r.errors.map(e => `✗ ${e}`), summarizeChecks(saved)].join('\n');
    } },
  { name: 'check_project', description: 'Run the design-rule checks.', inputSchema: S({ project: str('') }, ['project']),
    run: a => summarizeChecks(store.load(a.project)) },
  { name: 'get_reports', description: 'Terminal diagram rows (per strip) and the cable list with lengths, as JSON.',
    inputSchema: S({ project: str(''), kind: { type: 'string', enum: ['terminal', 'cable'] }, strip: str('terminal strip tag, e.g. -X1 (omit for all)') }, ['project', 'kind']),
    run: a => {
      const p = store.load(a.project);
      if (a.kind === 'cable') return JSON.stringify(cableRows(p), null, 1);
      const strips = a.strip ? [a.strip] : terminalStrips(p);
      return JSON.stringify(Object.fromEntries(strips.map(s => [s, terminalRows(p, s)])), null, 1);
    } },
  { name: 'generate_reports', description: 'Create or refresh the generated report pages (terminal diagrams, cable list).', inputSchema: S({ project: str('') }, ['project']),
    run: a => { const p = store.load(a.project); generateReports(p, { td: drawingTranslator(p, loadConfig().language) }); const s = store.save(p, { expectRev: p.rev }); return `Report pages: ${s.pages.filter(x => x.kind === 'report').map(x => `${x.number} ${x.title}`).join(', ')}`; } },
  { name: 'export', description: 'Export to PDF, DXF or DWG (DWG needs the ODA File Converter). Returns the file path.',
    inputSchema: S({ project: str(''), format: { type: 'string', enum: ['pdf', 'dxf', 'dwg', 'svg'] }, pages: str('comma-separated page numbers, or omit for all') }, ['project', 'format']),
    run: async a => { const r = await exportProject(store.load(a.project), a.format, { pages: a.pages }); return `Exported: ${r.file}`; } },
  { name: 'render_page', description: 'PNG image of a page, so you can see the drawing.', inputSchema: S({ project: str(''), page: str('') }, ['project', 'page']),
    run: async a => {
      const p = store.load(a.project); const pg = getPage(p, a.page); if (!pg) throw new Error(`no page ${a.page}`);
      const f = await renderPng(p, pg, path.join(DATA, 'tmp', `mcp-${Date.now()}.png`), 3);
      const data = fs.readFileSync(f).toString('base64'); fs.unlinkSync(f);
      return { content: [{ type: 'image', data, mimeType: 'image/png' }, { type: 'text', text: `Page ${pg.number} "${pg.title}"` }] };
    } },
];

export function startMcp() {
  loadLibrary();
  const send = m => process.stdout.write(JSON.stringify(m) + '\n');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async line => {
    if (!line.trim()) return;
    let m;
    try { m = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const { id, method, params } = m;
    const reply = result => id !== undefined && send({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
    try {
      switch (method) {
        case 'initialize':
          return reply({
            protocolVersion: SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED[0],
            capabilities: { tools: {} }, serverInfo: { name: 'wiredraft', version: VERSION },
            instructions: 'WireDraft electrical CAD. Use list_projects/get_project/get_page to read, apply_ops to edit (IEC tags like -F1, pins TAG:PIN, mm coordinates), check_project after edits, render_page to see a page, export for PDF/DXF/DWG.',
          });
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
        case 'tools/call': {
          const t = TOOLS.find(t => t.name === params?.name);
          if (!t) return fail(-32602, `Unknown tool ${params?.name}`);
          try {
            const out = await t.run(params.arguments || {});
            return reply(typeof out === 'string' ? { content: [{ type: 'text', text: out }] } : out);
          } catch (e) { return reply({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }); }
        }
        default:
          if (method?.startsWith('notifications/')) return;
          return fail(-32601, `Method not found: ${method}`);
      }
    } catch (e) { fail(-32603, e.message); }
  });
  process.stderr.write(`WireDraft MCP server ${VERSION} ready (projects: ${store.DIR})\n`);
}
