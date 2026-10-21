// diffmap — a difference cursor whose colors you control.
// Zero dependencies. ~3 KB min+gz. See README.md for the full guide.

import {
  resolvePalette, lookup, precorrect, layersAt, edgeStops, kindOf, activeLayers, AFFINE, CLAMPED,
} from './core.js';

export * from './core.js';

const DEFAULTS = {
  size: 36,                 // cursor diameter in px
  grow: { selector: 'a, button, [role="button"], [data-diffmap-grow]', size: 96 },
  ease: 0.2,                // follow smoothing per frame, 1 = glued to the mouse
  media: 'img[data-diffmap], video[data-diffmap]', // images/video that get the full node map; true = all
  hideCursor: false,        // hide the native cursor while diffmap is active
  position: 'auto',         // 'fixed' | 'absolute' | 'auto' (absolute on Safari/WebKit, fixed elsewhere)
  edge: 1.25,               // circle: px over which the effect fades out at the rim (anti-aliasing without fringes)
  cursor: null,             // null = circle, { text, font }, or { image, width }
  zIndex: 2147483000,
  transition: 220,          // ms to tween between palettes
};

/**
 * Start the cursor.
 * @param {object} options
 * @param {import('./core.js').DiffmapPalette} [options.palette]  the default palette
 * @param {Record<string, import('./core.js').DiffmapPalette>} [options.palettes] named palettes, used via data-diffmap-palette="name"
 */
export function diffmap(options = {}) {
  const noop = { destroy() {}, setPalette() {}, refresh() {}, enabled: false };
  if (typeof window === 'undefined') return noop;
  // touch-only devices have no hover — leave them alone
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches && !options.force) return noop;

  const opt = { ...DEFAULTS, ...options, grow: { ...DEFAULTS.grow, ...(options.grow ?? {}) } };
  if (options.grow === false) opt.grow = false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) opt.ease = 1;

  // ---- palettes
  const raw = { default: options.palette ?? {}, ...(options.palettes ?? {}) };
  const resolved = {};
  const pal = (name) => (resolved[name] ??= resolvePalette(raw[name] ?? raw.default));
  let current = pal('default');
  const copy = (fb) => ({ a: [...fb.a], d: [...fb.d] });
  let shown = copy(current.fallback);
  let tween = null;

  // ---- blend layers
  // Blend modes only see what's in the same stacking context, so the layers can't live in
  // a positioned/fixed container. Two strategies:
  //   fixed     4 position:fixed siblings moved with translate3d — smoothest while scrolling.
  //   absolute  4 absolute siblings inside a viewport-sized, non-isolating clip box that
  //             follows the scroll, moved with 2D transforms. WebKit only blends layers that
  //             aren't composited on their own, which rules out fixed and translate3d there.
  const mode = opt.position === 'fixed' || opt.position === 'absolute' ? opt.position : isWebKit() ? 'absolute' : 'fixed';
  let box = null;
  if (mode === 'absolute') {
    box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.dataset.diffmap = '';
    // no z-index/transform/opacity here: it must not become a stacking context
    Object.assign(box.style, {
      position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
      overflow: 'clip', pointerEvents: 'none', margin: '0', padding: '0',
    });
    if (getComputedStyle(box).overflow !== 'clip') box.style.overflow = 'hidden';
    document.documentElement.appendChild(box); // outside <body>, so a positioned body doesn't shift it
  }
  const syncBox = () => { if (box) { box.style.left = scrollX + 'px'; box.style.top = scrollY + 'px'; } };
  syncBox();
  addEventListener('scroll', syncBox, { passive: true });

  const mkLayer = (blend) => {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.dataset.diffmapLayer = blend;
    Object.assign(el.style, {
      position: mode, left: '0', top: '0', width: '0', height: '0', margin: '0', padding: '0',
      pointerEvents: 'none', mixBlendMode: blend, transform: 'translate(-9999px, -9999px)',
      zIndex: String(opt.zIndex), backgroundRepeat: 'no-repeat',
    });
    if (mode === 'fixed') el.style.willChange = 'transform';
    (box ?? document.body).appendChild(el);
    return el;
  };
  const move = (el, x, y) => {
    el.style.transform = mode === 'fixed' ? `translate3d(${x}px, ${y}px, 0)` : `translate(${x}px, ${y}px)`;
  };

  const shape = createShape(opt.cursor ?? {}, { mkLayer, move, edge: opt.edge });
  const paintLayers = (fb, duotone) => shape.paint(fb, duotone);
  paintLayers(shown, current.duotone);
  if (shape.static) opt.transition = 0; // bitmap shapes repaint per palette, so palettes switch instantly

  if (opt.hideCursor) document.documentElement.style.cursor = 'none';

  // The blend layers need an opaque page underneath. A page without a background
  // shows the browser canvas, which blend modes don't see in every browser.
  const bgOf = (el) => getComputedStyle(el).backgroundColor;
  const transparent = (c) => c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
  if (transparent(bgOf(document.documentElement)) && transparent(bgOf(document.body))) {
    document.documentElement.style.backgroundColor = '#ffffff';
    console.info('[diffmap] page had no background color; set <html> to white so blending works everywhere.');
  }

  // ---- pointer state
  const target = { x: -999, y: -999, size: 0 };
  const pos = { x: -999, y: -999, size: 0 };
  let over = null;       // element under the pointer
  let raf = 0;

  const growMatch = (el) => opt.grow && el?.closest?.(opt.grow.selector);
  function areaPalette(el) {
    const host = el?.closest?.('[data-diffmap-palette]');
    return host ? host.getAttribute('data-diffmap-palette') : 'default';
  }

  function onMove(e) {
    target.x = e.clientX; target.y = e.clientY;
    if (e.target !== over) {
      over = e.target;
      const sizeAttr = over.closest?.('[data-diffmap-size]')?.getAttribute('data-diffmap-size');
      target.size = sizeAttr ? Number(sizeAttr) : growMatch(over) ? opt.grow.size : opt.size;
      switchTo(areaPalette(over));
      if (shape.setText) {
        const host = over.closest?.('[data-diffmap-text]');
        shape.setText(host ? host.getAttribute('data-diffmap-text') : (opt.cursor?.text ?? ''));
      }
    }
    if (pos.x < -900) { pos.x = target.x; pos.y = target.y; } // first move: don't fly in from the corner
    if (target.size === 0) target.size = opt.size;
    kick();
  }
  function onLeave(e) { if (!e.relatedTarget) { target.size = 0; kick(); } }
  function onDown() { target.size *= 0.85; kick(); }
  function onUp() { target.size = growMatch(over) ? opt.grow.size : opt.size; kick(); }

  addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerout', onLeave, { passive: true });
  addEventListener('pointerdown', onDown, { passive: true });
  addEventListener('pointerup', onUp, { passive: true });

  // ---- palette switching
  let currentName = 'default';
  function switchTo(name) {
    if (name === currentName) return;
    currentName = name;
    const next = pal(name);
    const from = copy(shown);
    if (next.duotone !== current.duotone || opt.transition <= 0) {
      current = next; shown = copy(next.fallback);
      paintLayers(shown, next.duotone); tween = null; kick(); return;
    }
    current = next;
    tween = { from, start: performance.now() };
    kick();
  }

  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  function frame(now) {
    raf = 0;
    const e = opt.ease;
    pos.x += (target.x - pos.x) * e;
    pos.y += (target.y - pos.y) * e;
    pos.size += (target.size - pos.size) * Math.min(1, e * 1.4);
    const settled = Math.abs(target.x - pos.x) < 0.1 && Math.abs(target.y - pos.y) < 0.1 && Math.abs(target.size - pos.size) < 0.1;
    if (settled) { pos.x = target.x; pos.y = target.y; pos.size = target.size; }

    if (tween) {
      const k = Math.min(1, (now - tween.start) / opt.transition);
      const s = k * k * (3 - 2 * k);
      shown = {
        a: tween.from.a.map((v, i) => v + (current.fallback.a[i] - v) * s),
        d: tween.from.d.map((v, i) => v + (current.fallback.d[i] - v) * s),
      };
      paintLayers(shown, current.duotone);
      if (k >= 1) tween = null;
    }

    const reveal = shape.place(pos.x, pos.y, pos.size);

    media.update(reveal);
    if (!settled || tween || media.busy()) kick();
  }

  // ---- engine 2: images and video get the full node map
  const media = createMedia(opt, pal, areaPalette);

  return {
    enabled: true,
    /** switch the default palette at runtime */
    setPalette(p) {
      raw.default = p; delete resolved.default;
      for (const k in resolved) delete resolved[k];
      currentName = null; switchTo(areaPalette(over));
      media.reset();
    },
    /** text cursor: change the label (elements with data-diffmap-text do this on hover) */
    setText(str) { shape.setText?.(str); kick(); },
    /** re-scan the page for new media elements */
    refresh() { media.scan(); },
    /** what happened to each image/video: ready, loading, working, tainted (CORS), skip */
    inspect() { return { mode, media: media.inspect() }; },
    destroy() {
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onLeave);
      removeEventListener('pointerdown', onDown);
      removeEventListener('pointerup', onUp);
      shape.destroy();
      box?.remove();
      removeEventListener('scroll', syncBox);
      media.destroy();
      if (opt.hideCursor) document.documentElement.style.cursor = '';
    },
  };
}

// =====================================================================================
// Cursor shapes. Each one owns its layer elements and answers three things: how to paint
// a palette (paint), where to draw this frame (place), and which part of the page the
// image overlays should reveal (place's return value).

const rgb = (c) => `rgb(${c.map((v) => (v * 255).toFixed(2)).join(', ')})`;
const dpr = () => window.devicePixelRatio || 1;
const snap = (v) => Math.round(v * dpr()) / dpr();
const snapUp = (v) => Math.ceil(v * dpr()) / dpr();

function createShape(cursor, env) {
  if (cursor.text !== undefined) return textShape(cursor, env);
  if (cursor.image) return imageShape(cursor, env);
  return circleShape(env);
}

/** The blend stack a palette needs: kind, which layers are active, their blend modes. */
function plan(fb) {
  const kind = kindOf(fb);
  const idx = activeLayers(fb, kind);
  const all = kind === 'affine' ? AFFINE : CLAMPED;
  return { kind, idx, blends: idx.map((L) => all[L]), at: (t) => { const c = layersAt(fb, t, kind); return idx.map((L) => c[L]); } };
}

/** Keeps a list of layer elements matching a list of blend modes, inserted after `after`. */
function layerSet(mkLayer) {
  let els = [], sig = '';
  return {
    ensure(blends, style) {
      const s = blends.join(',');
      if (s !== sig) {
        els.forEach((el) => el.remove());
        els = blends.map((b) => { const el = mkLayer(b); Object.assign(el.style, style ?? {}); return el; });
        sig = s;
      }
      return els;
    },
    get els() { return els; },
    remove() { els.forEach((el) => el.remove()); els = []; sig = ''; },
  };
}

// Circle: opaque squares on whole device pixels, each painted with a radial gradient
// that carries the effect strength from 1 inside to 0 at the rim.
function circleShape({ mkLayer, move, edge = 1.25 }) {
  const lum = mkLayer('color');            // duotone only: keeps the backdrop's luminance
  lum.style.borderRadius = '50%';
  lum.style.backgroundColor = '#808080';
  const set = layerSet(mkLayer);
  let p = null, stops = [], duo = false, last = '';

  return {
    paint(fb, duotone) {
      p = plan(fb); duo = duotone; last = '';
      lum.style.display = duo ? '' : 'none';
      set.ensure(p.blends);
      // gradient stops: every branch switch twice (both sides), plus samples in between
      stops = edgeStops(fb, p.kind).map(({ t, at }) => ({ t, cols: p.at(at) }));
    },
    place(x, y, size) {
      const r = size / 2;
      if (r < 0.5 || !p) { for (const el of [lum, ...set.els]) move(el, -9999, -9999); return null; }
      const s = Math.min(edge, r);
      const side = snapUp(2 * r + 4);
      const left = snap(x - side / 2), top = snap(y - side / 2);
      const cx = x - left, cy = y - top;
      const key = `${side}|${cx.toFixed(3)}|${cy.toFixed(3)}|${r}`;
      if (key !== last) {
        last = key;
        const lists = p.blends.map(() => []);
        for (const { t, cols } of stops) cols.forEach((c, L) => lists[L].push(`${rgb(c)} ${(r - s * t).toFixed(3)}px`));
        const at = `circle at ${cx.toFixed(3)}px ${cy.toFixed(3)}px`;
        set.els.forEach((el, L) => {
          el.style.width = el.style.height = side + 'px';
          el.style.backgroundImage = `radial-gradient(${at}, ${lists[L].join(', ')})`;
        });
      }
      for (const el of set.els) move(el, left, top);
      if (duo) { lum.style.width = lum.style.height = 2 * r + 'px'; move(lum, x - r, y - r); }
      return { kind: 'circle', x, y, r: Math.max(0, r - s) };
    },
    destroy() { lum.remove(); set.remove(); },
  };
}

// Text: the glyphs' anti-aliasing coverage becomes the effect strength t, baked per pixel
// into one bitmap per layer at device resolution. Exact for any glyph shape.
// The text can change: elements with data-diffmap-text="…" show their own label.
function textShape(cursor, { mkLayer, move }) {
  const font = cursor.font ?? '700 72px Arial, Helvetica, sans-serif';
  const lineHeight = cursor.lineHeight ?? 1.2;
  const maxWidth = cursor.maxWidth ?? Infinity;
  const align = cursor.align ?? 'center';
  const lum = mkLayer('color');
  lum.style.backgroundColor = '#808080';
  const set = layerSet(mkLayer);
  const bg = { backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' };
  let text = String(cursor.text ?? ''), fb = null, duo = false;
  let glyphs = null; // { cov, w, h, W, H, maskUrl }
  let gen = 0;

  function lines(ctx, str) {
    const out = [];
    for (const para of str.split('\n')) {
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        const next = line + word;
        if (line && ctx.measureText(next.trimEnd()).width > maxWidth) { out.push(line.trimEnd()); line = word.trimStart(); }
        else line = next;
      }
      out.push(line.trimEnd());
    }
    return out;
  }

  function render() {
    if (!text.trim()) { glyphs = null; return; }
    const k = dpr();
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.font = font;
    const ls = lines(ctx, text);
    const px = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 72);
    const lh = px * lineHeight;
    const widths = ls.map((l) => ctx.measureText(l).width);
    const pad = Math.ceil(px * 0.25);
    const Wcss = Math.max(...widths) + 2 * pad, Hcss = lh * ls.length + 2 * pad;
    const w = Math.ceil(Wcss * k), h = Math.ceil(Hcss * k);
    c.width = w; c.height = h;
    ctx.scale(k, k);
    ctx.font = font; ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    ls.forEach((l, i) => {
      const x = align === 'left' ? pad : align === 'right' ? Wcss - pad - widths[i] : (Wcss - widths[i]) / 2;
      ctx.fillText(l, x, pad + lh * (i + 0.5));
    });
    glyphs = { cov: ctx.getImageData(0, 0, w, h).data, w, h, W: w / k, H: h / k, maskUrl: c.toDataURL() };
  }

  function bake() {
    if (!glyphs || !fb) return;
    const p = plan(fb);
    const els = set.ensure(p.blends, bg);
    const { cov, w, h, W, H } = glyphs;
    const table = Array.from({ length: 256 }, (_, a) => p.at(a / 255));
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    els.forEach((el, L) => {
      const img = tctx.createImageData(w, h), d = img.data;
      for (let i = 0; i < cov.length; i += 4) {
        const col = table[cov[i + 3]][L];
        d[i] = col[0] * 255 + 0.5; d[i + 1] = col[1] * 255 + 0.5; d[i + 2] = col[2] * 255 + 0.5; d[i + 3] = 255;
      }
      tctx.putImageData(img, 0, 0);
      el.style.backgroundImage = `url("${tmp.toDataURL()}")`;
      el.style.width = W + 'px'; el.style.height = H + 'px';
    });
    lum.style.width = W + 'px'; lum.style.height = H + 'px';
    for (const pr of ['maskImage', 'webkitMaskImage']) lum.style[pr] = `url("${glyphs.maskUrl}")`;
    for (const pr of ['maskSize', 'webkitMaskSize']) lum.style[pr] = '100% 100%';
  }

  // web fonts: re-render once the face is ready, so the bitmap isn't drawn in the fallback font
  const ready = () => document.fonts?.load ? document.fonts.load(font, text || 'a').catch(() => {}) : Promise.resolve();

  return {
    static: true,
    setText(str) {
      str = String(str ?? '');
      if (str === text) return;
      text = str;
      const my = ++gen;
      render(); bake();
      ready().then(() => { if (my === gen) { render(); bake(); } });
    },
    paint(next, duotone) {
      fb = next; duo = duotone;
      lum.style.display = duo ? '' : 'none';
      if (!glyphs) render();
      bake();
      const my = ++gen;
      ready().then(() => { if (my === gen) { render(); bake(); } });
    },
    place(x, y, size) {
      if (size < 0.5 || !glyphs) { for (const el of [lum, ...set.els]) move(el, -9999, -9999); return null; }
      const left = snap(x - glyphs.W / 2), top = snap(y - glyphs.H / 2);
      for (const el of set.els) move(el, left, top);
      if (duo) move(lum, left, top); else move(lum, -9999, -9999);
      return { kind: 'mask', url: glyphs.maskUrl, left, top, w: glyphs.W, h: glyphs.H };
    },
    destroy() { lum.remove(); set.remove(); },
  };
}

// Image: a real difference with the picture, then the palette on top.
// The palette layers use black and white swapped, so a white picture behaves exactly like
// the circle and a black one leaves the page as it is.
function imageShape(cursor, { mkLayer, move }) {
  const pic = mkLayer('difference');
  pic.style.backgroundImage = `url("${cursor.image}")`;
  pic.style.backgroundSize = '100% 100%';
  const lum = mkLayer('color');
  lum.style.backgroundColor = '#808080';
  const set = layerSet(mkLayer);
  let W = cursor.width ?? 220, H = cursor.height ?? W * 0.75, fb = null;
  const img = new Image();
  img.onload = () => { if (!cursor.height) H = W * img.naturalHeight / img.naturalWidth; size(); };
  img.src = cursor.image;
  function size() {
    W = snapUp(W); H = snapUp(H);
    for (const el of [pic, lum, ...set.els]) { el.style.width = W + 'px'; el.style.height = H + 'px'; }
  }
  size();
  return {
    static: true,
    paint(next, duotone) {
      lum.style.display = duotone ? '' : 'none';
      // G(y) = F(1 − y): intercept a + d, slope −d
      fb = { a: next.a.map((v, i) => v + next.d[i]), d: next.d.map((v) => -v) };
      const p = plan(fb);
      const els = set.ensure(p.blends);
      p.at(1).forEach((col, L) => { els[L].style.backgroundColor = rgb(col); });
      size();
    },
    place(x, y, sz) {
      if (sz < 0.5) { for (const el of [pic, lum, ...set.els]) move(el, -9999, -9999); return null; }
      const left = snap(x - W / 2), top = snap(y - H / 2);
      for (const el of [pic, lum, ...set.els]) move(el, left, top);
      return null; // the picture differs from moment to moment, so overlays can't pre-correct for it
    },
    destroy() { pic.remove(); lum.remove(); set.remove(); },
  };
}

function isWebKit() {
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|SamsungBrowser/.test(ua);
}

// =====================================================================================
// Media overlays: a recolored copy of each image sits right on top of the original and
// is only visible inside the cursor circle. The copy is pre-corrected for the blend
// layers that still run on top, so the final pixel is exactly the node map's output.

function createMedia(opt, pal, areaPalette) {
  const selector = opt.media === true ? 'img, video' : opt.media || null;
  const items = new Map();   // element → item
  const visible = new Set();
  let active = 0;

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const it = items.get(en.target);
      if (!it) continue;
      if (en.isIntersecting) { visible.add(it); if (!it.state) prepare(it); } else { visible.delete(it); hide(it); }
    }
  }, { rootMargin: '200px' });

  const mo = selector ? new MutationObserver(() => scan()) : null;
  mo?.observe(document.body, { childList: true, subtree: true });

  function scan() {
    if (!selector) return;
    for (const el of document.querySelectorAll(selector)) {
      if (items.has(el) || el.dataset.diffmapOverlay !== undefined) continue;
      if (el.closest('[data-diffmap-ignore]')) continue;
      const it = { el, state: null, overlay: null, palette: null, rect: null };
      items.set(el, it);
      io.observe(el);
    }
  }

  function prepare(it) {
    const el = it.el;
    it.palette = pal(areaPalette(el));
    if (!it.palette.media) { it.state = 'skip'; return; } // duotone / swap: the layers alone draw the whole map
    if (el.tagName === 'VIDEO') return prepareVideo(it);
    if (!el.complete || !el.naturalWidth) {
      it.state = 'loading';
      el.addEventListener('load', () => { it.state = null; prepare(it); }, { once: true });
      return;
    }
    it.state = 'working';
    const src = el.currentSrc || el.src;
    const run = () => {
      const max = 2048;
      const k = Math.min(1, max / Math.max(el.naturalWidth, el.naturalHeight));
      const w = Math.max(1, Math.round(el.naturalWidth * k));
      const h = Math.max(1, Math.round(el.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(el, 0, 0, w, h);
      let data;
      try { data = ctx.getImageData(0, 0, w, h); } catch {
        it.state = 'tainted'; // cross-origin without CORS: the blend layers alone handle it
        console.info('[diffmap] image is cross-origin without CORS, using the fallback only:', src);
        return;
      }
      recolor(data.data, it.palette);
      ctx.putImageData(data, 0, 0);
      c.toBlob((blob) => {
        if (!blob || !items.has(el)) return;
        // A plain div with a background, not an <img>/<canvas>: WebKit may give those their
        // own compositing layer, and blend modes can't see into separate layers there.
        const url = URL.createObjectURL(blob);
        const pre = new Image();
        pre.src = url;
        const done = () => {
          if (!items.has(el)) return URL.revokeObjectURL(url);
          const ov = document.createElement('div');
          ov.style.backgroundImage = `url("${url}")`;
          ov.style.backgroundRepeat = 'no-repeat';
          ov.style.backgroundOrigin = ov.style.backgroundClip = 'content-box';
          it.url = url;
          mount(it, ov);
          it.state = 'ready';
        };
        (pre.decode ? pre.decode() : Promise.resolve()).then(done, done);
      });
    };
    // `complete` only means loaded: WebKit can still draw an undecoded image as nothing
    const idle = window.requestIdleCallback ?? ((f) => setTimeout(f, 1));
    (el.decode ? el.decode() : Promise.resolve()).then(() => idle(run), () => idle(run));
  }

  function recolor(px, p) {
    const c = [0, 0, 0], out = [0, 0, 0];
    // a 33³ cache would be faster for huge images; trilinear is already cheap
    for (let i = 0; i < px.length; i += 4) {
      c[0] = px[i] / 255; c[1] = px[i + 1] / 255; c[2] = px[i + 2] / 255;
      precorrect(p.fallback, lookup(p.nodes, c), out);
      px[i] = out[0] * 255 + 0.5; px[i + 1] = out[1] * 255 + 0.5; px[i + 2] = out[2] * 255 + 0.5;
    }
  }

  function mount(it, ov) {
    const el = it.el;
    ov.setAttribute('aria-hidden', 'true');
    ov.dataset.diffmapOverlay = '';
    Object.assign(ov.style, {
      position: 'absolute', margin: '0', pointerEvents: 'none', maxWidth: 'none', maxHeight: 'none',
      visibility: 'hidden', borderColor: 'transparent',
    });
    el.after(ov);
    it.overlay = ov;
    sync(it);
    new ResizeObserver(() => sync(it)).observe(el);
  }

  // keep the overlay's box identical to the original's
  function sync(it) {
    const { el, overlay: ov } = it;
    if (!ov) return;
    const cs = getComputedStyle(el);
    for (const p of ['objectFit', 'objectPosition', 'borderRadius', 'boxSizing', 'paddingTop', 'paddingRight',
      'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderStyle', 'transform', 'transformOrigin', 'opacity', 'filter', 'imageRendering']) ov.style[p] = cs[p];
    ov.style.boxSizing = 'border-box';
    if (ov.tagName === 'DIV') {
      // object-fit / object-position → background equivalents
      const fit = cs.objectFit;
      ov.style.backgroundSize = fit === 'contain' || fit === 'cover' ? fit : fit === 'none' ? 'auto'
        : fit === 'scale-down' ? (el.naturalWidth > el.clientWidth || el.naturalHeight > el.clientHeight ? 'contain' : `${el.naturalWidth}px ${el.naturalHeight}px`)
          : '100% 100%';
      if (fit === 'none') ov.style.backgroundSize = `${el.naturalWidth}px ${el.naturalHeight}px`;
      ov.style.backgroundPosition = cs.objectPosition;
    }
    ov.style.zIndex = cs.position !== 'static' ? cs.zIndex : 'auto';
    ov.style.left = el.offsetLeft + 'px';
    ov.style.top = el.offsetTop + 'px';
    ov.style.width = el.offsetWidth + 'px';
    ov.style.height = el.offsetHeight + 'px';
    it.key = `${el.offsetLeft},${el.offsetTop},${el.offsetWidth},${el.offsetHeight}`;
  }

  // visibility, not a zero-size clip: WebKit treats circle(0) as "no clip"
  function hide(it) { if (it.overlay && it.shown) { it.overlay.style.visibility = 'hidden'; it.shown = false; } }

  function update(reveal) {
    active = 0;
    for (const it of visible) {
      if (!it.overlay) continue;
      if (!reveal) { hide(it); continue; }
      const b = it.el.getBoundingClientRect();
      const box = reveal.kind === 'circle'
        ? [reveal.x - reveal.r, reveal.y - reveal.r, reveal.x + reveal.r, reveal.y + reveal.r]
        : [reveal.left, reveal.top, reveal.left + reveal.w, reveal.top + reveal.h];
      const hit = box[2] - box[0] > 0.5 && box[2] > b.left && box[0] < b.right && box[3] > b.top && box[1] < b.bottom;
      if (!hit) { hide(it); continue; }
      const key = `${it.el.offsetLeft},${it.el.offsetTop},${it.el.offsetWidth},${it.el.offsetHeight}`;
      if (key !== it.key) sync(it);
      const st = it.overlay.style;
      if (reveal.kind === 'circle') {
        st.clipPath = `circle(${reveal.r}px at ${reveal.x - b.left}px ${reveal.y - b.top}px)`;
      } else {
        st.clipPath = 'none';
        if (it.maskUrl !== reveal.url) {
          it.maskUrl = reveal.url;
          for (const p of ['maskImage', 'webkitMaskImage']) st[p] = `url("${reveal.url}")`;
          for (const p of ['maskRepeat', 'webkitMaskRepeat']) st[p] = 'no-repeat';
          for (const p of ['maskSize', 'webkitMaskSize']) st[p] = `${reveal.w}px ${reveal.h}px`;
        }
        const mp = `${reveal.left - b.left}px ${reveal.top - b.top}px`;
        st.maskPosition = mp; st.webkitMaskPosition = mp;
      }
      if (!it.shown) { st.visibility = 'visible'; it.shown = true; }
      if (it.video) { it.video.draw(); active++; }
    }
  }

  // ---- video: WebGL recolors every frame, only while the cursor is over it
  function prepareVideo(it) {
    const v = it.el;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) { it.state = 'skip'; return; }
    const p = it.palette;
    const n = p.nodes, A = p.fallback.A, B = p.fallback.B;
    const v3 = (a) => `vec3(${a.map((x) => x.toFixed(6)).join(',')})`;
    const fs = `precision mediump float;varying vec2 uv;uniform sampler2D t;
      void main(){vec4 s=texture2D(t,uv);vec3 c=s.rgb;
      vec3 x0=mix(${v3(n.black)},${v3(n.red)},c.r),x1=mix(${v3(n.green)},${v3(n.yellow)},c.r),
           x2=mix(${v3(n.blue)},${v3(n.magenta)},c.r),x3=mix(${v3(n.cyan)},${v3(n.white)},c.r);
      vec3 m=mix(mix(x0,x1,c.g),mix(x2,x3,c.g),c.b);
      vec3 A=${v3(A)},D=${v3(B)}-A;
      vec3 o=clamp((m-A)/mix(D,vec3(1.0),step(abs(D),vec3(1e-6))),0.0,1.0);
      gl_FragColor=vec4(o,s.a);}`;
    const vs = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0,1);}';
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(prog, s);
    }
    gl.linkProgram(prog); gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, val] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
    it.video = {
      draw() {
        if (v.readyState < 2) return;
        if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; gl.viewport(0, 0, c.width, c.height); }
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v); } catch {
          it.video = null; it.state = 'tainted'; hide(it); return;
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
    };
    mount(it, c);
    it.state = 'ready';
  }

  scan();

  return {
    update,
    scan,
    inspect: () => [...items.values()].map((it) => ({ el: it.el, state: it.state, visible: visible.has(it) })),
    busy: () => active > 0, // keep animating while a playing video is under the cursor
    reset() {
      for (const it of items.values()) { it.overlay?.remove(); it.overlay = null; it.video = null; it.state = null; }
      for (const it of visible) prepare(it);
    },
    destroy() {
      io.disconnect(); mo?.disconnect();
      for (const it of items.values()) {
        if (it.url) URL.revokeObjectURL(it.url);
        it.overlay?.remove();
      }
      items.clear(); visible.clear();
    },
  };
}

// No-build usage: <script type="module" src="…/diffmap.js" data-diffmap-config="/diffmap.config.json"></script>
if (typeof document !== 'undefined') {
  const url = document.querySelector('script[data-diffmap-config]')?.getAttribute('data-diffmap-config');
  const start = () => fetch(url).then((r) => r.json()).then((cfg) => diffmap(cfg)).catch((e) => console.error('[diffmap]', e));
  if (url) document.body ? start() : addEventListener('DOMContentLoaded', start, { once: true });
}

export default diffmap;
