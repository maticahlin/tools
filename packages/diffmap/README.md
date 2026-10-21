# diffmap

A difference cursor whose colors you control.

The classic `mix-blend-mode: difference` cursor inverts whatever is under it — red becomes cyan, black becomes white. It looks great until you need it in your own colors: change the cursor color and the math turns muddy and inconsistent. diffmap keeps the inversion and lets you decide what every inverted color looks like.

- **8 editable nodes.** Black, white, red, green, blue, cyan, magenta and yellow each turn into a color you pick. Everything in between is interpolated.
- **Any content.** Text, images, video, text over images, images over images.
- **Every major browser.** Chrome, Edge, Firefox, Safari on Windows, macOS and Linux. No canvas screenshots of the page, no html2canvas.
- **Small.** No dependencies, a few KB.
- **Agent-friendly setup.** `npx @maticahlin/diffmap setup` opens a local editor; flags let coding agents do it without a browser.

## Quick start

```sh
npx @maticahlin/diffmap setup     # pick colors in your browser → diffmap.config.json
npm i @maticahlin/diffmap
```

```js
import { diffmap } from '@maticahlin/diffmap';
import config from './diffmap.config.json';

diffmap(config);
```

Mark the images and videos that should get the full color map:

```html
<img src="hero.jpg" data-diffmap alt="…">
```

No bundler? `npx @maticahlin/diffmap vendor public/diffmap` copies the runtime and prints the `<script>` tag to paste.

## How it works

Browsers can't hand JavaScript the pixels of a rendered page, so diffmap uses two engines that agree with each other.

**1. Blend layers — everything on the page.** CSS blend modes work on each color channel separately. Three stacked circles (`multiply`, `difference`, `difference`) can compute any per-channel map `out = A + (B − A) · in`, where A is what black turns into and B is what white turns into. This runs on the GPU compositor in every browser. It can follow your full node map only along straight lines per channel, so diffmap fits it to your map and makes your site's **text and background colors land exactly** (the `anchors`). Classic white difference is the special case A = white, B = black.

**2. Node map — images and video.** For each `[data-diffmap]` image, diffmap reads the pixels once, runs them through your full 8-node color cube, and keeps the result as a hidden copy that only shows inside the cursor. That copy is pre-corrected for the blend layers that still sit on top, so after both engines the image comes out exactly as your map says, and text on top of it still matches the rest of your text. Video is recolored per frame with WebGL, only while the cursor is over it.

```
page pixels ──► blend layers (fitted to your map) ──────────────► text, UI, backgrounds
image pixels ─► node map ─► pre-correct ─► blend layers ─────────► exactly your map
```

## Config

```jsonc
{
  "palette": {
    "mode": "difference",               // or "duotone"
    "nodes": {                          // what each color turns into; unset = classic inversion
      "black": "#f4f2ff", "white": "#14105a",
      "red": "#14d6c0",   "cyan": "#f03d6e",
      "green": "#f04fd8", "magenta": "#22c46f",
      "blue": "#f4d25a",  "yellow": "#2f3cff"
    },
    "anchors": ["#111111", "#ffffff"]   // your text + background: rendered exactly
  },
  "palettes": { "hero": { "mode": "duotone", "stops": ["#1a1aff", "#ff5a36"] } },
  "size": 36,                           // cursor diameter, px
  "grow": { "size": 96 },               // over links, buttons, [data-diffmap-grow]; false to disable
  "ease": 0.2,                          // follow smoothing, 1 = no lag
  "media": "img[data-diffmap], video[data-diffmap]",  // or true for all images and video
  "hideCursor": false,
  "position": "auto"                    // "fixed" | "absolute" | "auto"
}
```

| Attribute | Effect |
| --- | --- |
| `data-diffmap` | on `<img>`/`<video>`: use the full node map |
| `data-diffmap-palette="name"` | use a named palette inside this element (tweens between palettes) |
| `data-diffmap-size="120"` | cursor size while over this element |
| `data-diffmap-grow` | grow like a link |
| `data-diffmap-ignore` | skip media inside this element |

**Duotone** maps brightness to a two-color ramp instead (`"stops": [dark, light]`). It's exact everywhere, including text, but colors collapse to the ramp.

### API

```js
const cursor = diffmap(config);
cursor.setPalette({ nodes: { red: '#ffd400' } });  // swap the default palette
cursor.refresh();     // pick up images added later (also automatic via MutationObserver)
cursor.inspect();     // { mode, media: [{ el, state }] } — ready, working, tainted (CORS), skip
cursor.destroy();
```

`import { resolvePalette, lookup, fitToRange, PRESETS } from '@maticahlin/diffmap/core'` gives you the color math without the DOM.

## CLI

```
diffmap setup                      editor on localhost; "Save to project" writes the config and exits
diffmap setup --preset riso --anchors "#111,#fff"
diffmap setup --nodes '{"red":"#ffd400"}'      unset nodes keep their current value
diffmap setup --duotone "#1a1aff,#ff5a36"
diffmap check [--json]             how exact the saved palette renders
diffmap vendor <dir>               copy the runtime for sites without a bundler
diffmap add-command                add /diffmap-setup to Claude Code (.claude/commands)
```

Coding agents: see [AGENTS.md](./AGENTS.md).

## Limits

- **Images from another domain** need CORS (`crossorigin="anonymous"` plus an `Access-Control-Allow-Origin` header). Without it they use the blend layers only — still inverted, just not the full node map.
- **Images are exact** when your other nodes sit inside the range spanned by the black and white nodes (per channel). The editor shows how far off they are and can pull them into range.
- **Page text and UI** follow your map exactly for the two anchor colors; other colors land on the closest straight-line fit.
- **Touch devices** have no hover, so diffmap does nothing there.
- **CSS backgrounds and `<canvas>`** get the blend layers, not the node map (yet).
- The page needs a background color; diffmap sets `html` to white if there is none.

## Browser notes

| | Blend layers | Images (node map) | Video (WebGL) |
| --- | --- | --- | --- |
| Chromium (Chrome, Edge, Arc, Opera) | ✓ tested | ✓ tested | ✓ tested |
| WebKit (Safari) | ✓ tested on WebKitGTK | ✓ tested on WebKitGTK | needs a check on macOS Safari |
| Firefox | needs a check | needs a check | needs a check |

On WebKitGTK (Linux's GNOME Web), a `<video>` anywhere on the page stops blending for the whole page, because the video gets its own compositing layer. macOS Safari composites differently; that's the first thing to check there.

WebKit only blends layers that aren't composited on their own, so on Safari diffmap moves the layers with 2D transforms inside a scroll-following box (`position: "absolute"`); elsewhere it uses `position: fixed`, which stays smoother while scrolling.

## Development

```sh
npm test                           # color math
node test/pixel.mjs chromium webkit firefox   # screenshots vs. the math, per pixel
```

The pixel test renders a page with text, color swatches, a photo, text over the photo and a dark section, moves the cursor over each, and checks every pixel inside the circle against the formula. Current results: maximum error 1.8/255 in Chromium and WebKit.

## License

MIT
