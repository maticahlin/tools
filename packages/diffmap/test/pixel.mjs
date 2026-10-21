// Pixel test: screenshot the page with and without the cursor in real browser engines and
// check every pixel inside the circle against the math.
//
//   node test/pixel.mjs [chromium|webkit|firefox ...]
//
// Engines are found like this (override with env vars):
//   chromium  CHROMIUM_PATH, else Playwright's own Chromium, else @sparticuz/chromium
//   firefox   Playwright's own Firefox
//   webkit    Playwright's own WebKit, else WebKitGTK's WebKitWebDriver + MiniBrowser (Linux)

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolvePalette, applyFallback, lookup, precorrect } from '../src/core.js';
import { serve, driver, ROOT } from './drivers.mjs';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const OUT = path.join(ROOT, 'test/out');
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ palettes under test
const PALETTES = {
  classic: {},
  custom: {
    nodes: {
      black: '#f4efe6', white: '#141414', red: '#ffd400', green: '#2b2bd9',
      blue: '#ff2f7a', yellow: '#0d0d3a', magenta: '#18a058', cyan: '#e8401c',
    },
    anchors: ['#000000', '#ffffff'],
  },
  duotone: { mode: 'duotone', stops: ['#1a1aff', '#ff5a36'] },
  swap: { mode: 'swap', colors: ['#ff1408', '#ffffff'] },   // clamped 8-layer stack
};

// ------------------------------------------------------------------ comparison
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const px = (png, x, y) => { const i = (y * png.width + x) * 4; return [png.data[i] / 255, png.data[i + 1] / 255, png.data[i + 2] / 255]; };
const inRect = (x, y, [l, t, r, b], pad = 0) => x >= l - pad && x < r + pad && y >= t - pad && y < b + pad;

const lumOf = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const EDGE = 1.25; // runtime default

/** What the cursor should produce over backdrop pixel b, fully inside the effect. */
function target(pal, b, onImage) {
  if (pal.duotone) return pal.fallback.A.map((v, i) => v + (pal.fallback.B[i] - v) * lumOf(b));
  // on images: the node map, as far as the fallback layers can reach it (see core.coverage)
  if (onImage && pal.media) return applyFallback(pal.fallback, precorrect(pal.fallback, lookup(pal.nodes, b)));
  return applyFallback(pal.fallback, b);
}

/** How far a pixel sits outside the per-channel range spanned by the allowed colors (in 0..255). */
function outside(a, allowed) {
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    const lo = Math.min(...allowed.map((c) => c[i])), hi = Math.max(...allowed.map((c) => c[i]));
    worst = Math.max(worst, a[i] < lo ? lo - a[i] : a[i] > hi ? a[i] - hi : 0);
  }
  return worst * 255;
}

/** Colors a rim pixel may legitimately be a mix of: the untouched page and the full effect. */
function allowedMix(pal, b, onImage) {
  const set = [b, target(pal, b, onImage)];
  if (onImage && pal.media) set.push(applyFallback(pal.fallback, b));
  if (pal.duotone) { const L = lumOf(b); set.push([L, L, L], applyFallback(pal.fallback, b)); }
  return set;
}

const stat = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((p, q) => p - q);
  return { n: s.length, mean: +(s.reduce((p, q) => p + q, 0) / s.length).toFixed(2), p99: +s[Math.floor(s.length * 0.99)].toFixed(1), max: +s[s.length - 1].toFixed(1) };
};

function crop(png, l, t, w, h) {
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((t + y) * png.width + (l + x)) * 4, di = (y * w + x) * 4;
    for (let k = 0; k < 4; k++) out.data[di + k] = (l + x >= 0 && t + y >= 0 && l + x < png.width && t + y < png.height) ? png.data[si + k] : 0;
  }
  return out;
}

function compareCircle(before, after, cx, cy, r, rects, pal) {
  const res = { page: [], image: [], rim: [] };
  for (let y = Math.floor(cy - r - 3); y <= cy + r + 3; y++) for (let x = Math.floor(cx - r - 3); x <= cx + r + 3; x++) {
    if (x < 0 || y < 0 || x >= after.width || y >= after.height) continue;
    if (inRect(x, y, rects.cap, 4)) continue; // text over image: mixed by design, checked visually
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const b = px(before, x, y), a = px(after, x, y);
    const onImage = inRect(x, y, rects.img);
    if (d > r - EDGE - 1.5) { // the rim: anything between "untouched" and "full effect" is fine, a fringe is not
      res.rim.push(outside(a, allowedMix(pal, b, onImage)));
      continue;
    }
    const want = target(pal, b, onImage);
    const err = Math.max(...a.map((v, i) => Math.abs(v - want[i]))) * 255;
    (onImage ? res.image : res.page).push(err);
    if (err > 8 && (res.bad ??= []).length < 12) {
      const rgb = (c) => c.map((v) => Math.round(v * 255)).join(',');
      res.bad.push(`(${x},${y}) d=${(r - d).toFixed(1)} before ${rgb(b)} after ${rgb(a)} want ${rgb(want)}`);
    }
  }
  return { page: stat(res.page), image: stat(res.image), rim: stat(res.rim), bad: res.bad, vis: crop(after, Math.floor(cx - r - 4), Math.floor(cy - r - 4), 2 * r + 9, 2 * r + 9) };
}

function compareText(before, after, box, rects, pal) {
  const res = { mix: [], full: 0 };
  const [l, t, rr, bb] = box.map(Math.round);
  for (let y = t; y < bb; y++) for (let x = l; x < rr; x++) {
    if (x < 0 || y < 0 || x >= after.width || y >= after.height || inRect(x, y, rects.cap, 4)) continue;
    const b = px(before, x, y), a = px(after, x, y);
    const onImage = inRect(x, y, rects.img);
    res.mix.push(outside(a, allowedMix(pal, b, onImage)));
    const want = target(pal, b, onImage);
    if (Math.max(...a.map((v, i) => Math.abs(v - want[i]))) * 255 <= 3) res.full++;
  }
  return { rim: stat(res.mix), full: res.full, vis: crop(after, l - 4, t - 4, rr - l + 8, bb - t + 8) };
}

function compareImage(before, after, box, paint, pal) {
  const errs = [];
  const [l, t] = box.map(Math.round);
  // out = F(|page − picture|): with the classic palette, white page = picture as is, black = inverted
  const G = pal.fallback;
  for (let y = 0; y < paint.height; y++) for (let x = 0; x < paint.width; x++) {
    const X = l + x, Y = t + y;
    if (X < 0 || Y < 0 || X >= after.width || Y >= after.height) continue;
    const b = px(before, X, Y), a = px(after, X, Y), S = px(paint, x, y);
    const diff = b.map((v, i) => Math.abs(v - S[i]));
    const want = pal.duotone
      ? G.a.map((v, i) => Math.min(1, Math.max(0, v + G.d[i] * lumOf(diff))))
      : applyFallback(G, diff);
    errs.push(Math.max(...a.map((v, i) => Math.abs(v - want[i]))) * 255);
  }
  return { page: stat(errs), vis: crop(after, l - 4, t - 4, paint.width + 8, paint.height + 8) };
}

// ------------------------------------------------------------------ main
const engines = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'webkit'];
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/test/fixture/index.html`;
const R = 130;
const report = [];
let failed = false;
const annotate = [];
const paint = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'test/fixture/paint.png')));
const fmt = (s) => (s ? `p99 ${s.p99} max ${s.max}` : '—');
const okErr = (s) => !s || (s.p99 <= 3 && s.max <= 8);
const okRim = (s) => !s || s.max <= 6;

for (const engine of engines) {
  let d;
  try { d = await driver(engine); } catch (e) { console.log(`\n${engine}: SKIPPED (${e.message.split('\n')[0]})`); continue; }
  console.log(`\n== ${engine} (${d.version})`);
  const cursors = (process.env.CURSORS ?? 'circle,text,image').split(',');
  for (const cur of cursors) for (const [name, palette] of Object.entries(PALETTES).filter(([n]) => !process.env.PALETTES || process.env.PALETTES.split(',').includes(n))) {
    if (cur !== 'circle' && name === 'classic') continue;
    const pal = resolvePalette(palette);
    await d.open(`${url}?cur=${cur}&pos=${process.env.POS || 'auto'}&dist=${process.env.DIST ? 1 : ''}&video=${process.env.VIDEO ? 1 : ''}&size=${2 * R}&p=${encodeURIComponent(JSON.stringify(palette))}`);
    for (let i = 0; i < 50 && !(await d.eval('document.readyState === "complete" && !!window.__dm')); i++) await sleep(100);
    const rects = await d.eval('window.__rects()');
    const ic = [(rects.img[0] + rects.img[2]) / 2, (rects.img[1] + rects.img[3]) / 2];
    await d.eval(`window.__move(${ic[0]}, ${ic[1]})`);
    if (pal.media && cur !== 'image') for (let i = 0; i < 50 && !(await d.eval('window.__overlayReady()')); i++) await sleep(100);
    await sleep(cur === 'image' ? 500 : 0);
    await d.eval('window.__move(-500, -500)');
    await sleep(300);
    const before = PNG.sync.read(await d.shot());
    const spots = {
      text: [380, 90], swatches: [300, 200], image: [ic[0] - 120, ic[1] - 40],
      'text-over-image': [rects.cap[0] + 140, rects.cap[1] + 20], dark: [rects.dark[0] + 200, rects.dark[1] + 120],
    };
    for (const [spot, [x, y]] of Object.entries(spots)) {
      await d.eval(`window.__move(${x}, ${y})`);
      await sleep(Number(process.env.SETTLE ?? 250));
      const after = PNG.sync.read(await d.shot());
      let line, ok, c;
      if (cur === 'circle') {
        c = compareCircle(before, after, x, y, R, rects, pal);
        ok = okErr(c.page) && okErr(c.image) && okRim(c.rim);
        line = `page ${fmt(c.page)} | image ${fmt(c.image)} | rim ${fmt(c.rim)}`;
      } else if (cur === 'text') {
        c = compareText(before, after, await d.eval('window.__layerRect()'), rects, pal);
        ok = okRim(c.rim) && c.full > 500;
        line = `glyph edges ${fmt(c.rim)} | ${c.full}px at full effect`;
      } else {
        c = compareImage(before, after, await d.eval('window.__layerRect()'), paint, pal);
        ok = okErr(c.page);
        line = `|page − painting| mapped: ${fmt(c.page)}`;
      }
      if (!ok) failed = true;
      fs.writeFileSync(path.join(OUT, `${engine}-${cur}-${name}-${spot}.png`), PNG.sync.write(c.vis));
      report.push({ engine, cursor: cur, palette: name, spot, ...Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'vis' && k !== 'bad')) });
      const row = `${ok ? 'ok  ' : 'FAIL'} ${cur.padEnd(6)} ${name.padEnd(8)} ${spot.padEnd(16)} ${line}`;
      console.log(row);
      if (!ok || process.env.ANNOTATE_ALL) annotate.push(row);
      if (!ok && c.bad) for (const b of c.bad) { console.log('     ' + b); annotate.push('     ' + b); }
    }
  }
  await d.close();
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
if (process.env.GITHUB_ACTIONS) {
  // annotations are readable through the API even where raw logs aren't
  const esc = (t) => t.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const lines = annotate.join('\n');
  console.log(`::${failed ? 'error' : 'notice'} title=pixel ${engines.join(',')}::${esc(lines.slice(0, 60000))}`);
}
server.close();
process.exit(failed ? 1 : 0);
