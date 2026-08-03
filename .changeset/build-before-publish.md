---
'@revenexx/integrations-node-devkit': patch
---

Build before packing, so the published tarball actually contains `dist/`.

`files` is `["dist", "assets"]` and nothing ever ran `tsup` during the release, so
`changeset publish` packed an unbuilt tree: **0.2.0 shipped without `dist/` entirely** and
`npm install @revenexx/integrations-node-devkit` yielded a package with no entry points,
no `bin` target and no types. 0.1.0 only escaped this because it was packed from a working
tree that happened to be built.

A `prepack` script now builds on every `npm pack` and `npm publish` — `prepack` rather
than the SDK's `prepublishOnly` because it also covers a plain `npm pack`, which is how
the empty tarball was first visible. `publish.yml` additionally runs `npm run build`
explicitly, so a broken build fails the workflow rather than the registry.

Also stops `DEVKIT_VERSION` from drifting: `changeset version` only rewrites
`package.json`, so the constant behind `integrations-devkit --version` still said `0.1.0`
after the 0.2.0 release. `scripts/sync-version.mjs` now rewrites it from `package.json` as
part of the `version` script, mirroring how the Pipedrive node package keeps its manifest
version in step.
