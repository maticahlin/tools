# diffmap

A difference cursor whose colors you control.

The classic `mix-blend-mode: difference` cursor inverts whatever is under it — red becomes cyan, black becomes white. It looks great until you need it in your own colors: change the cursor color and the math turns muddy and inconsistent. diffmap keeps the inversion and lets you decide what every inverted color looks like.

- **8 editable nodes.** Black, white, red, green, blue, cyan, magenta and yellow each turn into a color you pick. Everything in between is interpolated.
- **Any content.** Text, images, video, text over images, images over images.
- **Every major browser.** Chrome, Edge, Firefox, Safari on Windows, macOS and Linux. No canvas screenshots of the page, no html2canvas.
- **Small.** No dependencies, a few KB.
- **Agent-friendly setup.** `npx @maticahlin/diffmap setup` opens a local editor; flags let coding agents do it without a browser.

## The case that started it: brand red ↔ white

A red label over white and over a red surface. The classic fix, a cyan label with `mix-blend-mode: difference`, gets white → red right but turns red into pink, because true white over red would need the label's green and blue above 100%. No label color can fix that.

```json
{ "palette": { "mode": "swap", "colors": ["#ff1408", "#ffffff"] },
  "cursor": { "text": "", "font": "16px 'Syndicat Grotesk', Arial, sans-serif" } }
```

```html
<a href="/projekti/vrtec" data-diffmap-text="Vrtec Ljubljana">…</a>
```

Measured in Chromium and WebKit (`node test/pilot.mjs`):

| | over white | over red |
| --- | --- | --- |
| classic difference label | rgb(255, 53, 35) | rgb(255, 182, 212), pink |
| diffmap swap | **rgb(255, 20, 8)** | **rgb(255, 255, 255)** |

Swap uses `lighten` and `darken` layers so each channel can clip at 0 and 1, which is exactly what this needs.

## Same on every platform

Blend modes are computed in whatever color space the browser composites in, and that isn't the same everywhere. Browsers on Windows composite in sRGB; browsers on macOS composite in Display P3 when the screen supports it. The spec leaves this to the browser. The same `mix-blend-mode` CSS therefore gives different colors on a Mac and on a PC — which is why a difference label can look right on one and pink on the other.

diffmap does all of its math in the space the browser actually blends in, and writes the layer colors in that space (`color(display-p3 …)` on P3), so the colors you pin (swap colors, anchors) come out the same on both:

- `colorSpace: "auto"` (default) picks Display P3 for Safari and Chromium on a wide-gamut Mac, sRGB everywhere else.
- `colorSpace: "srgb"` or `"display-p3"` forces one.
- The setup page has a **platform check**: two rows of squares, one per space. On your machine, the row whose squares match is the space your browser blends in. If auto picks the other one, set `colorSpace` and tell us your browser and OS.

Status: confirmed on a real Mac: Safari 27 blends in Display P3, and diffmap's P3 math lands the swap colors exactly there, while sRGB math comes out visibly off (test/blend-check.html, boxes 6 and 7).

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

**1. Blend layers — everything on the page.** CSS blend modes work on each color channel separately. Three stacked layers (`multiply`, `difference`, `difference`) compute any per-channel map `out = A + (B − A) · in`, where A is what black turns into and B is what white turns into. When the map has to clip at 0 or 1 (brand red ↔ white does), up to eight layers add `lighten`, `darken` and `color-dodge`, which gives any `clamp(a + d · in)` per channel. This runs on the GPU compositor in every browser. It can follow your full node map only along straight lines per channel, so diffmap fits it to your map and makes your site's **text and background colors land exactly** (the `anchors`). Classic white difference is the special case A = white, B = black.

**2. Node map — images and video.** For each `[data-diffmap]` image, diffmap reads the pixels once, runs them through your full 8-node color cube, and keeps the result as a hidden copy that only shows inside the cursor. That copy is pre-corrected for the blend layers that still sit on top, so after both engines the image comes out exactly as your map says, and text on top of it still matches the rest of your text. Video is recolored per frame with WebGL, only while the cursor is over it.

**Clean edges.** Blend layers don't compose linearly, so a rim pixel that every layer covers halfway comes out as a colored fringe. diffmap never half-covers: the layers are opaque squares on whole device pixels, and a gradient fades the *strength* of the effect to zero over the last `edge` pixels of the circle. Strength-faded maps are still per-channel affine, so the same three layers render them exactly, and at zero strength the layers are an exact no-op. The text cursor does the same per pixel, using the glyphs' anti-aliasing as the strength.

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
  "position": "auto",                   // "fixed" | "absolute" | "auto"
  "colorSpace": "auto",                 // "auto" | "srgb" | "display-p3": the space this browser blends in
  "edge": 1.25,                         // circle: px over which the effect fades out; larger = feathered
  "cursor": null                        // circle by default, or one of:
  // { "text": "hello", "font": "700 120px Arial" }    the word is the cursor
  // { "image": "/painting.jpg", "width": 260 }        a picture, differenced with the page
}
```

### Cursor shapes

- **Circle** (default). Grows over links and buttons.
- **Text.** The word itself is the cursor; the inside of every glyph gets the effect, with clean anti-aliased edges.
- **Image.** The picture reacts to what's under it: over white it shows as it is, over black it turns into its negative, and every other color lands in between, per channel (`F(|page − picture|)`, colored by your palette). Images marked `data-diffmap` get the blend layers here, not the node map, since the result depends on the moving picture.

| Attribute | Effect |
| --- | --- |
| `data-diffmap` | on `<img>`/`<video>`: use the full node map |
| `data-diffmap-palette="name"` | use a named palette inside this element (tweens between palettes) |
| `data-diffmap-size="120"` | cursor size while over this element |
| `data-diffmap-grow` | grow like a link |
| `data-diffmap-ignore` | skip media inside this element |
| `data-diffmap-text="Label"` | text cursor: show this label while over the element (empty `cursor.text` = labels only) |

**Swap** (`"mode": "swap", "colors": [a, b]`) makes two colors trade places exactly, in every browser, on any content. Everything else follows the same rule per channel. Use it for a brand color on white.

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
diffmap setup --swap "#ff1408,#fff" --text ""   brand red ↔ white, hover labels from data-diffmap-text
diffmap setup --text "hello"                   cursor shapes: --text, --image <url> --width <px>, --circle
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

| | Blend layers | Images (node map) | Video (WebGL) | Blends in |
| --- | --- | --- | --- | --- |
| Chrome / Edge on Windows | ✓ checked by hand | ✓ | ✓ | sRGB |
| Chrome on macOS | ✓ checked by hand | ✓ | ✓ | Display P3 on wide-gamut screens |
| Safari 27 on macOS | ✓ every technique blends (test/blend-check.html) | needs a check | needs a check | Display P3 |
| Chromium, WebKitGTK (Linux) | ✓ pixel-tested | ✓ pixel-tested | Chromium ✓ | sRGB |
| Firefox | needs a check | needs a check | needs a check | ? |

`test/blend-check.html` renders 22 techniques next to what they should look like. Open it in any browser to see what that browser blends and in which color space (boxes 6 vs 7).

WebKitGTK (Linux) only blends layers that aren't composited on their own, so there diffmap moves the layers with 2D transforms inside a scroll-following box (`position: "absolute"`). Everywhere else, Safari included, it uses `position: fixed`. On WebKitGTK a `<video>` anywhere on the page also stops blending for the whole page.

## Development

```sh
npm test                           # color math
node test/pixel.mjs chromium webkit firefox   # screenshots vs. the math, per pixel
```

The pixel test renders a page with text, color swatches, a photo, text over the photo and a dark section, moves the cursor over each, and checks every pixel inside the circle against the formula. It also checks the circle's rim and the text cursor's glyph edges for fringes (every rim pixel must lie between the untouched page and the full effect), and the image cursor against `|page − picture|` per pixel. Current results: worst error 2.5/255 inside, 1.7/255 on rims, in Chromium and WebKit; no change outside the circle at device pixel ratios 1, 1.25, 1.5 and 2.

## Credits

The setup page's image cursor uses J. M. W. Turner's *The Fighting Temeraire* (1839), public domain, from the [aquarelle](https://www.npmjs.com/package/aquarelle) package.

## License

MIT
