// Compact text views of the library, a page and a project, for LLM prompts and MCP output.

import { CATEGORIES, SYMBOLS, BY_ID } from './symbols.js';
import { shape } from './model.js';
import { crossRefs } from './xref.js';

export function symbolCatalog() {
  return CATEGORIES.map(cat => `# ${cat}\n` + SYMBOLS.filter(s => s.cat === cat).map(s => {
    const pins = s.box ? 'from props pinsTop/pinsBottom (comma lists)' : s.pins.map(p => p.id).join(',');
    const f = [...s.fields, ...s.local].join(',');
    return `${s.id} — ${s.name}${s.letter ? ` (tag -${s.letter}n)` : ''}; pins: ${pins || 'none'}${f ? `; props: ${f}` : ''}`;
  }).join('\n')).join('\n');
}

export function describePage(proj, page, xr = crossRefs(proj)) {
  const L = [`Page ${page.number} "${page.title}" (${page.kind}, paper ${page.paper || proj.meta.paper}, id ${page.id})`];
  if (page.kind === 'report') return L.concat(`  generated report: ${JSON.stringify(page.report)}`).join('\n');
  L.push(`Symbols (${page.items.syms.length}):`);
  for (const s of page.items.syms) {
    const sym = BY_ID[s.sym];
    const dev = proj.devices[s.tag] || {};
    const props = { ...dev, ...s.props };
    const p = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(' ');
    const pins = shape(proj, s).pins.map(x => x.id).join(',');
    const x = xr.get(`${page.id}/${s.id}`);
    L.push(`  ${s.id} ${s.tag || ''} [${sym?.id || s.sym}] @(${s.x},${s.y}) rot ${s.rot || 0} pins ${pins}${p ? ' ' + p : ''}${x ? ' xref ' + x.join(' ') : ''}`.replace(/\s+/g, ' '));
  }
  // endpoints as symbol-id pins (s2.A1), which resolve exactly; the tag form follows for readability
  const tagged = e => { const s = page.items.syms.find(x => x.id === e.s); return BY_ID[s?.sym]?.xref ? s.props?.name : `${s?.tag || BY_ID[s?.sym]?.id}:${e.p}`; };
  L.push(`Wires (${page.items.wires.length}):`);
  for (const w of page.items.wires) {
    const p = Object.entries(w.props || {}).map(([k, v]) => `${k}=${v}`).join(' ');
    L.push(`  ${w.id} ${w.a.s}.${w.a.p} — ${w.b.s}.${w.b.p}   (${tagged(w.a)} — ${tagged(w.b)})${p ? ' ' + p : ''}`);
  }
  if (page.items.texts.length) L.push(`Texts: ${page.items.texts.map(t => `${t.id} "${t.text}"`).join('; ')}`);
  return L.join('\n');
}

export function describeProject(proj) {
  const m = proj.meta;
  const L = [`Project "${proj.name}" — ${m.title} (paper ${m.paper}, drawing language ${m.language || 'follows the interface'}, rev ${proj.rev})`];
  L.push(`Pages: ${proj.pages.map(p => `${p.number} ${p.title}${p.kind !== 'schematic' ? ` [${p.kind}]` : ''}`).join(' | ')}`);
  const devs = Object.entries(proj.devices);
  if (devs.length) L.push(`Devices: ${devs.map(([t, d]) => `${t}${Object.keys(d).length ? ' ' + Object.entries(d).map(([k, v]) => `${k}=${v}`).join(',') : ''}`).join('; ')}`);
  const cab = Object.entries(proj.cables);
  if (cab.length) L.push(`Cables: ${cab.map(([t, c]) => `${t} ${c.type || ''} ${c.length ? c.length + 'm' : ''}`.trim()).join('; ')}`);
  return L.join('\n');
}
