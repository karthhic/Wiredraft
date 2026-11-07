// Local AI through Ollama. A portable runtime in resources/runtime/ollama is started
// on a private port with its models in resources/models; otherwise the configured
// Ollama (installed one) is used. The model never draws: it returns JSON ops.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { RESOURCES } from './paths.js';
import { applyOps, OPS_HELP } from '../core/ops.js';
import { symbolCatalog, describePage, describeProject } from '../core/describe.js';
import { checkProject } from '../core/check.js';
import { frameGeom } from '../core/frames.js';
import { getPage, paperOf } from '../core/model.js';

const PORTABLE = path.join(RESOURCES, 'runtime', 'ollama', process.platform === 'win32' ? 'ollama.exe' : 'ollama');
const MODELS = path.join(RESOURCES, 'models');
let child = null, base = null;

const err = (status, message) => Object.assign(new Error(message), { status });

async function ping(url, ms = 1500) {
  try { const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(ms) }); return r.ok; } catch { return false; }
}

export function runtimeInfo(cfg) {
  return { portable: fs.existsSync(PORTABLE), portablePath: PORTABLE, modelsDir: MODELS, configured: cfg.ollama, active: base };
}

export async function ensureRuntime(cfg) {
  if (base && await ping(base)) return base;
  if (fs.existsSync(PORTABLE)) {
    const url = `http://127.0.0.1:${cfg.portableOllamaPort}`;
    if (!(await ping(url))) {
      fs.mkdirSync(MODELS, { recursive: true });
      child = spawn(PORTABLE, ['serve'], {
        env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${cfg.portableOllamaPort}`, OLLAMA_MODELS: MODELS },
        stdio: 'ignore', windowsHide: true,
      });
      child.on('exit', () => { child = null; });
      for (let i = 0; i < 40 && !(await ping(url, 500)); i++) await new Promise(r => setTimeout(r, 500));
    }
    if (await ping(url)) return (base = url);
  }
  const url = cfg.ollama.replace(/\/$/, '');
  if (await ping(url)) return (base = url);
  throw err(503, `No local AI runtime found. Put a portable Ollama in ${path.dirname(PORTABLE)} or start Ollama (${url}).`);
}

export function stopRuntime() { if (child) { child.kill(); child = null; } }

async function ollama(cfg, endpoint, body, ms = 300000) {
  const url = await ensureRuntime(cfg);
  const r = await fetch(url + endpoint, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw err(502, `Ollama ${endpoint} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

export async function listModels(cfg) {
  const r = await ollama(cfg, '/api/tags', null, 5000);
  return r.models.map(m => ({ name: m.name, size: m.size, vision: /vl|llava|vision|moondream|minicpm-v|gemma3/i.test(m.name) }));
}

function parseJSON(s) {
  try { return JSON.parse(s); } catch { /* fall through */ }
  const m = String(s).match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch { /* fall through */ }
  throw err(502, 'The model did not return valid JSON. Try again or pick another model.');
}

const OPS_SCHEMA = { type: 'object', properties: { reply: { type: 'string' }, ops: { type: 'array', items: { type: 'object' } } }, required: ['reply', 'ops'] };

function systemPrompt(proj, page) {
  const g = frameGeom(paperOf(proj, page));
  return `You are WireDraft's drafting assistant for IEC electrical schematics (EPLAN style).
You change the project ONLY by returning operations. Reply with JSON: {"reply": "<short answer to the user>", "ops": [ ... ]}.
If the user only asks a question, answer in "reply" and return an empty ops list.

${OPS_HELP}

Drawing conventions:
- Sheet ${page.paper || proj.meta.paper}: drawing area x ${g.draw.x}..${g.draw.x + g.draw.w} mm, y ${g.draw.y}..${g.draw.y + g.draw.h} mm, 10 columns of ${g.colW.toFixed(1)} mm.
- Current flows top to bottom; place supply at the top, loads at the bottom, protection and switching in between, about 24-40 mm apart vertically.
- Snap to a 4 mm grid. Use IEC tags: -F protection, -Q main switch / motor protection, -K contactors and relays, -S buttons, -H lamps, -M motors, -X terminals, -G power supplies, -W cables, -A devices.
- A contactor is one device: its coil and contacts share the same tag (e.g. coil -K1 and main_contacts_3p -K1).
- Terminals on one strip share the strip tag (-X1) and each has props.term (1, 2, 3...).
- Wire props: wire (number), size ("2,5 mm²"), color (BK, BU, BN, GNYE...), cable and core.
- Multi-pole devices: pole n has its input pin 2n-1 on top and its output pin 2n at the bottom (1→2, 3→4, 5→6).
  Connect the OUTPUTS of the upper device (2, 4, 6) to the INPUTS of the device below (1, 3, 5). Never connect 2→2 or 3→2.
- Stack a power path vertically in ONE column (same x for every device), e.g. y = 60, 100, 140, 190.
  Put a separate circuit (e.g. its control circuit) in another column at least 60 mm to the right.

For standard circuits use a macro — e.g. "pump motor -M2 with start/stop":
{"reply":"Added DOL starter -Q2/-K2/-M2 and its start/stop control.","ops":[
 {"op":"macro","name":"dol_starter","x":60,"y":60,"params":{"protection":"-Q2","contactor":"-K2","motor":"-M2","power":"3 kW"}},
 {"op":"macro","name":"start_stop","x":200,"y":40,"params":{"contactor":"-K2","stop":"-S3","start":"-S4","estop":"none","lamp":"-H2"}}]}

Wiring by hand — "DOL starter for motor -M1" without the macro:
{"reply":"Added a DOL starter: -Q1 → -K1 → -M1.","ops":[
 {"op":"add","sym":"mpcb_3p","tag":"-Q1","x":60,"y":60,"props":{"rating":"4-6.3 A"}},
 {"op":"add","sym":"main_contacts_3p","tag":"-K1","x":60,"y":100},
 {"op":"add","sym":"motor3","tag":"-M1","x":60,"y":150,"props":{"power":"4 kW"}},
 {"op":"connect","from":"-Q1:2","to":"-K1:1"},{"op":"connect","from":"-Q1:4","to":"-K1:3"},{"op":"connect","from":"-Q1:6","to":"-K1:5"},
 {"op":"connect","from":"-K1:2","to":"-M1:U"},{"op":"connect","from":"-K1:4","to":"-M1:V"},{"op":"connect","from":"-K1:6","to":"-M1:W"}]}

SYMBOLS (id — name; pins; props):
${symbolCatalog()}

PROJECT:
${describeProject(proj)}

CURRENT PAGE:
${describePage(proj, page)}`;
}

export async function assist(cfg, { proj, pageId, message, history = [], model }) {
  const page = getPage(proj, pageId) || proj.pages[0];
  const messages = [
    { role: 'system', content: systemPrompt(proj, page) },
    ...history.slice(-8).map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 3000) })),
    { role: 'user', content: message },
  ];
  const ask = async msgs => {
    const r = await ollama(cfg, '/api/chat', { model: model || cfg.chatModel, messages: msgs, stream: false, format: OPS_SCHEMA, options: { temperature: 0.1, num_ctx: 12288 } });
    return { raw: r.message?.content || '', out: parseJSON(r.message?.content) };
  };
  let { raw, out } = await ask(messages);
  let res = applyOps(proj, out.ops || [], { page: page.id });
  let reply = String(out.reply || '');
  const log = [...res.log];
  if (res.errors.length && (out.ops || []).length) {
    // one repair round: send back the failures, apply corrected ops on top of what worked
    const retry = await ask([...messages, { role: 'assistant', content: raw },
      { role: 'user', content: `These operations failed:\n${res.errors.join('\n')}\nThe others were applied. Return JSON with corrected ops for ONLY the failed ones.\nCurrent page now:\n${describePage(res.proj, getPage(res.proj, page.id))}` }]);
    const fix = applyOps(res.proj, retry.out.ops || [], { page: page.id });
    log.push(...fix.log);
    res = { ...fix, errors: fix.errors };
    raw = JSON.stringify({ reply, ops: [...(out.ops || []), ...(retry.out.ops || [])] });
    if (retry.out.reply) reply += `\n${retry.out.reply}`;
  }
  return { proj: res.proj, reply, log, errors: res.errors, assistant: raw, page: res.page };
}

export async function review(cfg, { proj, td, model }) {
  const issues = checkProject(proj).map(i => `- ${i.level}: ${i.pageNo ? `page ${i.pageNo}: ` : ''}${td(i.key, i.args)}`).join('\n') || 'none';
  const pages = proj.pages.filter(p => p.kind === 'schematic').map(p => describePage(proj, p)).join('\n\n').slice(0, 14000);
  const lang = { en: 'English', fi: 'Finnish', sv: 'Swedish', de: 'German' }[td.locale] || td.locale;
  const prompt = `You are a senior electrical design engineer reviewing an IEC control-panel drawing set.\n\n${describeProject(proj)}\n\n${pages}\n\nAUTOMATIC CHECK RESULTS:\n${issues}\n\nWrite a concise review in ${lang} (at most ~200 words) as bullet points: real problems first (protection and cable sizing, missing PE, coils without supply, contacts without coils, interlocks), then suggestions. Refer to devices by tag and page. Do not repeat the automatic checks verbatim.`;
  const r = await ollama(cfg, '/api/chat', { model: model || cfg.chatModel, messages: [{ role: 'user', content: prompt }], stream: false, options: { temperature: 0.3, num_ctx: 12288 } });
  return { text: r.message?.content || '' };
}

const VISION_SCHEMA = {
  type: 'object',
  properties: {
    components: { type: 'array', items: { type: 'object', properties: { tag: { type: 'string' }, sym: { type: 'string' }, value: { type: 'string' } }, required: ['tag', 'sym'] } },
    connections: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
  },
  required: ['components', 'connections'],
};

export async function vision(cfg, { proj, pageId, image, hint, model }) {
  const b64 = String(image).replace(/^data:[^,]+,/, '');
  const prompt = `This image shows an electrical schematic or a hand sketch. List every component and every wire connection.
Use ONLY these symbol ids (id: pins):
${symbolCatalog().split('\n').filter(l => !l.startsWith('#')).map(l => l.replace(/ — .*?; pins: /, ': ').replace(/; props.*$/, '')).join('\n')}
Give each component an IEC tag (-F1, -K1, -M1 ...). Connections use TAG:PIN.${hint ? `\nHint from the user: ${hint}` : ''}
Return JSON {"components":[{"tag","sym","value"}],"connections":[{"from","to"}]}.`;
  const r = await ollama(cfg, '/api/chat', { model: model || cfg.visionModel, messages: [{ role: 'user', content: prompt, images: [b64] }], stream: false, format: VISION_SCHEMA, options: { temperature: 0 } });
  const out = parseJSON(r.message?.content);
  const ops = [
    ...(out.components || []).map(c => ({ op: 'add', sym: c.sym, tag: c.tag, props: c.value ? { rating: c.value } : {} })),
    ...(out.connections || []).map(c => ({ op: 'connect', from: c.from, to: c.to })),
  ];
  const res = applyOps(proj, ops, { page: pageId });
  return { proj: res.proj, log: res.log, errors: res.errors, found: { components: out.components?.length || 0, connections: out.connections?.length || 0 } };
}
