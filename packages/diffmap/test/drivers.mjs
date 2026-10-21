// Browser drivers + static server shared by the pixel test and probes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

// ------------------------------------------------------------------ static server
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.webm': 'video/webm', '.mp4': 'video/mp4', '.css': 'text/css', '.svg': 'image/svg+xml' };
export function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.startsWith('/test/') || p.startsWith('/src/') || p.startsWith('/setup/') || p.startsWith('/dist/')) {
        const f = path.join(ROOT, p);
        if (fs.existsSync(f)) {
          const type = TYPES[path.extname(f)] ?? 'application/octet-stream';
          const size = fs.statSync(f).size;
          const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
          if (m) { // media elements need range requests
            const start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : size - 1;
            rsp.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
            return fs.createReadStream(f, { start, end }).pipe(rsp);
          }
          rsp.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
          return fs.createReadStream(f).pipe(rsp);
        }
      }
      rsp.writeHead(404).end();
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

// ------------------------------------------------------------------ drivers
async function playwrightDriver(name) {
  const pw = require('playwright-core');
  let executablePath;
  if (name === 'chromium') {
    executablePath = process.env.CHROMIUM_PATH;
    if (!executablePath && !fs.existsSync(pw.chromium.executablePath())) {
      executablePath = await (await import('@sparticuz/chromium')).default.executablePath();
    }
  }
  const browser = await pw[name].launch({ executablePath, args: name === 'chromium' ? [`--force-color-profile=${process.env.PROFILE || 'srgb'}`, '--disable-lcd-text'] : [] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  return {
    version: browser.version(),
    open: (u) => page.goto(u, { waitUntil: 'load' }),
    eval: (js) => page.evaluate(js),
    shot: () => page.screenshot(),
    close: () => browser.close(),
  };
}

async function webkitGtkDriver() {
  const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1600x1200x24'], { stdio: 'ignore' });
  const port = 4444 + Math.floor(Math.random() * 1000);
  const drv = spawn('WebKitWebDriver', [`--port=${port}`], { stdio: 'ignore', env: { ...process.env, DISPLAY: ':99' } });
  await new Promise((r) => setTimeout(r, 1500));
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const j = await r.json();
    if (j.value?.error) throw new Error(`${j.value.error}: ${j.value.message}`);
    return j.value;
  };
  const sess = await call('POST', '/session', { capabilities: { alwaysMatch: { 'webkitgtk:browserOptions': {
    binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } });
  const id = sess.sessionId;
  await call('POST', `/session/${id}/window/rect`, { width: 1200, height: 900 });
  return {
    version: `WebKitGTK ${sess.capabilities.browserVersion}`,
    open: (u) => call('POST', `/session/${id}/url`, { url: u }),
    eval: (js) => call('POST', `/session/${id}/execute/sync`, { script: `return (${js})`, args: [] }),
    shot: async () => Buffer.from(await call('GET', `/session/${id}/screenshot`), 'base64'),
    close: async () => { await call('DELETE', `/session/${id}`).catch(() => {}); drv.kill(); xvfb.kill(); },
  };
}

export async function driver(name) {
  if (name === 'webkit') {
    try { return await playwrightDriver('webkit'); } catch { return webkitGtkDriver(); }
  }
  return playwrightDriver(name);
}

