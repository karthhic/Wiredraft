// Builds the portable folder dist/WireDraft/ with WireDraft.exe (a Node single-executable application).
// The exe is a small launcher around the Node runtime; the app itself stays as plain files in app/,
// so lang/, library and projects remain editable next to it.
//
//   node build/build-exe.mjs            (Windows, Node 22+; downloads postject and rcedit via npx)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'WireDraft');
const TMP = path.join(ROOT, 'dist', '.build');
const exe = path.join(OUT, process.platform === 'win32' ? 'WireDraft.exe' : 'WireDraft');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
// npx is a .cmd on Windows and needs a shell; quote arguments with spaces for it
const q = a => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const run = (cmd, args) => {
  console.log('>', cmd, args.join(' '));
  const shell = cmd === npx && process.platform === 'win32';
  execFileSync(cmd, shell ? args.map(q) : args, { stdio: 'inherit', cwd: TMP, shell });
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

// 1. launcher script embedded in the exe
fs.writeFileSync(path.join(TMP, 'sea-main.cjs'), `
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.dirname(process.execPath);
process.env.WIREDRAFT_ROOT = process.env.WIREDRAFT_ROOT || root;
createRequire(path.join(root, 'app', 'boot.cjs'))('./boot.cjs');
`);
fs.writeFileSync(path.join(TMP, 'sea-config.json'), JSON.stringify({ main: 'sea-main.cjs', output: 'sea-prep.blob', disableExperimentalSEAWarning: true }));
run(process.execPath, ['--experimental-sea-config', 'sea-config.json']);

// 2. copy the Node runtime, set the icon, inject the blob
fs.copyFileSync(process.execPath, exe);
if (process.platform === 'win32') {
  try {
    // the rcedit package ships rcedit-x64.exe; install it into the temp folder (own package.json,
    // or npm walks up to the repo) and call it directly
    fs.writeFileSync(path.join(TMP, 'package.json'), '{"private":true}');
    execFileSync('npm.cmd', ['install', '--no-save', '--no-audit', '--no-fund', 'rcedit@4.0.1'], { cwd: TMP, stdio: 'inherit', shell: true });
    execFileSync(path.join(TMP, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'), [exe, '--set-icon', path.join(ROOT, 'assets', 'brand', 'wiredraft.ico'),
      '--set-version-string', 'ProductName', 'WireDraft', '--set-version-string', 'FileDescription', 'WireDraft electrical CAD',
      '--set-version-string', 'OriginalFilename', 'WireDraft.exe', '--set-file-version', '0.1.0', '--set-product-version', '0.1.0'], { stdio: 'inherit' });
  } catch { console.warn('! icon not set (rcedit failed); the exe still works'); }
}
run(npx, ['--yes', 'postject@1.0.0-alpha.6', exe, 'NODE_SEA_BLOB', 'sea-prep.blob', '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite']);

// 3. portable folder layout
const copy = (from, to = from) => fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true });
copy('app');
copy('lang');
copy('library');
copy('samples');
fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(OUT, 'README.md'));
const note = (dir, text) => { fs.mkdirSync(path.join(OUT, dir), { recursive: true }); fs.writeFileSync(path.join(OUT, dir, 'README.txt'), text); };
note('resources/runtime/ollama', 'Optional: put a portable Ollama here (ollama.exe and its lib folder from the ollama-windows-amd64.zip release).\nWireDraft starts it on 127.0.0.1:11500 with its models in resources/models.\nWithout it, WireDraft uses an installed Ollama if one is running.\n');
note('resources/models', 'Model store for the portable Ollama (manifests/ and blobs/).\nYou can copy these folders from C:\\Users\\<you>\\.ollama\\models, keeping only the models you need, e.g. qwen2.5-coder:7b and qwen2.5vl:3b.\n');
note('resources/tools/ODAFileConverter', 'Optional, for DWG export: install the free ODA File Converter (opendesign.com) and copy its program folder here, so that ODAFileConverter.exe is in this folder.\n');
fs.mkdirSync(path.join(OUT, 'projects'), { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true });

const mb = f => (fs.statSync(f).size / 1048576).toFixed(1);
console.log(`\nBuilt ${OUT}\n  ${path.basename(exe)} ${mb(exe)} MB\nCopy the whole WireDraft folder to a USB stick and run WireDraft.exe.`);
