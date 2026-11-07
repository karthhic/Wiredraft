// Export a project to PDF / DXF / DWG / PNG. Files land in ROOT/exports/<project>/.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DATA } from './paths.js';
import { exportPdf, findBrowser } from './pdf.js';
import { pageDxf } from './dxf.js';
import { dxfToDwg } from './dwg.js';
import { zip } from './zip.js';
import { drawingTranslator } from './lang.js';
import { loadConfig } from './config.js';
import { crossRefs } from '../core/xref.js';
import { standaloneSVG } from '../core/render.js';
import { getPage, paperOf, PAPERS } from '../core/model.js';

export const EXPORTS = path.join(ROOT, 'exports');
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const fileSafe = s => String(s).replace(/[^\w.\-]+/g, '_');

export function pickPages(proj, pages) {
  if (!pages || pages === 'all') return proj.pages;
  const list = (Array.isArray(pages) ? pages : String(pages).split(',')).map(p => getPage(proj, String(p).trim())).filter(Boolean);
  if (!list.length) throw Object.assign(new Error('no matching pages'), { status: 400 });
  return list;
}

export async function exportProject(proj, format, { pages } = {}) {
  const td = drawingTranslator(proj, loadConfig().language);
  const sel = pickPages(proj, pages);
  const dir = path.join(EXPORTS, fileSafe(proj.name));
  fs.mkdirSync(dir, { recursive: true });
  const base = `${fileSafe(proj.name)}_${stamp()}`;
  const xrefs = crossRefs(proj);

  if (format === 'pdf') {
    const file = path.join(dir, `${base}.pdf`);
    await exportPdf(proj, sel, td, file);
    return { file, mime: 'application/pdf' };
  }
  if (format === 'dxf' || format === 'dwg') {
    const dxfs = sel.map(p => ({ name: `${fileSafe(proj.name)}_page_${fileSafe(p.number)}.dxf`, data: pageDxf(proj, p, { td, formatDate: td.formatDate, xrefs }) }));
    if (format === 'dxf') {
      if (dxfs.length === 1) { const file = path.join(dir, dxfs[0].name); fs.writeFileSync(file, dxfs[0].data); return { file, mime: 'image/vnd.dxf' }; }
      const file = path.join(dir, `${base}_dxf.zip`); fs.writeFileSync(file, zip(dxfs)); return { file, mime: 'application/zip' };
    }
    const tmpIn = path.join(DATA, 'tmp', `dxf-${Date.now()}`), tmpOut = `${tmpIn}-out`;
    fs.mkdirSync(tmpIn, { recursive: true });
    for (const d of dxfs) fs.writeFileSync(path.join(tmpIn, d.name), d.data);
    const dwgs = await dxfToDwg(tmpIn, tmpOut);
    if (!dwgs.length) throw new Error('the ODA converter produced no DWG files');
    let result;
    if (dwgs.length === 1) { const file = path.join(dir, path.basename(dwgs[0])); fs.copyFileSync(dwgs[0], file); result = { file, mime: 'image/vnd.dwg' }; }
    else { const file = path.join(dir, `${base}_dwg.zip`); fs.writeFileSync(file, zip(dwgs.map(f => ({ name: path.basename(f), data: fs.readFileSync(f) })))); result = { file, mime: 'application/zip' }; }
    fs.rmSync(tmpIn, { recursive: true, force: true }); fs.rmSync(tmpOut, { recursive: true, force: true });
    return result;
  }
  if (format === 'svg') {
    const p = sel[0];
    const file = path.join(dir, `${fileSafe(proj.name)}_page_${fileSafe(p.number)}.svg`);
    fs.writeFileSync(file, standaloneSVG(proj, p, { td, formatDate: td.formatDate, xrefs }));
    return { file, mime: 'image/svg+xml' };
  }
  if (format === 'png') return { file: await renderPng(proj, sel[0], path.join(dir, `${fileSafe(proj.name)}_page_${fileSafe(sel[0].number)}.png`)), mime: 'image/png' };
  throw Object.assign(new Error(`unknown export format "${format}"`), { status: 400 });
}

/** PNG of one page via the headless browser (used by MCP clients that can see images). */
export async function renderPng(proj, page, file, pxPerMm = 4) {
  const browser = findBrowser();
  if (!browser) throw new Error('PNG rendering needs Edge or Chrome');
  const td = drawingTranslator(proj, loadConfig().language);
  const { w, h } = PAPERS[paperOf(proj, page)];
  const tmp = path.join(DATA, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const svgFile = path.join(tmp, `page-${Date.now()}.html`);
  fs.writeFileSync(svgFile, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}svg{width:${w * pxPerMm}px;height:${h * pxPerMm}px;display:block}</style>${standaloneSVG(proj, page, { td, formatDate: td.formatDate })}`);
  await new Promise((resolve, reject) => {
    const ch = spawn(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${path.join(tmp, 'png-profile')}`,
      `--window-size=${Math.round(w * pxPerMm)},${Math.round(h * pxPerMm)}`, `--screenshot=${file}`, `file:///${svgFile.replace(/\\/g, '/')}`], { stdio: 'ignore', windowsHide: true });
    ch.on('error', reject); ch.on('exit', resolve);
  });
  try { fs.unlinkSync(svgFile); } catch { /* ignore */ }
  if (!fs.existsSync(file)) throw new Error('PNG rendering failed');
  return file;
}
