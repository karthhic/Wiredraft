// DWG through the free ODA File Converter (installed by the user under its own licence).
// Looked for in resources/tools/ODAFileConverter/ and the usual install folders.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { RESOURCES } from './paths.js';

export function findOda() {
  const local = path.join(RESOURCES, 'tools', 'ODAFileConverter', 'ODAFileConverter.exe');
  if (fs.existsSync(local)) return local;
  for (const base of ['C:/Program Files/ODA', 'C:/Program Files (x86)/ODA']) {
    try {
      for (const d of fs.readdirSync(base).filter(d => /ODAFileConverter/i.test(d)).sort().reverse()) {
        const exe = path.join(base, d, 'ODAFileConverter.exe');
        if (fs.existsSync(exe)) return exe;
      }
    } catch { /* not installed */ }
  }
  return null;
}

/** Convert every .dxf in inDir to .dwg (AutoCAD 2018 format) in outDir. */
export function dxfToDwg(inDir, outDir) {
  const exe = findOda();
  if (!exe) throw Object.assign(new Error('DWG export needs the ODA File Converter in resources/tools/ODAFileConverter/. DXF export works without it.'), { status: 501 });
  fs.mkdirSync(outDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const ch = spawn(exe, [inDir, outDir, 'ACAD2018', 'DWG', '0', '1', '*.DXF'], { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => { ch.kill(); reject(new Error('DWG conversion timed out')); }, 180000);
    ch.on('error', e => { clearTimeout(timer); reject(e); });
    ch.on('exit', () => { clearTimeout(timer); resolve(fs.readdirSync(outDir).filter(f => /\.dwg$/i.test(f)).map(f => path.join(outDir, f))); });
  });
}
