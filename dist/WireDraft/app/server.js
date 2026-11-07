// WireDraft entry point.
//   WireDraft.exe            local server on 127.0.0.1 + editor in an Edge/Chrome app window
//   WireDraft.exe --mcp      MCP server over stdio
//   flags: --no-window, --port=N

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { APP, ROOT, LANG, DATA } from './node/paths.js';
import { loadConfig, saveConfig } from './node/config.js';

const VERSION = '0.1.0';
const args = process.argv.slice(2);

if (args.includes('--mcp')) {
  const { startMcp } = await import('./node/mcp.js');
  startMcp();
} else {
  await startServer();
}

async function startServer() {
  const store = await import('./node/store.js');
  const ai = await import('./node/ai.js');
  const { listLangs, readLang, translator } = await import('./node/lang.js');
  const { exportProject } = await import('./node/exporter.js');
  const { findBrowser } = await import('./node/pdf.js');
  const { findOda } = await import('./node/dwg.js');
  const { TEMPLATES } = await import('./core/frames.js');
  const { langReport } = await import('./core/i18n.js');
  const library = await import('./node/library.js');
  library.loadLibrary();

  const cfg = loadConfig();
  const portArg = args.find(a => a.startsWith('--port='));
  if (portArg) cfg.port = +portArg.split('=')[1];
  seedSample(store);

  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' };
  const STATIC = [['/core/', path.join(APP, 'core')], ['/lang/', LANG], ['/', path.join(APP, 'public')]];

  // ---------------------------------------------------------------- live updates (SSE + folder watch)
  const clients = new Set(), lastRev = new Map();
  const broadcast = evt => { const s = `data: ${JSON.stringify(evt)}\n\n`; for (const r of clients) r.write(s); };
  const timers = new Map();
  try {
    fs.watch(store.DIR, { recursive: true }, (ev, file) => {
      if (!file || !/project\.json$/.test(file)) return;
      const name = file.split(/[\\/]/)[0].replace(/\.wdp$/, '');
      clearTimeout(timers.get(name));
      timers.set(name, setTimeout(() => {
        const rev = store.exists(name) ? store.diskRev(name) : -1;
        if (lastRev.get(name) !== rev) { lastRev.set(name, rev); broadcast({ type: 'changed', name, rev, origin: 'external' }); }
      }, 150));
    });
  } catch { /* watching unsupported: edits from MCP show after reload */ }

  const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(code, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-store', ...extra });
    res.end(buf);
  };
  const readBody = (req, limit = 40e6) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('request too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
  const saved = (proj, origin) => { lastRev.set(proj.name, proj.rev); broadcast({ type: 'changed', name: proj.name, rev: proj.rev, origin }); return proj; };

  async function route(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    const origin = req.headers['x-client'] || 'api';
    const m = (method, re) => req.method === method && p.match(re);
    let r;

    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (m('GET', /^\/api\/info$/)) {
      return send(res, 200, {
        version: VERSION, langs: listLangs(), config: { language: cfg.language, paper: cfg.paper, chatModel: cfg.chatModel, visionModel: cfg.visionModel },
        templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name })),
        pdf: !!findBrowser(), dwg: !!findOda(), ai: ai.runtimeInfo(cfg), projectsDir: store.DIR, root: ROOT,
      });
    }
    if (m('POST', /^\/api\/config$/)) {
      const body = await readBody(req);
      const next = saveConfig(Object.fromEntries(Object.entries(body).filter(([k]) => ['language', 'paper', 'chatModel', 'visionModel'].includes(k))));
      Object.assign(cfg, next);
      return send(res, 200, { ok: true });
    }
    if ((r = m('GET', /^\/api\/lang\/([\w-]+)\/report$/))) return send(res, 200, langReport(readLang('en')?.strings || {}, readLang(r[1])?.strings || {}));
    if ((r = m('GET', /^\/api\/lang\/template$/))) {
      const en = readLang('en');
      const tpl = { meta: { code: 'xx', name: 'New language', englishName: '', version: 1, author: '', direction: 'ltr' }, strings: en?.strings || {} };
      return send(res, 200, JSON.stringify(tpl, null, 2), 'application/json', { 'content-disposition': 'attachment; filename="language-template.json"' });
    }

    // user symbol library
    if (m('GET', /^\/api\/library$/)) return send(res, 200, { symbols: library.listLibrary(), dir: library.LIB });
    if ((r = m('PUT', /^\/api\/library\/symbols\/([\w]+)$/))) {
      const b = await readBody(req);
      try { const s = library.saveSymbol({ ...b, id: r[1] }); broadcast({ type: 'library', origin }); return send(res, 200, s); }
      catch (e) { throw Object.assign(e, { status: e.status || 400 }); }
    }
    if ((r = m('DELETE', /^\/api\/library\/symbols\/([\w]+)$/))) { library.deleteSymbol(r[1]); broadcast({ type: 'library', origin }); return send(res, 200, { ok: true }); }

    // projects
    if (m('GET', /^\/api\/projects$/)) return send(res, 200, store.list());
    if (m('POST', /^\/api\/projects$/)) {
      const b = await readBody(req);
      const proj = store.create(b.name, { paper: cfg.paper, ...(b.meta || {}) });
      broadcast({ type: 'list' });
      return send(res, 201, saved(proj, origin));
    }
    if (m('POST', /^\/api\/projects\/import$/)) {
      const b = await readBody(req);
      if (!b.proj?.pages) throw Object.assign(new Error('not a WireDraft project file'), { status: 400 });
      const proj = store.importProject(b.proj, b.name);
      broadcast({ type: 'list' });
      return send(res, 201, saved(proj, origin));
    }
    if ((r = m('GET', /^\/api\/projects\/([^/]+)$/))) return send(res, 200, store.load(r[1]));
    if ((r = m('PUT', /^\/api\/projects\/([^/]+)$/))) {
      const b = await readBody(req);
      const proj = store.save({ ...b, name: r[1] }, { expectRev: b.rev });
      return send(res, 200, { rev: saved(proj, origin).rev });
    }
    if ((r = m('DELETE', /^\/api\/projects\/([^/]+)$/))) { store.remove(r[1]); broadcast({ type: 'list' }); return send(res, 200, { ok: true }); }
    if ((r = m('GET', /^\/api\/projects\/([^/]+)\/export$/))) {
      const out = await exportProject(store.load(r[1]), url.searchParams.get('format') || 'pdf', { pages: url.searchParams.get('pages') || undefined });
      const name = path.basename(out.file);
      return send(res, 200, fs.readFileSync(out.file), out.mime, { 'content-disposition': `attachment; filename="${name}"`, 'x-saved-to': encodeURIComponent(out.file) });
    }

    // AI
    if (m('GET', /^\/api\/ai\/models$/)) return send(res, 200, { models: await ai.listModels(cfg), defaults: { chat: cfg.chatModel, vision: cfg.visionModel } });
    if (m('POST', /^\/api\/ai\/chat$/)) {
      const b = await readBody(req);
      const proj = store.load(b.project);
      const out = await ai.assist(cfg, { proj, pageId: b.page, message: b.message, history: b.history, model: b.model });
      const s = store.save(out.proj, { expectRev: proj.rev });
      saved(s, origin);
      return send(res, 200, { proj: s, reply: out.reply, log: out.log, errors: out.errors, assistant: out.assistant, page: out.page });
    }
    if (m('POST', /^\/api\/ai\/review$/)) {
      const b = await readBody(req);
      const proj = store.load(b.project);
      return send(res, 200, await ai.review(cfg, { proj, td: translator(b.lang || cfg.language), model: b.model }));
    }
    if (m('POST', /^\/api\/ai\/vision$/)) {
      const b = await readBody(req);
      const proj = store.load(b.project);
      const out = await ai.vision(cfg, { proj, pageId: b.page, image: b.image, hint: b.hint, model: b.model });
      const s = store.save(out.proj, { expectRev: proj.rev });
      saved(s, origin);
      return send(res, 200, { proj: s, log: out.log, errors: out.errors, found: out.found });
    }

    // static files
    if (req.method === 'GET') {
      for (const [prefix, dir] of STATIC) {
        if (!p.startsWith(prefix)) continue;
        let rel = p.slice(prefix.length) || 'index.html';
        const file = path.resolve(dir, rel);
        if (!file.startsWith(path.resolve(dir))) break;
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
      }
    }
    send(res, 404, { error: 'not found' });
  }

  const server = http.createServer(async (req, res) => {
    try { await route(req, res); }
    catch (e) { if (!res.headersSent) send(res, e.status || 500, { error: e.message, current: e.current }); }
  });

  let port = cfg.port;
  for (let i = 0; i < 10; i++) {
    const ok = await new Promise(resolve => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); });
    if (ok) break;
    if (await isWireDraft(port)) { openWindow(`http://127.0.0.1:${port}/`, cfg, null); console.log(`WireDraft already running on port ${port}`); process.exit(0); }
    port++;
  }
  const url = `http://127.0.0.1:${port}/`;
  console.log(`WireDraft ${VERSION} running at ${url}`);
  console.log(`Projects: ${store.DIR}`);
  const shutdown = () => { ai.stopRuntime(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (cfg.openWindow && !args.includes('--no-window')) openWindow(url, cfg, shutdown);
}

async function isWireDraft(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(1000) }); return r.ok && !!(await r.json()).version; } catch { return false; }
}

/** Opens the editor in a chromeless Edge/Chrome window; closing it stops the server. */
async function openWindow(url, cfg, onClose) {
  const { findBrowser } = await import('./node/pdf.js');
  const browser = findBrowser();
  if (!browser) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd);
    return;
  }
  const profile = path.join(DATA, 'window-profile');
  fs.mkdirSync(profile, { recursive: true });
  const started = Date.now();
  const ch = spawn(browser, [`--app=${url}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1500,950'], { stdio: 'ignore', windowsHide: false });
  ch.on('exit', () => { if (onClose && Date.now() - started > 4000) onClose(); });
}

/** First run: copy the bundled sample project so there is something to open. */
function seedSample(store) {
  try {
    if (store.list().length) return;
    const sample = path.join(ROOT, 'samples', 'Demo-Panel.wdp');
    if (fs.existsSync(sample)) fs.cpSync(sample, path.join(store.DIR, 'Demo-Panel.wdp'), { recursive: true });
  } catch { /* ignore */ }
}
