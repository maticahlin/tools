// diffmap core — pure color math, no DOM. Shared by the runtime, the setup page and the tests.
//
// Two engines produce the final effect:
//
//   1. Blend layers (every browser, every pixel on the page).
//      CSS blend modes work per channel, so the layers can compute any per-channel
//      affine map   out = A + (B − A) · in   with A, B ∈ [0,1]³.
//      A is what black turns into, B is what white turns into.
//        layer 1  multiply   |B − A|          → |D| · in
//        layer 2  difference X                 X = A where D ≤ 0, 1 − A where D > 0
//        layer 3  difference M                 M = 1 where D > 0, else 0
//      Classic "white difference" is A = white, B = black and collapses to one layer.
//
//   2. Node map (images / video you hand it).
//      A full RGB cube with 8 independent corner nodes, trilinear in between.
//      Image pixels are recolored with the node map and then pre-corrected with the
//      inverse of engine 1, because the blend layers still sit on top of them.
//
// Colors inside this module are [r, g, b] arrays in 0..1 (sRGB, not linearized —
// browsers composite blend modes in sRGB space).

export const CORNERS = /** @type {const} */ ([
  'black', 'red', 'green', 'blue', 'yellow', 'magenta', 'cyan', 'white',
]);

/** Input color of each corner node. */
export const CORNER_RGB = {
  black: [0, 0, 0], red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1],
  yellow: [1, 1, 0], magenta: [1, 0, 1], cyan: [0, 1, 1], white: [1, 1, 1],
};

/** Default node map = classic difference (every corner goes to its opposite). */
export function invertNodes() {
  const n = {};
  for (const k of CORNERS) n[k] = toHex(CORNER_RGB[k].map((v) => 1 - v));
  return n;
}

/** Ready-made node maps. Keys are what you pass to `--preset` or use in the setup page.
 *  Each is clamped into its own black/white range, so images render exactly. */
export const PRESETS = {
  classic: invertNodes(),
  ultramarine: { black: '#f4f2ff', white: '#14105a', red: '#14d6c0', cyan: '#f03d6e', green: '#f04fd8', magenta: '#22c46f', blue: '#f4d25a', yellow: '#2f3cff' },
  riso: { black: '#fff4e0', white: '#1d1d3b', red: '#1da95c', cyan: '#ff665e', green: '#ff48b0', magenta: '#1d78bf', blue: '#ffe83b', yellow: '#3255a4' },
  ember: { black: '#fff1d6', white: '#2a0a0a', red: '#2ab6d6', cyan: '#ff5a1f', green: '#ff2d55', magenta: '#2ac784', blue: '#ffb80a', yellow: '#4b2bd6' },
};

/**
 * Pull every node inside the per-channel range spanned by the black and white nodes.
 * That range is all the blend layers can reach, so after this images render exactly.
 */
export function fitToRange(nodes) {
  const n = normalizeNodes(nodes);
  const lo = n.black.map((v, i) => Math.min(v, n.white[i]));
  const hi = n.black.map((v, i) => Math.max(v, n.white[i]));
  const out = {};
  for (const k of CORNERS) out[k] = toHex(n[k].map((v, i) => Math.min(hi[i], Math.max(lo[i], v))));
  return out;
}

// ---------------------------------------------------------------- color parsing

export function parseColor(input) {
  if (Array.isArray(input)) return input.map(clamp01);
  const s = String(input).trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m) return [m[1], m[2], m[3]].map((v) => clamp01(Number(v) / 255));
  throw new Error(`diffmap: can't parse color "${input}" (use #rrggbb or rgb())`);
}

export function toHex(rgb) {
  return '#' + rgb.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
}

export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ---------------------------------------------------------------- compositing color space
//
// Blend modes run on the numbers of whatever color space the browser composites in, and
// that differs by platform: Windows and most Linux setups composite in sRGB, while browsers
// on macOS with a wide-gamut screen composite in Display P3. Same CSS, different math —
// the reason a difference cursor can look right on Windows and pink on a Mac.
// diffmap does its math in the space the browser actually blends in, so the colors that
// matter land exactly on both. Display P3 shares sRGB's transfer curve, only the primaries differ.

const decode = (v) => (Math.abs(v) <= 0.04045 ? v / 12.92 : Math.sign(v) * ((Math.abs(v) + 0.055) / 1.055) ** 2.4);
const encode = (v) => (Math.abs(v) <= 0.0031308 ? v * 12.92 : Math.sign(v) * (1.055 * Math.abs(v) ** (1 / 2.4) - 0.055));
const mul = (m, c) => m.map((row) => row[0] * c[0] + row[1] * c[1] + row[2] * c[2]);
const SRGB_TO_P3 = [[0.8224621, 0.177538, 0], [0.0331941, 0.9668058, 0], [0.0170827, 0.0723974, 0.9105199]];
const P3_TO_SRGB = invert3(SRGB_TO_P3);
function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [[A, -(b * i - c * h), b * f - c * e], [B, a * i - c * g, -(a * f - c * d)], [C, -(a * h - b * g), a * e - b * d]].map((r) => r.map((v) => v / det));
}

/** sRGB → Display P3 (both gamma-encoded, 0..1). */
export const srgbToP3 = (c) => mul(SRGB_TO_P3, c.map(decode)).map(encode);
/** Display P3 → sRGB; may leave 0..1 for colors outside sRGB. */
export const p3ToSrgb = (c) => mul(P3_TO_SRGB, c.map(decode)).map(encode);

/** Converters between sRGB (how you write colors) and the space blending happens in. */
export function spaceOf(space = 'srgb') {
  return space === 'display-p3'
    ? { name: 'display-p3', to: srgbToP3, from: p3ToSrgb }
    : { name: 'srgb', to: (c) => c, from: (c) => c };
}

/** A CSS color for a value in blending space. */
export function cssColor(c, space = 'srgb') {
  if (space === 'display-p3') return `color(display-p3 ${c.map((v) => v.toFixed(5)).join(' ')})`;
  return `rgb(${c.map((v) => (v * 255).toFixed(2)).join(', ')})`;
}

// ---------------------------------------------------------------- node map (engine 2)

/** Normalize a node map: missing corners fall back to the inverted default. */
export function normalizeNodes(nodes = {}) {
  const def = invertNodes();
  const out = {};
  for (const k of CORNERS) out[k] = parseColor(nodes[k] ?? def[k]);
  return out;
}

/**
 * Trilinear lookup in the 8-corner cube.
 * @param {Record<string, number[]>} n normalized nodes
 * @param {number[]} c input color
 */
export function lookup(n, [r, g, b]) {
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const c00 = lerp(n.black[i], n.red[i], r);
    const c10 = lerp(n.green[i], n.yellow[i], r);
    const c01 = lerp(n.blue[i], n.magenta[i], r);
    const c11 = lerp(n.cyan[i], n.white[i], r);
    out[i] = lerp(lerp(c00, c10, g), lerp(c01, c11, g), b);
  }
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- image recolor kernel
//
// Self-contained on purpose (no outside references): the runtime also ships it to a Web
// Worker as source text, so big images recolor off the main thread.

/** Parameters for recolorPixels from a resolved palette. */
export function recolorParams(resolved) {
  const n = resolved.nodes;
  return {
    n: [n.black, n.red, n.green, n.blue, n.yellow, n.magenta, n.cyan, n.white].flat(),
    a: [...resolved.fallback.a], d: [...resolved.fallback.d],
    p3: resolved.space === 'display-p3' ? SRGB_TO_P3.flat() : null,
  };
}

/** RGBA bytes in place: node map (sRGB) → blending space → pre-corrected for the layers. */
export function recolorPixels(px, { n, a, d, p3 }) {
  const dec = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = i / 255;
  const m = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) {
    const r = lut[px[i]], g = lut[px[i + 1]], b = lut[px[i + 2]];
    for (let ch = 0; ch < 3; ch++) {
      // trilinear over the 8 corners: black red green blue yellow magenta cyan white
      const k = (corner) => n[corner * 3 + ch];
      const c00 = k(0) + (k(1) - k(0)) * r, c10 = k(2) + (k(4) - k(2)) * r;
      const c01 = k(3) + (k(5) - k(3)) * r, c11 = k(6) + (k(7) - k(6)) * r;
      const lo = c00 + (c10 - c00) * g, hi = c01 + (c11 - c01) * g;
      m[ch] = lo + (hi - lo) * b;
    }
    if (p3) {
      const L = [dec(Math.max(0, m[0])), dec(Math.max(0, m[1])), dec(Math.max(0, m[2]))];
      for (let ch = 0; ch < 3; ch++) m[ch] = enc(Math.max(0, p3[ch * 3] * L[0] + p3[ch * 3 + 1] * L[1] + p3[ch * 3 + 2] * L[2]));
    }
    for (let ch = 0; ch < 3; ch++) {
      let v = Math.abs(d[ch]) < 1e-6 ? 0 : (m[ch] - a[ch]) / d[ch];
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      px[i + ch] = v * 255 + 0.5;
    }
  }
  return px;
}

// ---------------------------------------------------------------- fallback (engine 1)
//
// The fallback is a per-channel map  F(x) = clamp(a + d·x)  with any real a and d.
// When F stays inside 0..1 without clamping it needs 3 blend layers ("affine"):
//   multiply |d| → difference X → difference M
// When it has to clip (say red ↔ white, where green needs 1.078 − x) it uses up to 8
// ("clamped"), adding lighten / darken to clip and color-dodge to scale above 1:
//   difference P → lighten S → difference S → multiply K → color-dodge U → darken C → difference C → difference Q
// All of these are separable blend modes that every browser has supported for years.

export const AFFINE = ['multiply', 'difference', 'difference'];
export const CLAMPED = ['difference', 'lighten', 'difference', 'multiply', 'color-dodge', 'darken', 'difference', 'difference'];
const NEUTRAL = { multiply: 1, difference: 0, lighten: 0, darken: 1, 'color-dodge': 0, color: null };

/** Accept {a, d} or the older {A, B} (what black and white become). */
function ad(fb) {
  if (fb.a) return fb;
  return { a: fb.A, d: fb.B.map((b, i) => b - fb.A[i]) };
}

/** "affine" when 3 layers can draw it exactly, "clamped" when it needs the 8-layer stack. */
export function kindOf(fb) {
  const { a, d } = ad(fb);
  const e = 1e-9;
  return a.every((v, i) => v > -e && v < 1 + e && v + d[i] > -e && v + d[i] < 1 + e) ? 'affine' : 'clamped';
}

/** Build a fallback from per-channel intercept and slope. */
export function makeFallback(a, d, extra = {}) {
  return { a, d, A: a.map(clamp01), B: a.map((v, i) => clamp01(v + d[i])), ...extra };
}

/**
 * Fit the fallback to the node map. Corners count a little; anchors count a lot,
 * so two anchors land exactly whenever their inputs differ in a channel.
 * An anchor is a color (its target is the node map's output for it) or {from, to}.
 */
export function fitFallback(nodes, anchors = [], { cornerWeight = 1, space = 'srgb' } = {}) {
  const { to } = spaceOf(space); // everything is fitted in the space the browser blends in
  const pairs = anchors.map((x) => (x && !Array.isArray(x) && x.from !== undefined
    ? { x: to(parseColor(x.from)), y: to(parseColor(x.to)) }
    : { x: to(parseColor(x)), y: to(lookup(nodes, parseColor(x))) }));
  const samples = CORNERS.map((k) => ({ x: to(CORNER_RGB[k]), y: to(nodes[k]), w: cornerWeight }));
  for (const p of pairs) samples.push({ ...p, w: 1e6 });

  const a = [0, 0, 0], d = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const { x, y, w } of samples) {
      if (!w) continue;
      sw += w; sx += w * x[ch]; sy += w * y[ch];
      sxx += w * x[ch] * x[ch]; sxy += w * x[ch] * y[ch];
    }
    const den = sw * sxx - sx * sx;
    d[ch] = Math.abs(den) < 1e-9 * sw * sw ? 0 : (sw * sxy - sx * sy) / den;
    a[ch] = (sy - d[ch] * sx) / sw;
  }
  const fb = makeFallback(a, d);
  fb.exact = pairs.map((p) => maxDiff(applyFallback(fb, p.x), p.y) < 1.5 / 255);
  fb.error = 0;
  for (const s of samples) fb.error = Math.max(fb.error, maxDiff(applyFallback(fb, s.x), s.y));
  return fb;
}

export function applyFallback(fb, c) {
  const { a, d } = ad(fb);
  return c.map((v, i) => clamp01(a[i] + d[i] * v));
}

/**
 * Pre-correct a recolored pixel so that, after the blend layers run on top of it,
 * it ends up as `target` (as close as the fallback can reach).
 */
export function precorrect(fb, target, out = [0, 0, 0]) {
  const { a, d } = ad(fb);
  for (let i = 0; i < 3; i++) out[i] = Math.abs(d[i]) < 1e-6 ? 0 : clamp01((target[i] - a[i]) / d[i]);
  return out;
}

/** How much of the node map's output range the fallback can reproduce on images. */
export function coverage(fb, nodes) {
  let worst = 0;
  const p = [0, 0, 0];
  for (const k of CORNERS) {
    precorrect(fb, nodes[k], p);
    worst = Math.max(worst, maxDiff(applyFallback(fb, p), nodes[k]));
  }
  return worst; // 0 = images exact everywhere
}

const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

// ---------------------------------------------------------------- layer colors

/** One channel of the 8-layer stack for F(x) = clamp(a + d·x). */
// the "constant output" branch (multiply by 0)
const k0 = (L) => L[3] === 0;

function clampedChannel(a, d) {
  const inv = d < 0, k = Math.abs(d), b = inv ? a + d : a; // F = clamp(b + k·y), y = x or 1 − x
  const L = [inv ? 1 : 0, 0, 0, 1, 0, 1, 0, 0];
  const scale = () => { if (k <= 1) L[3] = k; else L[4] = 1 - 1 / k; };
  if (k < 1e-9 || b >= 1 || b + k <= 0) {          // constant output v
    const v = k < 1e-9 ? clamp01(b) : b >= 1 ? 1 : 0;
    L[0] = 0; L[3] = 0; L[5] = L[6] = 1 - v; L[7] = 1;
  } else if (b < 0) {                                // starts clipped at 0: shift down, then scale
    L[1] = L[2] = -b / k; scale();
  } else {                                           // starts above 0: scale, then shift up via 1 − max(0, c − w)
    scale(); L[5] = L[6] = 1 - b; L[7] = 1;
  }
  return L;
}

/** One channel of the 3-layer stack (valid while F stays inside 0..1). */
function affineChannel(a, d) {
  const up = d > 0;
  return [Math.abs(d), up ? 1 - a : a, up ? 1 : 0];
}

/**
 * Layer colors at effect strength t (0..1), one [r,g,b] per layer of `kind`.
 *
 * Soft edges: a pixel half-covered by every layer is not "half the effect" — blend layers
 * don't compose linearly, so anti-aliased rims come out as a colored fringe. The layers
 * stay opaque instead and the strength fades:  a_t = t·a,  d_t = 1 − t + t·d.
 * For affine fallbacks that is exactly c + t·(F(c) − c); for clamped ones it stays between
 * c and F(c). At t = 0 every layer is neutral, so whatever surrounds the layers doesn't matter.
 */
export function layersAt(fb, t = 1, kind = kindOf(fb)) {
  const { a, d } = ad(fb);
  const f = kind === 'affine' ? affineChannel : clampedChannel;
  const per = [0, 1, 2].map((i) => f(t * a[i], 1 - t + t * d[i]));
  return per[0].map((_, L) => [per[0][L], per[1][L], per[2][L]]);
}

/**
 * Strengths where a layer color changes branch as t goes 1 → 0. Between them affine
 * layer colors are linear in t (so gradients with stops here are exact); clamped ones are
 * smooth, and get extra stops in between.
 */
export function rampBreaks(fb, kind = kindOf(fb)) {
  const { a, d } = ad(fb);
  const ts = [];
  if (kind === 'affine') {
    for (let i = 0; i < 3; i++) if (d[i] < 0) { const tc = 1 / (1 - d[i]); if (tc < 1 - 1e-9) ts.push(tc); }
  } else {
    const state = (t) => [0, 1, 2].map((i) => {
      const L = clampedChannel(t * a[i], 1 - t + t * d[i]);
      return [L[0], L[7], L[3] === 0 && L[0] === 0 && L[7] === 1 && k0(L) ? 'C' : '', L[4] > 0 ? 'U' : 'K'].join('');
    }).join('|');
    const N = 400;
    let prev = state(1);
    for (let j = N - 1; j >= 0; j--) {
      const t = j / N, cur = state(t);
      if (cur !== prev) {
        let hi = (j + 1) / N, lo = t;              // bisect the switch
        for (let it = 0; it < 30; it++) { const m = (hi + lo) / 2; if (state(m) === prev) hi = m; else lo = m; }
        ts.push((hi + lo) / 2);
        prev = cur;
      }
    }
  }
  return [...new Set(ts)].filter((t) => t > 1e-6 && t < 1 - 1e-6).sort((x, y) => y - x);
}

/**
 * Gradient stops for a soft edge: [{t, at}] ordered from full strength (t = 1, inside) to 0
 * (the rim). `at` is the strength to evaluate the layer colors at: just past each branch
 * switch, on the side of the segment it belongs to, so every switch becomes a hard stop.
 */
export function edgeStops(fb, kind = kindOf(fb)) {
  const pts = [1, ...rampBreaks(fb, kind), 0];
  const out = [];
  const cols = (at) => layersAt(fb, at, kind).flat();
  for (let j = 0; j < pts.length - 1; j++) {
    const hi = pts[j], lo = pts[j + 1];
    const atHi = j > 0 ? hi - 1e-7 : hi, atLo = lo === 0 ? 1e-6 : lo + 1e-7;
    out.push({ t: hi, at: atHi });
    if (kind !== 'affine') {
      // clamped colors bend (1/k terms): split until straight lines between stops are within 1/4 level
      const split = (t0, a0, c0, t1, a1, c1, depth) => {
        const tm = (t0 + t1) / 2, cm = cols(tm);
        const bent = cm.some((v, i) => Math.abs(v - (c0[i] + c1[i]) / 2) > 0.25 / 255);
        if (!bent || depth > 12) return;
        split(t0, a0, c0, tm, tm, cm, depth + 1);
        out.push({ t: tm, at: tm });
        split(tm, tm, cm, t1, a1, c1, depth + 1);
      };
      split(hi, atHi, cols(atHi), lo, atLo, cols(atLo), 0);
    }
    out.push({ t: lo, at: atLo });
  }
  return out;
}

/** Indices of the layers of `kind` that do anything at some strength (the rest are skipped). */
export function activeLayers(fb, kind = kindOf(fb)) {
  const blends = kind === 'affine' ? AFFINE : CLAMPED;
  const used = new Set();
  const ts = [1, ...rampBreaks(fb, kind).flatMap((t) => [t + 1e-4, t - 1e-4]), ...Array.from({ length: 21 }, (_, j) => j / 20)];
  for (const t of ts) layersAt(fb, Math.min(1, Math.max(0, t)), kind).forEach((col, L) => {
    if (col.some((v) => Math.abs(v - NEUTRAL[blends[L]]) > 0.5 / 255)) used.add(L);
  });
  return [...used].sort((x, y) => x - y);
}

/**
 * The CSS blend layers at full strength, bottom → top, with no-op layers dropped.
 * @returns {Array<{blend:string, color:string}>}
 */
export function layers(fb, { duotone = false, space = 'srgb' } = {}) {
  const kind = kindOf(fb);
  const blends = kind === 'affine' ? AFFINE : CLAMPED;
  const cols = layersAt(fb, 1, kind);
  const out = [];
  // `color` with a neutral gray keeps only the backdrop's luminance
  if (duotone) out.push({ blend: 'color', color: '#808080' });
  cols.forEach((c, L) => {
    if (c.some((v) => Math.abs(v - NEUTRAL[blends[L]]) > 0.5 / 255)) out.push({ blend: blends[L], color: space === 'srgb' ? toHex(c) : cssColor(c, space) });
  });
  return out;
}

/**
 * Everything the runtime needs from a user config, resolved once.
 * @param {DiffmapPalette} palette
 */
export function resolvePalette(palette = {}, { space = 'srgb' } = {}) {
  const sp = spaceOf(space);
  let nodes = normalizeNodes(palette.nodes);
  let fb, media = true;
  const fromStops = (dark, light) => {
    const A = sp.to(parseColor(dark)), B = sp.to(parseColor(light));
    return makeFallback(A, B.map((v, i) => v - A[i]), { exact: [], error: NaN });
  };
  if (palette.mode === 'duotone') {
    const [dark = '#000000', light = '#ffffff'] = palette.stops ?? [];
    fb = fromStops(dark, light);
    media = false;
  } else if (palette.mode === 'swap') {
    // two colors trade places exactly; everything else follows the same per-channel line
    const [c1 = '#000000', c2 = '#ffffff'] = palette.colors ?? [];
    fb = fitFallback(nodes, [{ from: c1, to: c2 }, { from: c2, to: c1 }], { cornerWeight: 0, space });
    nodes = Object.fromEntries(CORNERS.map((k) => [k, sp.from(applyFallback(fb, sp.to(CORNER_RGB[k]))).map(clamp01)]));
    media = false; // images get the same map from the layers alone
  } else if (palette.fallback) {
    fb = fromStops(palette.fallback.black, palette.fallback.white);
  } else {
    fb = fitFallback(nodes, palette.anchors ?? [], { space });
  }
  const duotone = palette.mode === 'duotone';
  return {
    nodes, fallback: fb, duotone, media, space: sp.name, kind: kindOf(fb), layers: layers(fb, { duotone, space: sp.name }),
    /** what a page color (sRGB) turns into under the blend layers, back in sRGB */
    page: (c) => sp.from(applyFallback(fb, sp.to(c))).map(clamp01),
    toSpace: sp.to, fromSpace: sp.from,
  };
}

/**
 * @typedef {object} DiffmapPalette
 * @property {'difference'|'swap'|'duotone'} [mode]
 * @property {Partial<Record<typeof CORNERS[number], string>>} [nodes]  difference: what each corner turns into
 * @property {Array<string|{from:string,to:string}>} [anchors]  difference: colors that must land exactly
 *   (your text + background). A plain color lands on the node map; {from, to} lands on `to`.
 * @property {[string, string]} [colors]  swap: two colors that trade places exactly (e.g. brand red ↔ white)
 * @property {[string, string]} [stops]  duotone: [what dark becomes, what light becomes]
 * @property {{black:string, white:string}} [fallback]  override the fitted fallback
 */

/** Which space this browser most likely blends in. See README "Same on every platform". */
export function detectSpace(env = globalThis) {
  try {
    const nav = env.navigator ?? {};
    const mac = /Mac/i.test(nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? '');
    const wide = env.matchMedia?.('(color-gamut: p3)').matches;
    const firefox = /Firefox\//.test(nav.userAgent ?? '');
    return mac && wide && !firefox ? 'display-p3' : 'srgb';
  } catch { return 'srgb'; }
}
