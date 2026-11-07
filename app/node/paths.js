// Folder layout. ROOT is the folder holding WireDraft.exe (or the repo root when run from source):
//   ROOT/app  ROOT/lang  ROOT/library  ROOT/projects  ROOT/resources  ROOT/config.json

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(process.env.WIREDRAFT_ROOT || path.join(APP, '..'));
export const LANG = path.join(ROOT, 'lang');
export const RESOURCES = path.join(ROOT, 'resources');
export const DATA = path.join(ROOT, 'data');
