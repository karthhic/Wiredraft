// Multi-page vector PDF: every page is rendered to SVG, then printed by the
// Edge/Chrome engine that ships with Windows (no PDF library needed).

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA } from './paths.js';
import { standaloneSVG } from '../core/render.js';
import { crossRefs } from '../core/xref.js';
import { PAPERS, paperOf } from '../core/model.js';

const CANDIDATES = [
  process.env.WIREDRAFT_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export const findBrowser = () => CANDIDATES.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;

export function pagesHtml(proj, pages, td) {
  const xrefs = crossRefs(proj);
  const used = new Set(pages.map(p => paperOf(proj, p)));
  const css = [...used].map(k => `@page ${k} { size: ${PAPERS[k].w}mm ${PAPERS[k].h}mm; margin: 0 } .pg.${k} { page: ${k}; width: ${PAPERS[k].w}mm; height: ${PAPERS[k].h}mm }`).join('\n');
  const body = pages.map(p => `<div class="pg ${paperOf(proj, p)}">${standaloneSVG(proj, p, { td, formatDate: td.formatDate, xrefs })}</div>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${proj.meta.title || proj.name}</title><style>
html,body{margin:0;padding:0;background:#fff}
.pg{break-after:page;overflow:hidden}
.pg:last-child{break-after:auto}
.pg svg{display:block;width:100%;height:100%}
${css}
</style></head><body>${body}</body></html>`;
}

export async function exportPdf(proj, pages, td, outFile) {
  const browser = findBrowser();
  if (!browser) throw Object.assign(new Error('PDF export needs Microsoft Edge or Google Chrome, and neither was found.'), { status: 501 });
  const tmpDir = path.join(DATA, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const html = path.join(tmpDir, `print-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(html, pagesHtml(proj, pages, td));
  const profile = path.join(tmpDir, 'pdf-profile');
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--user-data-dir=${profile}`, '--no-pdf-header-footer', '--print-to-pdf-no-header', `--print-to-pdf=${outFile}`, `file:///${html.replace(/\\/g, '/')}`];
  await new Promise((resolve, reject) => {
    const ch = spawn(browser, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => { ch.kill(); reject(new Error('PDF export timed out')); }, 120000);
    ch.on('error', e => { clearTimeout(timer); reject(e); });
    ch.on('exit', () => { clearTimeout(timer); resolve(); });
  });
  try { fs.unlinkSync(html); } catch { /* ignore */ }
  if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 200) throw new Error('PDF export failed (the browser produced no file)');
  return outFile;
}
