---
description: Add the diffmap cursor to this site — pick colors in a local editor, then wire it up
---

Set up the diffmap cursor in this project. Follow `node_modules/@maticahlin/diffmaps/AGENTS.md` if it exists; otherwise these steps:

1. Find the site's main text color and page background in the CSS or design tokens.
2. Run `npx @maticahlin/diffmaps setup` and tell me the editor is open in my browser. Wait for the command to exit (it exits when I press "Save to project"). If I already named colors in $ARGUMENTS, skip the editor and pass them as flags instead (`--swap`, `--preset`, `--nodes`, `--anchors`, `--duotone`, `--text`).
3. Run `npx @maticahlin/diffmaps check --json` and tell me in one or two lines how exact the result is.
4. Install the package and start `diffmap(config)` client-side in the app's root layout (or use `npx @maticahlin/diffmaps vendor` for a site without a bundler).
5. Add `data-diffmap` to the hero images or videos, and tell me which ones you marked.
