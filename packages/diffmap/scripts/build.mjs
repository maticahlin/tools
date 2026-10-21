// Builds dist/: one minified ES module for bundlers and script tags, and reports its size.
import { build } from 'esbuild';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '../..');
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: [path.join(root, 'src/index.js')],
  outfile: path.join(out, 'diffmap.min.js'),
  bundle: true, minify: true, format: 'esm', target: ['es2020'], legalComments: 'none',
});
await build({
  entryPoints: [path.join(root, 'src/core.js')],
  outfile: path.join(out, 'core.min.js'),
  bundle: true, minify: true, format: 'esm', target: ['es2020'],
});
for (const f of ['diffmap.min.js', 'core.min.js']) {
  const buf = fs.readFileSync(path.join(out, f));
  console.log(`${f}: ${(buf.length / 1024).toFixed(1)} KB, ${(zlib.gzipSync(buf, { level: 9 }).length / 1024).toFixed(1)} KB gzipped`);
}
