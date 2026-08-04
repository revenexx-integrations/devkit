---
"@revenexx/integrations-node-devkit": patch
---

Hot-reload now notices `.mjs`, `.cjs`, `.jsx` and `.json` changes.

The watcher's filter was the TypeScript family plus a bare `.js`, so a package whose entry
is a built ESM `dist/index.mjs` never reloaded: edits landed, the mock kept serving the old
manifest, and nothing was logged to say why. `.json` is included too, because a node that
imports locale strings or lookup data from one has to re-evaluate when it changes.

The filter is now `isReloadableSource()` in `src/loader.ts`, next to the loading it gates,
with tests — it used to be an inline regex in the watcher callback, which is a good part of
why the gap was easy to miss.
