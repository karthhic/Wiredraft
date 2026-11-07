// Image → vector tracing for the symbol editor (no dependencies).
//   centerline: binarise → Zhang-Suen thinning → walk the skeleton into polylines (single CAD lines)
//   outline:    binarise → marching squares → closed contours (for filled shapes)
// Then Ramer-Douglas-Peucker simplification and circle recognition. Output is in pixels.

const MAX_SIDE = 420;

/** Load an image file/data URL and return { gray, alpha, w, h, src } downscaled to MAX_SIDE. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      const gray = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) gray[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
      resolve({ gray, w, h, src: c.toDataURL('image/png') });
    };
    img.onerror = () => reject(new Error('could not read the image'));
    img.src = src;
  });
}

/** Otsu's threshold on a grayscale histogram. */
export function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; th = t; }
  }
  return th;
}

// ------------------------------------------------------------------ helpers
function binarise({ gray, w, h }, threshold, invert) {
  // padded by 2 px so thinning and contours never touch the border
  const W = w + 4, H = h + 4, bin = new Uint8Array(W * H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ink = invert ? gray[y * w + x] > threshold : gray[y * w + x] < threshold;
    if (ink) { bin[(y + 2) * W + x + 2] = 1; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return { bin, W, H, empty: x1 < 0 };
}

function thin(bin, W, H) {
  const at = (x, y) => bin[y * W + x];
  const del = [];
  for (let changed = true; changed;) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (!at(x, y)) continue;
        const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
        const b = p.reduce((s, v) => s + v, 0);
        if (b < 2 || b > 6) continue;
        let a = 0; for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
        if (a !== 1) continue;
        const [p2, , p4, , p6, , p8] = p;
        if (step === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
        del.push(y * W + x);
      }
      for (const i of del) bin[i] = 0;
      if (del.length) changed = true;
    }
  }
}

/** Walk a one-pixel skeleton into polylines (m-adjacency avoids fake junction triangles). */
function skeletonPaths(bin, W, H) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? bin[y * W + x] : 0);
  const nb = i => {
    const x = i % W, y = (i / W) | 0, out = [];
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (at(x + dx, y + dy)) out.push((y + dy) * W + x + dx);
    for (const [dx, dy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) if (at(x + dx, y + dy) && !at(x + dx, y) && !at(x, y + dy)) out.push((y + dy) * W + x + dx);
    return out;
  };
  const pts = []; for (let i = 0; i < bin.length; i++) if (bin[i]) pts.push(i);
  const N = new Map(pts.map(i => [i, nb(i)]));
  const used = new Set(), key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const walk = (a, b) => {
    const path = [a, b]; used.add(key(a, b));
    let prev = a, cur = b;
    while (N.get(cur).length === 2) {
      const next = N.get(cur).find(n => n !== prev && !used.has(key(cur, n)));
      if (next === undefined) break;
      used.add(key(cur, next)); path.push(next); prev = cur; cur = next;
    }
    return path;
  };
  const paths = [];
  for (const i of pts) if (N.get(i).length !== 2) for (const n of N.get(i)) if (!used.has(key(i, n))) paths.push(walk(i, n));
  for (const i of pts) for (const n of N.get(i)) if (!used.has(key(i, n))) paths.push(walk(i, n));   // closed loops
  // drop tiny spurs that thinning leaves at corners and stroke ends
  return paths.filter(p => p.length > 3 || (N.get(p[0]).length > 2 && N.get(p.at(-1)).length > 2))
    .map(p => p.map(i => [i % W - 2, ((i / W) | 0) - 2]));
}

/** Marching squares contours of a binary image. */
function contours(bin, W, H) {
  const v = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? bin[y * W + x] : 0);
  const segs = [];
  const T = (x, y) => [x + 0.5, y], R = (x, y) => [x + 1, y + 0.5], B = (x, y) => [x + 0.5, y + 1], L = (x, y) => [x, y + 0.5];
  for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
    const c = v(x, y) * 8 + v(x + 1, y) * 4 + v(x + 1, y + 1) * 2 + v(x, y + 1);
    const add = (a, b) => segs.push([a(x, y), b(x, y)]);
    switch (c) {
      case 1: case 14: add(L, B); break;
      case 2: case 13: add(B, R); break;
      case 3: case 12: add(L, R); break;
      case 4: case 11: add(T, R); break;
      case 6: case 9: add(T, B); break;
      case 7: case 8: add(L, T); break;
      case 5: add(L, T); add(B, R); break;
      case 10: add(T, R); add(L, B); break;
    }
  }
  const k = p => `${p[0]},${p[1]}`, map = new Map();
  segs.forEach((s, i) => { for (const p of s) { const kk = k(p); if (!map.has(kk)) map.set(kk, []); map.get(kk).push(i); } });
  const done = new Uint8Array(segs.length), out = [];
  for (let i = 0; i < segs.length; i++) {
    if (done[i]) continue;
    done[i] = 1;
    const path = [segs[i][0], segs[i][1]];
    for (let guard = 0; guard < 1e6; guard++) {
      const end = path.at(-1), next = (map.get(k(end)) || []).find(j => !done[j]);
      if (next === undefined) break;
      done[next] = 1;
      const s = segs[next];
      path.push(k(s[0]) === k(end) ? s[1] : s[0]);
    }
    if (path.length > 6) out.push(path.map(([x, y]) => [x - 2, y - 2]));
  }
  return out;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts.at(-1);
  const len = Math.hypot(bx - ax, by - ay);
  let dmax = -1, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = len < 1e-9 ? Math.hypot(px - ax, py - ay) : Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [pts[0], pts.at(-1)];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

function asCircle(pts) {
  const closed = Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 2.5;
  if (!closed || pts.length < 12) return null;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const rs = pts.map(([x, y]) => Math.hypot(x - cx, y - cy)), r = rs.reduce((s, v) => s + v, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((s, v) => s + (v - r) ** 2, 0) / rs.length);
  return r > 2 && sd / r < 0.09 ? { cx, cy, r } : null;
}

/**
 * Trace an image. opts: { threshold, invert, mode: 'centerline'|'outline', detail (px tolerance) }.
 * Returns { items: [{ kind: 'poly', pts, closed } | { kind: 'circle', cx, cy, r }], box: {x, y, w, h} } in image pixels.
 */
export function trace(image, { threshold, invert = false, mode = 'centerline', detail = 1.2 } = {}) {
  const { bin, W, H, empty } = binarise(image, threshold ?? otsu(image.gray), invert);
  if (empty) return { items: [], box: { x: 0, y: 0, w: image.w, h: image.h } };
  let raw;
  if (mode === 'outline') raw = contours(bin, W, H);
  else { thin(bin, W, H); raw = skeletonPaths(bin, W, H); }
  const items = [];
  for (const p of raw) {
    const c = asCircle(p);
    if (c) { items.push({ kind: 'circle', ...c }); continue; }
    const closed = p.length > 4 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1];
    let s = rdp(p, detail);
    if (s.length < 2) continue;
    const len = s.reduce((t, q, i) => (i ? t + Math.hypot(q[0] - s[i - 1][0], q[1] - s[i - 1][1]) : 0), 0);
    if (len < 2.5) continue;
    items.push({ kind: 'poly', pts: s, closed });
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const it of items) if (it.kind === 'circle') { grow(it.cx - it.r, it.cy - it.r); grow(it.cx + it.r, it.cy + it.r); } else it.pts.forEach(([x, y]) => grow(x, y));
  return { items, box: isFinite(x0) ? { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) } : { x: 0, y: 0, w: image.w, h: image.h } };
}

/**
 * Convert traced pixels to symbol primitives in mm, centred on the origin.
 * widthMM sets the symbol width; nearly horizontal/vertical segments are straightened.
 */
export function toPrims(result, { widthMM = 16, fill = false } = {}) {
  const { box, items } = result;
  const k = widthMM / box.w, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const q = v => Math.round(v * 4) / 4;
  const X = x => q((x - cx) * k), Y = y => q((y - cy) * k);
  const prims = [];
  for (const it of items) {
    if (it.kind === 'circle') { prims.push(['c', X(it.cx), Y(it.cy), Math.max(0.25, q(it.r * k))]); continue; }
    const pts = it.pts.map(([x, y]) => [X(x), Y(y)]);
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      if (Math.abs(dx) < Math.abs(dy) * 0.12) pts[i][0] = pts[i - 1][0];
      else if (Math.abs(dy) < Math.abs(dx) * 0.12) pts[i][1] = pts[i - 1][1];
    }
    const clean = pts.filter((p, i) => !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    if (clean.length < 2) continue;
    if (clean.length === 2 && !it.closed) prims.push(['l', ...clean[0], ...clean[1]]);
    else prims.push(['p', it.closed ? clean.slice(0, -1) : clean, it.closed, fill && it.closed ? { fill: true } : undefined]);
  }
  return { prims, box: { w: q(box.w * k), h: q(box.h * k) }, px2mm: k, center: [cx, cy] };
}
