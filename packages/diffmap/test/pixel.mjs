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
};

// ------------------------------------------------------------------ comparison
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const px = (png, x, y) => { const i = (y * png.width + x) * 4; return [png.data[i] / 255, png.data[i + 1] / 255, png.data[i + 2] / 255]; };
const inRect = (x, y, [l, t, r, b], pad = 0) => x >= l - pad && x < r + pad && y >= t - pad && y < b + pad;

function compare(before, after, cx, cy, r, rects, pal) {
  const res = { page: [], image: [], edge: 0, n: 0 };
  const vis = new PNG({ width: 2 * r + 2, height: 2 * r + 2 });
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    if (x < 0 || y < 0 || x >= after.width || y >= after.height) continue;
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const b = px(before, x, y), a = px(after, x, y);
    const vi = ((y - Math.floor(cy - r)) * vis.width + (x - Math.floor(cx - r))) * 4;
    a.forEach((v, i) => (vis.data[vi + i] = v * 255)); vis.data[vi + 3] = 255;
    if (d > r - 2.5) { continue; } // anti-aliased rim: measured visually
    const onImage = inRect(x, y, rects.img) && !inRect(x, y, rects.cap, 4);
    if (inRect(x, y, rects.cap, 4)) continue; // text over image: mixed by design, checked visually
    let want;
    if (pal.duotone) {
      const L = 0.3 * b[0] + 0.59 * b[1] + 0.11 * b[2];
      want = pal.fallback.A.map((v, i) => v + (pal.fallback.B[i] - v) * L);
    } else if (onImage) {
      // the node map's output, as far as the fallback layers can reach it (see core.coverage)
      want = applyFallback(pal.fallback, precorrect(pal.fallback, lookup(pal.nodes, b)));
    } else want = applyFallback(pal.fallback, b);
    const err = Math.max(...a.map((v, i) => Math.abs(v - want[i]))) * 255;
    if (onImage && process.env.DEBUG) { const f = applyFallback(pal.fallback, b); (res.dbg ??= []).push(Math.max(...a.map((v, i) => Math.abs(v - f[i]))) * 255); }
    (onImage ? res.image : res.page).push(err);
  }
  const stat = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((p, q) => p - q);
    return { n: s.length, mean: +(s.reduce((p, q) => p + q, 0) / s.length).toFixed(2), p99: +s[Math.floor(s.length * 0.99)].toFixed(1), max: +s[s.length - 1].toFixed(1) };
  };
  if (res.dbg) console.log('   image vs fallback-only:', stat(res.dbg));
  return { page: stat(res.page), image: stat(res.image), vis };
}

// ------------------------------------------------------------------ main
const engines = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'webkit'];
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/test/fixture/index.html`;
const R = 130;
const report = [];
let failed = false;

for (const engine of engines) {
  let d;
  try { d = await driver(engine); } catch (e) { console.log(`\n${engine}: SKIPPED (${e.message.split('\n')[0]})`); continue; }
  console.log(`\n== ${engine} (${d.version})`);
  for (const [name, palette] of Object.entries(PALETTES)) {
    const pal = resolvePalette(palette);
    await d.open(`${url}?pos=${process.env.POS || "auto"}&video=${process.env.VIDEO ? 1 : ''}&size=${2 * R}&p=${encodeURIComponent(JSON.stringify(palette))}`);
    for (let i = 0; i < 50 && !(await d.eval('document.readyState === "complete" && !!window.__dm')); i++) await sleep(100);
    const rects = await d.eval('window.__rects()');
    // bring the image into the overlay's working state
    const ic = [(rects.img[0] + rects.img[2]) / 2, (rects.img[1] + rects.img[3]) / 2];
    await d.eval(`window.__move(${ic[0]}, ${ic[1]})`);
    if (!pal.duotone) {
      let ready = false;
      for (let i = 0; i < 50 && !(ready = await d.eval('window.__overlayReady()')); i++) await sleep(100);
      if (!ready) console.log('   overlay not ready:', JSON.stringify(await d.eval('window.__dm.inspect().media.map(m => ({state: m.state, visible: m.visible}))')));
    }
    await d.eval('window.__move(-500, -500)');
    await sleep(300);
    const beforeBuf = await d.shot();
    fs.writeFileSync(path.join(OUT, `${engine}-${name}-before.png`), beforeBuf);
    const before = PNG.sync.read(beforeBuf);
    const spots = {
      text: [380, 70], swatches: [300, 200], image: [ic[0] - 120, ic[1] - 40],
      'text-over-image': [rects.cap[0] + 140, rects.cap[1] + 20], dark: [rects.dark[0] + 200, rects.dark[1] + 120],
    };
    const check = async (spot, x, y, base, rc) => {
      await d.eval(`window.__move(${x}, ${y})`);
      await sleep(Number(process.env.SETTLE ?? 250));
      const after = PNG.sync.read(await d.shot());
      if (process.env.DEBUG) console.log('   dbg', JSON.stringify(await d.eval(`(() => { const o = document.querySelector('[data-diffmap-overlay]'); const cs = o && getComputedStyle(o); return { n: document.querySelectorAll('[data-diffmap-overlay]').length, media: window.__dm.inspect().media.map(m => [m.state, m.visible]), vis: cs && cs.visibility, clip: o && o.style.clipPath, rect: o && JSON.stringify(o.getBoundingClientRect()), bg: cs && cs.backgroundImage.slice(0, 40), bs: cs && cs.backgroundSize, parent: o && o.parentNode.tagName } })()`)));
      const c = compare(base, after, x, y, R, rc, pal);
      fs.writeFileSync(path.join(OUT, `${engine}-${name}-${spot}.png`), PNG.sync.write(c.vis));
      const ok = (s) => !s || (s.p99 <= 3 && s.max <= 8);
      if (!ok(c.page) || !ok(c.image)) failed = true;
      report.push({ engine, palette: name, spot, page: c.page, image: c.image });
      const fmt = (s) => (s ? `mean ${s.mean} p99 ${s.p99} max ${s.max} (${s.n}px)` : '—');
      console.log(`${ok(c.page) && ok(c.image) ? 'ok  ' : 'FAIL'} ${name.padEnd(8)} ${spot.padEnd(16)} page: ${fmt(c.page)} | image: ${fmt(c.image)}`);
    };
    for (const [spot, [x, y]] of Object.entries(spots)) await check(spot, x, y, before, rects);
    // scrolled page: the cursor must stay under the pointer and keep working
    await d.eval('window.__move(-500, -500)');
    await d.eval('window.scrollTo(0, 180)');
    await sleep(300);
    const rects2 = await d.eval('window.__rects()');
    const before2 = PNG.sync.read(await d.shot());
    await check('scrolled', (rects2.img[0] + rects2.img[2]) / 2 + 60, rects2.img[1] + 60, before2, rects2);
  }
  await d.close();
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
server.close();
process.exit(failed ? 1 : 0);
