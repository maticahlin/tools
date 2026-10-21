// The pilotprojekt.si case: a hover label over brand red rgb(255,20,8) and white.
// Old: the site's own label (display-p3 cyan, mix-blend-mode: difference).
// New: diffmap swap mode. Prints the glyph colors over each background and saves crops.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, driver, ROOT } from './drivers.mjs';
const { PNG } = createRequire(import.meta.url)('pngjs');
const OUT = path.join(ROOT, 'test/out'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const engines = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'webkit'];
const server = await serve();
let failed = false;
for (const engine of engines) {
  const d = await driver(engine);
  console.log(`== ${engine}`);
  for (const mode of ['old', 'diffmap']) {
    await d.open(`http://127.0.0.1:${server.address().port}/test/fixture/pilot.html?mode=${mode}&px=110`);
    for (let i = 0; i < 50 && !(await d.eval('!!window.__ready')); i++) await sleep(100);
    await sleep(500);
    await d.eval('window.__move(600, 400)'); await sleep(600);
    const png = PNG.sync.read(await d.shot());
    // glyph pixels = anything that isn't the plain backdrop; take the most common color per side
    const tally = { white: {}, red: {} };
    for (let y = 330; y < 470; y++) for (let x = 150; x < 1050; x++) {
      const i = (y * png.width + x) * 4, c = [png.data[i], png.data[i + 1], png.data[i + 2]];
      const side = x < 598 ? 'white' : x > 602 ? 'red' : null;
      if (!side) continue;
      const bg = side === 'white' ? [255, 255, 255] : [255, 20, 8];
      if (c.every((v, k) => Math.abs(v - bg[k]) < 3)) continue;
      const key = c.join(',');
      tally[side][key] = (tally[side][key] ?? 0) + 1;
    }
    const top = (t) => Object.entries(t).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
    const over = { white: top(tally.white), red: top(tally.red) };
    console.log(`  ${mode.padEnd(8)} glyphs over white: rgb(${over.white})   glyphs over red: rgb(${over.red})`);
    if (mode === 'diffmap') {
      const near = (s, t) => s.split(',').map(Number).every((v, k) => Math.abs(v - t[k]) <= 1);
      if (!near(over.white, [255, 20, 8]) || !near(over.red, [255, 255, 255])) failed = true;
    }
    // crop for the eye
    const c = new PNG({ width: 900, height: 140 });
    for (let y = 0; y < 140; y++) for (let x = 0; x < 900; x++) {
      const si = ((330 + y) * png.width + 150 + x) * 4, di = (y * 900 + x) * 4;
      for (let k = 0; k < 4; k++) c.data[di + k] = png.data[si + k];
    }
    fs.writeFileSync(path.join(OUT, `pilot-${engine}-${mode}.png`), PNG.sync.write(c));
  }
  await d.close();
}
server.close();
process.exit(failed ? 1 : 0);
