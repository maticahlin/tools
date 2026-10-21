// Screenshot test/blend-check.html in a real browser, for humans to read (CI uploads it).
//   node test/blend-check.mjs [chromium|firefox|webkit]
import fs from 'node:fs';
import path from 'node:path';
import { serve, driver, ROOT } from './drivers.mjs';

const engine = process.argv[2] ?? 'chromium';
const OUT = path.join(ROOT, 'test/out'); fs.mkdirSync(OUT, { recursive: true });
// the page is written for the artifact skeleton; give it a document of its own here
const page = path.join(ROOT, 'test/out/blend-check.page.html');
fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>'
  + fs.readFileSync(path.join(ROOT, 'test/blend-check.html'), 'utf8').replace("from './src/core.js'", "from '/src/core.js'") + '</body></html>');
const server = await serve();
const d = await driver(engine);
await d.open(`http://127.0.0.1:${server.address().port}/test/out/blend-check.page.html`);
await new Promise((r) => setTimeout(r, 1500));
fs.writeFileSync(path.join(OUT, `blend-check-${engine}.png`), await d.shot());
console.log(`saved test/out/blend-check-${engine}.png`, await d.eval('navigator.userAgent'));
await d.close(); server.close();
