// Rough performance numbers: JS time per cursor frame, and how long images take to recolor.
//   node test/bench.mjs [chromium|webkit]
import { serve, driver } from './drivers.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const engine = process.argv[2] ?? 'chromium';
const server = await serve();
const d = await driver(engine);
const P = {
  custom: { nodes: { black: '#f4efe6', white: '#141414', red: '#ffd400', green: '#2b2bd9', blue: '#ff2f7a' }, anchors: ['#000', '#fff'] },
  swap: { mode: 'swap', colors: ['#ff1408', '#ffffff'] },
};
for (const big of ['', '1']) for (const [name, palette] of Object.entries(P)) for (const cur of ['circle', 'text']) {
  if (big && (cur !== 'circle' || name !== 'custom')) continue;
  await d.open(`http://127.0.0.1:${server.address().port}/test/fixture/index.html?big=${big}&cur=${cur === 'circle' ? '' : cur}&size=120&p=${encodeURIComponent(JSON.stringify(palette))}`);
  for (let i = 0; i < 50 && !(await d.eval('!!window.__dm')); i++) await sleep(100);
  // longest main-thread stall while the photo is recolored (a jank meter: rAF gaps)
  await d.eval(`(window.__gaps = [], (function loop(t0) { requestAnimationFrame((t) => { if (t0) window.__gaps.push(t - t0); loop(t); }); })())`);
  // time from the first hover until the photo's recolored copy is ready
  const t0 = Date.now();
  await d.eval('window.__move(400, 500)');
  for (let i = 0; i < 200 && !(await d.eval('window.__overlayReady()')); i++) await sleep(25);
  const ready = Date.now() - t0;
  // 300 moves along a path, one per animation frame, with easing on
  await d.eval(`new Promise((res) => { let i = 0; const step = () => { const x = 100 + (i * 3.37) % 1000, y = 100 + (i * 1.91) % 600; window.__move(x, y); if (++i < 300) requestAnimationFrame(step); else setTimeout(res, 300); }; requestAnimationFrame(step); })`);
  const s = await d.eval('window.__dm.inspect().perf');
  const gap = await d.eval('Math.max(...window.__gaps)');
  console.log(`${engine} ${(big ? 'big ' : '') + name} ${cur}: JS per frame avg ${s.avgMs.toFixed(3)} ms, worst ${s.worstMs.toFixed(2)} ms | image ready ${ready} ms | longest frame gap ${gap.toFixed(0)} ms`);
}
await d.close(); server.close();
