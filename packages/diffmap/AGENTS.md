# diffmap — instructions for coding agents

diffmap is a cursor that recolors whatever is under it: a "difference" hover effect where the user picks the colors. This file tells an agent (Claude Code, Cursor, Codex, …) how to add it to a project.

## When the user asks for it

Typical asks: "add the diffmap cursor", "set up diffmap", "difference cursor in our brand colors", "/diffmap-setup".

## Steps

1. **Find the site's two main colors.** Look for the body text color and the page background in the CSS, tokens or Tailwind config (e.g. `--color-text`, `body { color }`, `theme.colors`). These become `anchors`; the cursor renders them exactly.

2. **Make the palette.** Pick one:
   - The user is at the keyboard and wants to choose colors → run the editor and wait. It opens a page on localhost, the user presses "Save to project", and the command exits:
     ```sh
     npx @maticahlin/diffmap setup
     ```
   - The user already gave colors, or you are running unattended → write the config directly:
     ```sh
     npx @maticahlin/diffmap setup --preset ultramarine --anchors "#111111,#ffffff"
     npx @maticahlin/diffmap setup --nodes '{"black":"#f4efe6","white":"#141414","red":"#ffd400"}' --anchors "#111,#fff"
     npx @maticahlin/diffmap setup --duotone "#1a1aff,#ff5a36"
     ```
   Both write `diffmap.config.json` in the current directory (`--out` to change it). Add `--json` to get a machine-readable report.

3. **Read the report.** `npx @maticahlin/diffmap check --json` returns how exact the palette is:
   - `anchors[].offBy` should be 0–1. If not, tell the user which site color can't be matched and why (their nodes don't lie on a straight line per channel).
   - `imagesOffBy` above ~4 means some node colors fall outside what the black/white nodes span. Mention it; it's a design choice, not an error.

4. **Install and start it.**
   - With a bundler (Vite, Next, Astro, SvelteKit, …):
     ```sh
     npm i @maticahlin/diffmap
     ```
     ```js
     import { diffmap } from '@maticahlin/diffmap';
     import config from './diffmap.config.json'; // move the file next to the code that imports it
     diffmap(config);
     ```
     In React/Next, call it in a client-only effect and clean up: `useEffect(() => diffmap(config).destroy, [])`. Never call it during server rendering.
   - Without a bundler (plain HTML, WordPress, Webflow embed):
     ```sh
     npx @maticahlin/diffmap vendor public/diffmap
     ```
     then add the printed `<script type="module" …>` tag before `</body>` and serve `diffmap.config.json` from the site root.

5. **Mark the images and video** that should get the full color map: add `data-diffmap` to each `<img>` or `<video>` (or pass `media: true` to include all of them). Images from another domain need CORS (`crossorigin="anonymous"` on the tag plus an `Access-Control-Allow-Origin` header on the server); without it they still work but use the simpler fallback.

6. **Optional per-section palettes:** add `palettes: { hero: {…} }` to the config and `data-diffmap-palette="hero"` to the section. `data-diffmap-size="120"` sets the cursor size over an element. Links and buttons grow the cursor automatically.

## Things to check after installing

- The page (`html` or `body`) must have a background color. diffmap sets white if neither has one and logs a note.
- Don't put the effect inside an element with `isolation: isolate`, `opacity < 1`, `filter` or `mix-blend-mode` and expect it to see outside it; diffmap adds its layers at the document level, so this only matters if a user moves them.
- Touch-only devices get nothing (no hover). That is intended.
- `prefers-reduced-motion` turns off the follow smoothing.

## Do not

- Don't hand-write the blend layer colors; always go through the config, since the math has to match the node map.
- Don't open the editor in an unattended run (CI, scheduled jobs); use the flags.
