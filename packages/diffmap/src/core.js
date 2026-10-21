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

// ---------------------------------------------------------------- fallback fit (engine 1)

/**
 * Fit the per-channel fallback  out = A + D·in  to the node map.
 * Every corner counts a little; `anchors` (your site's real text/background colors)
 * count a lot, so two anchors land exactly whenever that's possible.
 *
 * @param {Record<string, number[]>} nodes normalized nodes
 * @param {Array<number[]>} anchors input colors that must look right
 * @returns {{A:number[], B:number[], exact:boolean[], error:number}}
 */
export function fitFallback(nodes, anchors = []) {
  const samples = CORNERS.map((k) => ({ x: CORNER_RGB[k], y: nodes[k], w: 1 }));
  for (const a of anchors) samples.push({ x: a, y: lookup(nodes, a), w: 1000 });

  const A = [0, 0, 0];
  const B = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    // weighted least squares for y = a + d·x
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const { x, y, w } of samples) {
      sw += w; sx += w * x[ch]; sy += w * y[ch];
      sxx += w * x[ch] * x[ch]; sxy += w * x[ch] * y[ch];
    }
    const den = sw * sxx - sx * sx;
    let d = Math.abs(den) < 1e-12 ? 0 : (sw * sxy - sx * sy) / den;
    let a = (sy - d * sx) / sw;
    // A and B are layer colors, so both must be inside 0..1
    a = clamp01(a);
    const b = clamp01(a + d);
    A[ch] = a; B[ch] = b;
  }

  const fb = { A, B };
  const exact = anchors.map((c) => maxDiff(applyFallback(fb, c), lookup(nodes, c)) < 1.5 / 255);
  let error = 0;
  for (const s of samples) error = Math.max(error, maxDiff(applyFallback(fb, s.x), s.y));
  return { A, B, exact, error };
}

export function applyFallback({ A, B }, c) {
  return c.map((v, i) => A[i] + (B[i] - A[i]) * v);
}

/**
 * Pre-correct a recolored pixel so that, after the blend layers run on top of it,
 * it ends up as `target`.  Returns null for channels the fallback can't reach.
 */
export function precorrect({ A, B }, target, out = [0, 0, 0]) {
  for (let i = 0; i < 3; i++) {
    const d = B[i] - A[i];
    out[i] = Math.abs(d) < 1e-6 ? 0 : clamp01((target[i] - A[i]) / d);
  }
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

// ---------------------------------------------------------------- layer stack

/**
 * Turn a fallback into the CSS blend layers, bottom → top.
 * @param {{A:number[], B:number[]}} fb
 * @param {{duotone?: boolean}} opts duotone maps luminance instead of each channel
 * @returns {Array<{blend:string, color:string}>}
 */
export function layers({ A, B }, { duotone = false } = {}) {
  const D = B.map((b, i) => b - A[i]);
  const absD = D.map(Math.abs);
  const X = D.map((d, i) => (d > 0 ? 1 - A[i] : A[i]));
  const M = D.map((d) => (d > 0 ? 1 : 0));
  const out = [];
  // `color` with a neutral gray keeps only the backdrop's luminance
  if (duotone) out.push({ blend: 'color', color: '#808080' });
  if (absD.some((v) => Math.round(v * 255) !== 255)) out.push({ blend: 'multiply', color: toHex(absD) });
  if (X.some((v) => Math.round(v * 255) !== 0)) out.push({ blend: 'difference', color: toHex(X) });
  if (M.some((v) => v)) out.push({ blend: 'difference', color: toHex(M) });
  return out;
}

/**
 * Everything the runtime needs from a user config, resolved once.
 * @param {DiffmapPalette} palette
 */
export function resolvePalette(palette = {}) {
  const nodes = normalizeNodes(palette.nodes);
  const anchors = (palette.anchors ?? []).map(parseColor);
  let fb;
  if (palette.mode === 'duotone') {
    const [dark = '#000000', light = '#ffffff'] = palette.stops ?? [];
    fb = { A: parseColor(dark), B: parseColor(light), exact: [], error: NaN };
  } else if (palette.fallback) {
    fb = { A: parseColor(palette.fallback.black), B: parseColor(palette.fallback.white), exact: [], error: NaN };
  } else {
    fb = fitFallback(nodes, anchors);
  }
  return {
    nodes,
    fallback: fb,
    duotone: palette.mode === 'duotone',
    layers: layers(fb, { duotone: palette.mode === 'duotone' }),
  };
}

/**
 * @typedef {object} DiffmapPalette
 * @property {Partial<Record<typeof CORNERS[number], string>>} [nodes]  what each corner turns into
 * @property {string[]} [anchors]  your site's main colors (e.g. text + background) — fallback hits these exactly
 * @property {{black:string, white:string}} [fallback]  override the fitted fallback
 * @property {'difference'|'duotone'} [mode]
 * @property {[string, string]} [stops]  duotone only: [what dark becomes, what light becomes]
 */
