# Changelog

## 0.1.0 — 2026-10-22

First release.

- Difference cursor with 8 editable color nodes; images and video get the full node map, page content the closest per-channel match.
- `swap` mode: two colors trade places exactly (brand color ↔ white).
- `duotone` mode: brightness mapped to a two-color ramp.
- Cursor shapes: circle, text (including hover labels from `data-diffmap-text`), image.
- Same colors on Windows and macOS: blend math runs in the browser's compositing space (sRGB, or Display P3 on wide-gamut Macs).
- Text cursor matches `-webkit-font-smoothing: antialiased` on macOS.
- Fringe-free edges, images recolored in a Web Worker, 11.8 KB gzipped, TypeScript types.
- `npx diffmaps setup`: local palette editor, plus flags for coding agents.
- Tested on every push: Windows, macOS and Linux × Chrome, Firefox and WebKit.
