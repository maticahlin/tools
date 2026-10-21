#!/usr/bin/env node
// diffmap CLI — zero dependencies.
//
//   npx @maticahlin/diffmap setup              open the palette editor on localhost, save the config
//   npx @maticahlin/diffmap setup --preset riso --anchors "#111,#fff"   write a config without a browser
//   npx @maticahlin/diffmap check              print how well the saved palette works
//   npx @maticahlin/diffmap vendor public/js   copy the runtime for sites without a bundler
//   npx @maticahlin/diffmap add-command        add a /diffmap-setup command for Claude Code

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PRESETS, CORNERS, CORNER_RGB, parseColor, toHex, resolvePalette, coverage, lookup, applyFallback,
} from '../src/core.js';

const PKG = path.resolve(fileURLToPath(import.meta.url), '../..');
const { version } = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'help';
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { (flags._ ??= []).push(a); continue; }
  const [k, inline] = a.slice(2).split('=');
  if (inline !== undefined) flags[k] = inline;
  else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
  else flags[k] = true;
}
const OUT = path.resolve(flags.out ?? 'diffmap.config.json');

const die = (msg) => { console.error(`diffmap: ${msg}`); process.exit(1); };

// ------------------------------------------------------------------ commands
const commands = {
  help() {
    console.log(`diffmap ${version} — a difference cursor with your colors

Usage
  diffmap setup                     Open the palette editor in your browser and save the config
  diffmap setup [palette flags]     Write the config directly, no browser (for agents and CI)
  diffmap check                     Show how exactly the saved palette can be rendered
  diffmap vendor <dir>              Copy the runtime into <dir> for sites without a bundler
  diffmap add-command               Add a /diffmap-setup slash command for Claude Code

Palette flags (any of these skips the browser)
  --preset <name>                   ${Object.keys(PRESETS).join(', ')}
  --nodes '<json>'                  e.g. '{"red":"#ffd400","white":"#141414"}'  (unset nodes stay inverted)
  --anchors "<text>,<background>"   your site's main text and background colors (land exactly)
  --duotone "<dark>,<light>"        two-color ramp instead of the node map
  --swap "<color>,<color>"          two colors trade places exactly (e.g. brand red and white)
  --size <px> --grow <px> --edge <px> --ease <0.05-1>

Cursor shape (default: circle)
  --text "<word>" [--font "<css font>"]   the word itself is the cursor
  --image <url> [--width <px>]            a picture, differenced with the page
  --circle                                back to the circle

Other
  --out <file>                      config path (default: ./diffmap.config.json)
  --port <n>                        port for the editor (default: random free port)
  --no-open                         print the editor URL instead of opening a browser
  --json                            machine-readable output`);
  },

  async setup() {
    const direct = ['preset', 'nodes', 'anchors', 'duotone', 'swap', 'text', 'image', 'circle'].some((k) => k in flags);
    if (direct) {
      const cfg = buildConfig(readConfig() ?? {});
      writeConfig(cfg);
      report(cfg, { saved: true });
      return;
    }
    await editor();
  },

  check() {
    const cfg = readConfig();
    if (!cfg) die(`no config at ${OUT}. Run "diffmap setup" first.`);
    report(cfg, { saved: false });
  },

  vendor() {
    const dir = path.resolve(flags._?.[0] ?? 'public/diffmap');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['index.js', 'core.js']) fs.copyFileSync(path.join(PKG, 'src', f), path.join(dir, f === 'index.js' ? 'diffmap.js' : f));
    const rel = path.relative(process.cwd(), dir).split(path.sep).join('/');
    console.log(`Copied the runtime to ${rel}/ (diffmap.js + core.js).

Add this before </body>, with the config next to your pages:
  <script type="module" src="/${rel.replace(/^public\//, '')}/diffmap.js" data-diffmap-config="/diffmap.config.json"></script>`);
  },

  'add-command'() {
    const dir = path.resolve('.claude/commands');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'diffmap-setup.md');
    fs.copyFileSync(path.join(PKG, 'agents/claude-command.md'), file);
    console.log(`Added ${path.relative(process.cwd(), file)}. In Claude Code, run /diffmap-setup.`);
  },
};

// ------------------------------------------------------------------ config helpers
function readConfig() {
  if (!fs.existsSync(OUT)) return null;
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { die(`${OUT} is not valid JSON: ${e.message}`); }
}

function writeConfig(cfg) {
  fs.writeFileSync(OUT, JSON.stringify(cfg, null, 2) + '\n');
}

function hexList(s, n, what) {
  const parts = String(s).split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean); // commas outside rgb()
  if (parts.length !== n) die(`${what} needs ${n} comma-separated colors, got "${s}"`);
  return parts.map((x) => { try { return toHex(parseColor(x)); } catch (e) { die(e.message.replace('diffmap: ', '')); } });
}

function buildConfig(base) {
  const cfg = { size: 36, grow: { size: 96 }, ease: 0.2, ...base };
  let pal = { mode: 'difference', ...(base.palette ?? {}) };
  if (flags.duotone) pal = { mode: 'duotone', stops: hexList(flags.duotone, 2, '--duotone') };
  if (flags.swap) pal = { mode: 'swap', colors: hexList(flags.swap, 2, '--swap') };
  if (flags.preset) {
    const p = PRESETS[String(flags.preset).toLowerCase()];
    if (!p) die(`unknown preset "${flags.preset}". Try: ${Object.keys(PRESETS).join(', ')}`);
    pal = { mode: 'difference', nodes: { ...p }, anchors: pal.anchors };
  }
  if (flags.nodes) {
    let n;
    try { n = JSON.parse(flags.nodes); } catch { die(`--nodes must be JSON, e.g. '{"red":"#ffd400"}'`); }
    for (const k of Object.keys(n)) if (!CORNERS.includes(k)) die(`unknown node "${k}". Nodes: ${CORNERS.join(', ')}`);
    pal = { mode: 'difference', ...pal, nodes: { ...(pal.mode === 'difference' ? pal.nodes : {}), ...Object.fromEntries(Object.entries(n).map(([k, v]) => [k, toHex(parseColor(v))])) } };
  }
  if (flags.anchors) pal.anchors = hexList(flags.anchors, 2, '--anchors');
  if (pal.mode === 'difference') {
    pal.nodes = Object.fromEntries(CORNERS.map((k) => [k, toHex(parseColor(pal.nodes?.[k] ?? PRESETS.classic[k]))]));
    pal.anchors ??= ['#111111', '#ffffff'];
    delete pal.stops;
  } else { delete pal.nodes; delete pal.anchors; if (pal.mode !== 'swap') delete pal.colors; if (pal.mode !== 'duotone') delete pal.stops; }
  cfg.palette = pal;
  if ('text' in flags) cfg.cursor = { text: flags.text === true ? '' : String(flags.text), font: flags.font ?? '700 120px Arial, Helvetica, sans-serif' };
  if (flags.image) cfg.cursor = { image: String(flags.image), width: Number(flags.width ?? 260) };
  if (flags.circle) delete cfg.cursor;
  if (flags.edge) cfg.edge = Number(flags.edge);
  if (flags.size) cfg.size = Number(flags.size);
  if (flags.grow) cfg.grow = { ...(cfg.grow ?? {}), size: Number(flags.grow) };
  if (flags.ease) cfg.ease = Math.min(1, Math.max(0.05, Number(flags.ease)));
  return cfg;
}

function analyse(cfg) {
  const r = resolvePalette(cfg.palette ?? {});
  if (r.duotone) return { mode: 'duotone', text: 'exact', images: 'exact', other: 'exact', layers: r.layers.length };
  if (cfg.palette.mode === 'swap') {
    const [c1, c2] = cfg.palette.colors.map(parseColor);
    const off = (x, y) => Math.round(Math.max(...applyFallback(r.fallback, x).map((v, i) => Math.abs(v - y[i]))) * 255);
    return { mode: 'swap', colors: cfg.palette.colors, offBy: [off(c1, c2), off(c2, c1)], layers: r.layers.length };
  }
  const lv = (x) => Math.round(x * 255);
  const anchors = (cfg.palette.anchors ?? []).map((a) => {
    const c = parseColor(a);
    const want = lookup(r.nodes, c), got = applyFallback(r.fallback, c);
    return { color: a, offBy: lv(Math.max(...want.map((v, i) => Math.abs(v - got[i])))) };
  });
  return {
    mode: 'difference',
    anchors,
    imagesOffBy: lv(coverage(r.fallback, r.nodes)),
    otherColorsOffBy: lv(r.fallback.error),
    pageMisses: CORNERS.filter((k) => {
      const got = applyFallback(r.fallback, CORNER_RGB[k]);
      return lv(Math.max(...got.map((v, i) => Math.abs(v - r.nodes[k][i])))) > 24;
    }),
    fallback: { black: toHex(r.fallback.A), white: toHex(r.fallback.B) },
    layers: r.layers.length,
  };
}

function report(cfg, { saved }) {
  const a = analyse(cfg);
  if (flags.json) { console.log(JSON.stringify({ path: OUT, saved, config: cfg, analysis: a }, null, 2)); return; }
  const rel = path.relative(process.cwd(), OUT) || OUT;
  console.log(saved ? `Saved ${rel}` : `Checked ${rel}`);
  if (a.mode === 'duotone') { console.log('  duotone: exact in every browser, on text, images and video.'); return; }
  if (a.mode === 'swap') {
    console.log(`  ${a.colors[0]} → ${a.colors[1]}: ${a.offBy[0] <= 1 ? 'exact' : `off by ${a.offBy[0]} levels`}`);
    console.log(`  ${a.colors[1]} → ${a.colors[0]}: ${a.offBy[1] <= 1 ? 'exact' : `off by ${a.offBy[1]} levels`}`);
    console.log(`  ${a.layers} blend layers, every browser`);
    return;
  }
  for (const an of a.anchors) console.log(`  site color ${an.color}: ${an.offBy <= 1 ? 'exact' : `off by ${an.offBy} levels`}`);
  console.log(`  images and video: ${a.imagesOffBy <= 1 ? 'exact' : a.imagesOffBy <= 12 ? `within ${a.imagesOffBy} levels (not visible)` : `off by up to ${a.imagesOffBy} levels (nodes outside the black/white range)`}`);
  console.log(`  plain page colors: ${a.pageMisses.length ? `${a.pageMisses.join(', ')} can't take their node color there (images and video still do)` : 'follow every node'}`);
}

// ------------------------------------------------------------------ editor server
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css' };

function editor() {
  return new Promise((resolve) => {
    const page = fs.readFileSync(path.join(PKG, 'setup/index.html'), 'utf8');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>\n${page}\n</body></html>`;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      // only this machine, and only same-origin writes
      if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        res.writeHead(403).end(); return;
      }
      if (url.pathname === '/api/config' && req.method === 'GET') {
        return json(res, 200, { diffmap: version, path: OUT, display: path.relative(process.cwd(), OUT) || OUT, config: readConfig() });
      }
      if (url.pathname === '/api/config' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => {
          let cfg;
          try { cfg = JSON.parse(body); resolvePalette(cfg.palette ?? {}); } catch (e) { return json(res, 400, { error: e.message }); }
          writeConfig(cfg);
          json(res, 200, { path: path.relative(process.cwd(), OUT) || OUT });
          console.log('');
          report(cfg, { saved: true });
          setTimeout(() => { server.close(); resolve(); }, 300);
        });
        return;
      }
      if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, TYPES['.html'], html);
      const map = { '/src/index.js': 'src/index.js', '/src/core.js': 'src/core.js', '/dusk.jpg': 'setup/dusk.jpg', '/temeraire.jpg': 'setup/temeraire.jpg' };
      const f = map[url.pathname];
      if (f) return send(res, 200, TYPES[path.extname(f)], fs.readFileSync(path.join(PKG, f)));
      res.writeHead(404).end('not found');
    });
    server.listen(Number(flags.port ?? 0), '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/`;
      console.log(`diffmap setup is running at ${url}`);
      console.log(`Pick your colors and press "Save to project". It writes ${path.relative(process.cwd(), OUT) || OUT}. Ctrl+C to cancel.`);
      if (flags.open !== false && !flags['no-open']) openBrowser(url);
    });
  });
}

function send(res, code, type, body) { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); }
function json(res, code, obj) { send(res, code, 'application/json', JSON.stringify(obj)); }

function openBrowser(url) {
  const [bin, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
      : ['xdg-open', [url]];
  try {
    const p = spawn(bin, args, { stdio: 'ignore', detached: true });
    p.on('error', () => console.log(`Open ${url} in your browser.`));
    p.unref();
  } catch { console.log(`Open ${url} in your browser.`); }
}

// ------------------------------------------------------------------ run
const run = commands[cmd];
if (!run) { console.error(`diffmap: unknown command "${cmd}"\n`); commands.help(); process.exit(1); }
await run();
