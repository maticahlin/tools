import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  layers, applyFallback, fitFallback, normalizeNodes, lookup, precorrect,
  invertNodes, parseColor, resolvePalette, CORNERS, CORNER_RGB, coverage,
} from '../src/core.js';

// --- reference implementation of the CSS compositing spec (W3C Compositing Level 1)
const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
function clipColor(c) {
  const l = lum(c), n = Math.min(...c), x = Math.max(...c);
  if (n < 0) c = c.map((v) => l + ((v - l) * l) / (l - n));
  if (x > 1) c = c.map((v) => l + ((v - l) * (1 - l)) / (x - l));
  return c;
}
const setLum = (c, l) => clipColor(c.map((v) => v + (l - lum(c))));
const BLEND = {
  multiply: (b, s) => b.map((v, i) => v * s[i]),
  difference: (b, s) => b.map((v, i) => Math.abs(v - s[i])),
  color: (b, s) => setLum(s, lum(b)),
  lighten: (b, s) => b.map((v, i) => Math.max(v, s[i])),
  darken: (b, s) => b.map((v, i) => Math.min(v, s[i])),
  'color-dodge': (b, s) => b.map((v, i) => (v === 0 ? 0 : s[i] >= 1 ? 1 : Math.min(1, v / (1 - s[i])))),
};
const composite = (backdrop, stack) =>
  stack.reduce((b, { blend, color }) => BLEND[blend](b, parseColor(color)), backdrop);

const rand = (seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647))(42);
const rcolor = () => [rand(), rand(), rand()];
const q = (c) => c.map((v) => Math.round(v * 255) / 255); // what a hex layer color can hold

test('blend stack reproduces A + (B − A)·in for random fallbacks', () => {
  for (let t = 0; t < 500; t++) {
    const fb = { A: q(rcolor()), B: q(rcolor()) };
    const stack = layers(fb);
    assert.ok(stack.length <= 3);
    for (let k = 0; k < 20; k++) {
      const c = rcolor();
      const got = composite(c, stack), want = applyFallback(fb, c);
      got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9, `${got} vs ${want}`));
    }
  }
});

test('classic white difference is a single layer', () => {
  const stack = layers({ A: [1, 1, 1], B: [0, 0, 0] });
  assert.deepEqual(stack, [{ blend: 'difference', color: '#ffffff' }]);
});

test('duotone maps luminance', () => {
  const fb = { A: q(rcolor()), B: q(rcolor()) };
  const stack = layers(fb, { duotone: true });
  for (let k = 0; k < 50; k++) {
    const c = rcolor();
    const want = fb.A.map((a, i) => a + (fb.B[i] - a) * lum(c));
    composite(c, stack).forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9));
  }
});

test('default nodes = classic difference, fallback exact everywhere', () => {
  const n = normalizeNodes();
  const fb = fitFallback(n);
  assert.ok(fb.error < 1e-9);
  assert.deepEqual(fb.A, [1, 1, 1]);
  assert.deepEqual(fb.B, [0, 0, 0]);
});

test('lookup hits every node exactly', () => {
  const n = normalizeNodes({ red: '#123456', cyan: '#abcdef' });
  for (const k of CORNERS) lookup(n, CORNER_RGB[k]).forEach((v, i) => assert.ok(Math.abs(v - n[k][i]) < 1e-12));
});

test('two anchors land exactly on the node map', () => {
  for (let t = 0; t < 200; t++) {
    const nodes = {};
    for (const k of CORNERS) nodes[k] = rcolor();
    const n = normalizeNodes(nodes);
    // a typical site: dark text on a light background
    const anchors = [[rand() * 0.2, rand() * 0.2, rand() * 0.2], [0.85 + rand() * 0.15, 0.85 + rand() * 0.15, 0.85 + rand() * 0.15]];
    const fb = fitFallback(n, anchors);
    // exact unless the line through both anchors leaves the 0..1 range
    for (let i = 0; i < 2; i++) {
      if (!fb.exact[i]) {
        const d = anchors.map((a) => lookup(n, a));
        const slope = d[1].map((v, ch) => (v - d[0][ch]) / (anchors[1][ch] - anchors[0][ch]));
        const a = d[0].map((v, ch) => v - slope[ch] * anchors[0][ch]);
        assert.ok(a.some((v, ch) => v < -1e-9 || v > 1 + 1e-9 || v + slope[ch] < -1e-9 || v + slope[ch] > 1 + 1e-9));
      }
    }
  }
});

test('pre-corrected image pixels come out as the node map after the blend layers', () => {
  const n = normalizeNodes({ red: '#ffd400', green: '#0a0a40', blue: '#ff2fa0' });
  const fb = fitFallback(n, [[0, 0, 0], [1, 1, 1]]);
  for (let k = 0; k < 200; k++) {
    const px = rcolor();
    const target = lookup(n, px);
    const p = precorrect(fb, target);
    const out = composite(p, layers(fb));
    const reachable = coverage(fb, n) < 1e-9;
    if (reachable) out.forEach((v, i) => assert.ok(Math.abs(v - target[i]) < 1e-9));
  }
});

test('resolvePalette end to end', () => {
  const r = resolvePalette({ nodes: invertNodes(), anchors: ['#111', '#fafafa'] });
  assert.deepEqual(r.layers, [{ blend: 'difference', color: '#ffffff' }]);
  const d = resolvePalette({ mode: 'duotone', stops: ['#1a1aff', '#ff5a36'] });
  assert.equal(d.layers[0].blend, 'color');
});

import { layersAt, rampBreaks } from '../src/core.js';

test('soft edge: layers at strength t compute c + t·(F(c) − c)', () => {
  for (let k = 0; k < 300; k++) {
    const fb = { A: q(rcolor()), B: q(rcolor()) };
    const t = rand();
    const [m, X, M] = layersAt(fb, t);
    const stack = [{ blend: 'multiply', color: m }, { blend: 'difference', color: X }, { blend: 'difference', color: M }];
    const c = rcolor();
    const F = applyFallback(fb, c);
    const want = c.map((v, i) => v + t * (F[i] - v));
    stack.reduce((b, { blend, color }) => BLEND[blend](b, color), c)
      .forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9));
  }
});

test('soft edge: at t = 0 the layers are an exact no-op (white, white, white)', () => {
  const [m, X, M] = layersAt({ A: [0.3, 0.9, 0.1], B: [0.8, 0.2, 0.5] }, 0);
  assert.deepEqual([m, X, M], [[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
});

test('soft edge: layer colors are linear in t between breaks, so CSS gradients are exact', () => {
  for (let k = 0; k < 200; k++) {
    const fb = { A: q(rcolor()), B: q(rcolor()) };
    const pts = [1, ...rampBreaks(fb), 0];
    for (let j = 0; j < pts.length - 1; j++) {
      const hi = pts[j] - 1e-7, lo = pts[j + 1] + 1e-7;
      const a = layersAt(fb, hi), b = layersAt(fb, lo);
      const mid = (hi + lo) / 2, c = layersAt(fb, mid);
      c.forEach((col, L) => col.forEach((v, i) => assert.ok(Math.abs(v - (a[L][i] + b[L][i]) / 2) < 1e-6)));
    }
  }
});


import { kindOf, CLAMPED, AFFINE } from '../src/core.js';
const runStack = (fb, t, c) => {
  const kind = kindOf(fb), blends = kind === 'affine' ? AFFINE : CLAMPED;
  return layersAt(fb, t, kind).reduce((b, col, L) => BLEND[blends[L]](b, col), c);
};

test('clamped fallback: 8-layer stack computes clamp(a + d·x) for any a, d', () => {
  for (let k = 0; k < 2000; k++) {
    const a = [0, 1, 2].map(() => (rand() - 0.5) * 6), d = [0, 1, 2].map(() => (rand() - 0.5) * 8);
    const fb = { a, d };
    const c = rcolor();
    const want = applyFallback(fb, c);
    runStack(fb, 1, c).forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9, `${a} ${d} ${c}: ${v} vs ${want[i]}`));
  }
});

test('clamped fallback: soft edge stays between the page and the full effect', () => {
  for (let k = 0; k < 2000; k++) {
    const fb = { a: [0, 1, 2].map(() => (rand() - 0.5) * 4), d: [0, 1, 2].map(() => (rand() - 0.5) * 6) };
    const c = rcolor(), t = rand(), full = applyFallback(fb, c);
    runStack(fb, t, c).forEach((v, i) => {
      const lo = Math.min(c[i], full[i]), hi = Math.max(c[i], full[i]);
      assert.ok(v > lo - 1e-9 && v < hi + 1e-9);
    });
    // and t = 0 is the identity
    runStack(fb, 0, c).forEach((v, i) => assert.ok(Math.abs(v - c[i]) < 1e-12));
  }
});

test('swap mode: brand red and white trade places exactly, through 8-bit layer colors', () => {
  for (const [c1, c2] of [['#ff1408', '#ffffff'], ['#e30613', '#ffffff'], ['#0047ff', '#f2efe8'], ['#111111', '#ffd400']]) {
    const r = resolvePalette({ mode: 'swap', colors: [c1, c2] });
    const run = (c) => r.layers.reduce((b, { blend, color }) => BLEND[blend](b, parseColor(color)), parseColor(c));
    const lv = (x, y) => Math.max(...x.map((v, i) => Math.abs(v - y[i]))) * 255;
    assert.ok(lv(run(c1), parseColor(c2)) <= 1.01, `${c1} → ${run(c1).map((v) => Math.round(v * 255))}`);
    assert.ok(lv(run(c2), parseColor(c1)) <= 1.01, `${c2} → ${run(c2).map((v) => Math.round(v * 255))}`);
  }
});

import { edgeStops, activeLayers } from '../src/core.js';

test('soft edge gradients: interpolating between the stops never leaves [page, full effect]', () => {
  for (let k = 0; k < 400; k++) {
    const fb = k % 2
      ? { a: [0, 1, 2].map(() => (rand() - 0.5) * 4), d: [0, 1, 2].map(() => (rand() - 0.5) * 6) }
      : resolvePalette({ mode: 'swap', colors: [rcolor(), rcolor()] }).fallback;
    const kind = kindOf(fb), blends = kind === 'affine' ? AFFINE : CLAMPED;
    const stops = edgeStops(fb, kind).map(({ t, at }) => ({ t, cols: layersAt(fb, at, kind) }));
    const c = rcolor(), F = applyFallback(fb, c);
    for (let j = 0; j <= 400; j++) {
      const t = 1 - j / 400;
      let i = 0; while (i < stops.length - 1 && stops[i + 1].t > t) i++;
      const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
      const f = a.t === b.t ? 0 : (a.t - t) / (a.t - b.t);
      const cols = a.cols.map((col, L) => col.map((v, ch) => v + (b.cols[L][ch] - v) * f));
      const out = cols.reduce((x, col, L) => BLEND[blends[L]](x, col), c);
      out.forEach((v, ch) => {
        const lo = Math.min(c[ch], F[ch]), hi = Math.max(c[ch], F[ch]);
        assert.ok(v > lo - 3 / 255 && v < hi + 3 / 255, `t=${t} ch=${ch} ${v} not in [${lo}, ${hi}]`);
      });
    }
  }
});

import { srgbToP3, p3ToSrgb } from '../src/core.js';

// A browser that composites in `space`: page colors are converted in, blended there, shown.
const blendIn = (space, stack, srgb) => {
  const to = space === 'display-p3' ? srgbToP3 : (c) => c, from = space === 'display-p3' ? p3ToSrgb : (c) => c;
  const kind = kindOf(stack.fb), blends = kind === 'affine' ? AFFINE : CLAMPED;
  const out = layersAt(stack.fb, 1, kind).reduce((b, col, L) => BLEND[blends[L]](b, col), to(srgb));
  return from(out).map((v) => Math.min(1, Math.max(0, v)));
};
const lv = (x, y) => Math.max(...x.map((v, i) => Math.abs(v - y[i]))) * 255;

test('color spaces: sRGB ↔ Display P3 round-trips', () => {
  for (let k = 0; k < 200; k++) { const c = rcolor(); p3ToSrgb(srgbToP3(c)).forEach((v, i) => assert.ok(Math.abs(v - c[i]) < 1e-6)); }
});

test('same on every platform: swap math done in the blending space is exact in both', () => {
  const red = parseColor('#ff1408'), white = [1, 1, 1];
  for (const space of ['srgb', 'display-p3']) {
    const r = resolvePalette({ mode: 'swap', colors: ['#ff1408', '#ffffff'] }, { space });
    assert.ok(lv(blendIn(space, { fb: r.fallback }, red), white) < 0.5, `${space}: red → white`);
    assert.ok(lv(blendIn(space, { fb: r.fallback }, white), red) < 0.5, `${space}: white → red`);
  }
  // and the wrong assumption is visibly off, which is the macOS/Windows bug
  const srgbMath = resolvePalette({ mode: 'swap', colors: ['#ff1408', '#ffffff'] }, { space: 'srgb' });
  assert.ok(lv(blendIn('display-p3', { fb: srgbMath.fallback }, red), white) > 10);
});

import { recolorPixels, recolorParams } from '../src/core.js';

test('recolor kernel matches lookup → space → precorrect, in sRGB and P3', () => {
  for (const space of ['srgb', 'display-p3']) {
    const r = resolvePalette({ nodes: { red: '#ffd400', green: '#2b2bd9', blue: '#ff2f7a', black: '#f4efe6', white: '#141414' }, anchors: ['#000', '#fff'] }, { space });
    const px = new Uint8ClampedArray(4 * 500);
    for (let i = 0; i < px.length; i++) px[i] = Math.floor(rand() * 256);
    const ref = Uint8ClampedArray.from(px);
    recolorPixels(px, recolorParams(r));
    for (let i = 0; i < px.length; i += 4) {
      const want = precorrect(r.fallback, r.toSpace(lookup(r.nodes, [ref[i] / 255, ref[i + 1] / 255, ref[i + 2] / 255])));
      for (let ch = 0; ch < 3; ch++) assert.ok(Math.abs(px[i + ch] - Math.round(want[ch] * 255)) <= 1, `${space} ${px[i + ch]} vs ${want[ch] * 255}`);
    }
  }
});
