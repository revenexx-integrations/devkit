---
'@revenexx/integrations-node-devkit': patch
---

Build before publishing, so the tarball actually contains `dist/`.

`files` is `["dist", "assets"]` and nothing ever ran `tsup` during the release, so
`changeset publish` packed an unbuilt tree: **0.2.0 shipped without `dist/` entirely** (four
files, 10 kB) and `npm install @revenexx/integrations-node-devkit` yielded a package whose
`bin`, `main` and both `exports` subpaths pointed at files that were not there. 0.1.0 only
escaped this because it was packed from a working tree that happened to be built.

The SDK guards this with `prepublishOnly: npm run build`; the devkit lost that script when it
was derived from the SDK. It is back, so the two match again. `publish.yml` additionally runs
`npm run build`, so a broken build surfaces before the publish step.

Also fixes `integrations-devkit --version` reporting a stale version. `DEVKIT_VERSION` was a
hardcoded constant that `changeset version` never touched, so it still said `0.1.0` after the
0.2.0 release. It is now read from `package.json` at runtime and cannot drift. That needs
tsup's `shims: true`: esbuild stubs `import.meta` as `{}` in the CJS output, so without the
shim the `require` entry would throw `Invalid URL`.
