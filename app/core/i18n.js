// Translation: flat dotted keys, {placeholders}, plurals via .one/.other (+ .few/.many),
// fallback to English, then to the key itself.

export function makeT(dict = {}, fallback = {}, locale = 'en') {
  let rules;
  try { rules = new Intl.PluralRules(locale); } catch { rules = new Intl.PluralRules('en'); }
  const get = k => dict[k] ?? fallback[k];
  const t = (key, args = {}) => {
    let s;
    if (typeof args.n === 'number') s = get(`${key}.${rules.select(args.n)}`) ?? get(`${key}.other`);
    s ??= get(key);
    if (s == null) return key.startsWith('drawing.') ? key.slice(key.lastIndexOf('.') + 1) : key;
    return String(s).replace(/\{(\w+)\}/g, (_, k) => args[k] ?? `{${k}}`);
  };
  t.locale = locale;
  t.has = k => get(k) != null;
  t.formatDate = iso => {
    if (!iso) return '';
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    if (isNaN(d)) return String(iso);
    try { return d.toLocaleDateString(locale, { year: 'numeric', month: 'numeric', day: 'numeric' }); } catch { return String(iso); }
  };
  return t;
}

/** Missing and unused keys of a translation compared with the English master. */
export function langReport(master, dict) {
  const base = k => k.replace(/\.(zero|one|two|few|many|other)$/, '');
  const mk = new Set(Object.keys(master)), dk = new Set(Object.keys(dict));
  const bases = new Set([...dk].map(base));
  return {
    missing: [...mk].filter(k => !dk.has(k) && !(/\.(one|other)$/.test(k) && bases.has(base(k)))),
    unused: [...dk].filter(k => !mk.has(k) && !mk.has(`${base(k)}.other`)),
  };
}
