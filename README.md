# tools.maticahlin.com

Small, dependency-free building blocks for websites — the things we kept rebuilding on client projects.

| Package | What it does |
| --- | --- |
| [`@maticahlin/diffmap`](packages/diffmap) | A difference-blend cursor whose colors you control, on text, images and video, in every major browser. |

More to come: page transitions and layout blocks.

## Working on this repo

```sh
npm install
npm test                                   # unit tests in every package
node packages/diffmap/test/pixel.mjs       # pixel tests in real browser engines
```

Each package lives in `packages/<name>` with its own README and an `AGENTS.md` for coding agents.
