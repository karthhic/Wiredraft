// Cross-references, computed from the model on every render (never stored).
//   interruption points  L1_F1 → 20.0
//   device views         coil lists its contacts; a contact shows /6.8 back to its coil

import { BY_ID } from './symbols.js';
import { column } from './frames.js';
import { paperOf } from './model.js';

export const posOf = (proj, page, x) => `${page.number}.${column(paperOf(proj, page), x)}`;

/**
 * Map "pageId/symbolId" → lines of cross-reference text (symbol ids are unique per page only).
 * out.links holds the same lines split into parts, where a part with `page` and `sym` links to that symbol.
 */
export function crossRefs(proj) {
  const out = new Map();
  out.links = new Map();
  const add = (id, parts) => {
    if (!out.has(id)) { out.set(id, []); out.links.set(id, []); }
    out.get(id).push(parts.map(p => p.t).join(''));
    out.links.get(id).push(parts);
  };
  const link = (page, s, prefix = '') => ({ t: prefix + posOf(proj, page, s.x), page: page.id, sym: s.id });

  const names = new Map(), tags = new Map();
  for (const page of proj.pages) {
    if (page.kind === 'report') continue;
    for (const s of page.items.syms) {
      const sym = BY_ID[s.sym];
      if (!sym) continue;
      if (sym.xref) {
        const n = (s.props?.name || '').trim();
        if (n) { if (!names.has(n)) names.set(n, []); names.get(n).push({ page, s }); }
      } else if (s.tag && !sym.noTag && !sym.cable) {
        if (!tags.has(s.tag)) tags.set(s.tag, []); tags.get(s.tag).push({ page, s, sym });
      }
    }
  }

  for (const list of names.values()) {
    if (list.length < 2) continue;
    for (const a of list) {
      const others = list.filter(b => b !== a).map(b => link(b.page, b.s));
      add(`${a.page.id}/${a.s.id}`, [{ t: '→ ' }, ...others.flatMap((o, i) => i ? [{ t: ', ' }, o] : [o])]);
    }
  }

  for (const list of tags.values()) {
    if (list.length < 2) continue;
    const mains = list.filter(v => v.sym.role === 'main');
    const auxes = list.filter(v => v.sym.role === 'aux');
    for (const a of auxes) for (const m of mains) add(`${a.page.id}/${a.s.id}`, [link(m.page, m.s, '/')]);
    for (const m of mains) for (const a of auxes) {
      const nums = a.s.props?.nums || (a.sym.id === 'main_contacts_3p' ? '1-6' : a.sym.pins.map(p => p.id).join('-'));
      const kind = a.sym.id === 'contact_nc' ? '⊥' : a.sym.id === 'main_contacts_3p' ? '⫴' : '⊤';
      add(`${m.page.id}/${m.s.id}`, [{ t: `${kind} ${nums} ` }, link(a.page, a.s, '/')]);
    }
  }
  return out;
}
