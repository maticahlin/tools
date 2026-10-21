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
