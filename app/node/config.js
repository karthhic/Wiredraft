// config.json next to the exe. Created with defaults on first run.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

const FILE = path.join(ROOT, 'config.json');

export const DEFAULTS = {
  port: 5178,
  language: 'en',
  paper: 'A3',
  ollama: 'http://127.0.0.1:11434',
  portableOllamaPort: 11500,
  chatModel: 'qwen2.5-coder:7b',
  visionModel: 'qwen2.5vl:3b',
  openWindow: true,
};

export function loadConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
  const cfg = { ...DEFAULTS, ...file };
  if (process.env.OLLAMA_HOST) cfg.ollama = /^https?:/.test(process.env.OLLAMA_HOST) ? process.env.OLLAMA_HOST : `http://${process.env.OLLAMA_HOST}`;
  if (process.env.PORT) cfg.port = +process.env.PORT;
  if (!fs.existsSync(FILE)) { try { fs.writeFileSync(FILE, JSON.stringify({ ...DEFAULTS }, null, 2)); } catch { /* read-only media */ } }
  return cfg;
}

export function saveConfig(patch) {
  const cur = loadConfig();
  const next = { ...cur, ...patch };
  for (const k of Object.keys(next)) if (!(k in DEFAULTS)) delete next[k];
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}
