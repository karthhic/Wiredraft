// Rule checks over the whole project. Returns [{ level, page, id, key, args }]
// where key/args are translated by the UI (check.* keys in the language files).

import { BY_ID } from './symbols.js';
import { shape, wiresAt } from './model.js';

const ORDER = { error: 0, warning: 1, info: 2 };
const PROTECTION_REQ = new Set(['mcb_1p', 'mcb_2p', 'mcb_3p', 'mcb_4p', 'fuse', 'mpcb_3p', 'rcd_2p', 'rcd_4p']);

export function checkProject(proj) {
  const out = [];
  const add = (level, page, id, key, args = {}) => out.push({ level, page: page?.id, pageNo: page?.number, id, key, args });

  const numbers = new Map();
  for (const page of proj.pages) {
    if (numbers.has(page.number)) add('error', page, null, 'check.dupPage', { n: page.number });
    numbers.set(page.number, page);
    if (!page.title) add('info', page, null, 'check.noTitle', { n: page.number });
  }

  const xrefNames = new Map(), mains = new Set(), auxTags = [], terms = new Map(), cores = new Map();
  for (const page of proj.pages) {
    if (page.kind === 'report') continue;
    for (const s of page.items.syms) {
      const sym = BY_ID[s.sym];
      if (!sym) { add('error', page, s.id, 'check.unknownSym', { sym: s.sym }); continue; }
      const pins = shape(proj, s).pins;
      if (!sym.xref && !sym.cable) {
        const open = pins.filter(p => !wiresAt(page, s.id, p.id).length).map(p => p.id);
        if (open.length === pins.length && pins.length) add('warning', page, s.id, 'check.notConnected', { tag: s.tag || sym.name });
        else if (open.length && !sym.box && pins.length <= 8 && sym.id !== 'node') add('warning', page, s.id, 'check.openPins', { tag: s.tag || sym.name, pins: open.join(', ') });
      } else if (sym.xref) {
        const n = (s.props?.name || '').trim();
        if (!n) add('warning', page, s.id, 'check.xrefNoName');
        else { xrefNames.set(n, [...(xrefNames.get(n) || []), { page, s }]); }
        if (!wiresAt(page, s.id, '1').length) add('warning', page, s.id, 'check.notConnected', { tag: n || sym.name });
      }
      if (sym.role === 'main' && s.tag) mains.add(s.tag);
      if (sym.role === 'aux' && s.tag) auxTags.push({ page, s });
      if (PROTECTION_REQ.has(sym.id) && !proj.devices[s.tag]?.rating) add('info', page, s.id, 'check.noRating', { tag: s.tag });
      if (sym.terminal) {
        const term = s.props?.term;
        if (!term) add('warning', page, s.id, 'check.noTermNo', { tag: s.tag });
        else {
          const k = `${s.tag}:${term}`;
          if (terms.has(k)) add('error', page, s.id, 'check.dupTerm', { tag: s.tag, term });
          terms.set(k, s);
        }
      }
    }
    for (const w of page.items.wires) {
      const c = w.props?.cable, core = w.props?.core;
      if (c && !proj.cables[c]) add('warning', page, w.id, 'check.cableMissing', { cable: c });
      if (c && core) {
        const k = `${c}:${core}`;
        const prev = cores.get(k);
        // the same core may continue through several wires of one net; flag it on different pages only
        if (prev && prev.page !== page) add('warning', page, w.id, 'check.coreTwice', { cable: c, core });
        cores.set(k, { page });
      }
    }
  }
  for (const [n, list] of xrefNames) if (list.length < 2) add('info', list[0].page, list[0].s.id, 'check.xrefAlone', { name: n });
  for (const { page, s } of auxTags) if (!mains.has(s.tag) && BY_ID[s.sym].id !== 'overload_nc') add('warning', page, s.id, 'check.noCoil', { tag: s.tag });
  for (const [tag, c] of Object.entries(proj.cables)) if (!c.length) out.push({ level: 'info', id: tag, key: 'check.noLength', args: { cable: tag } });

  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
