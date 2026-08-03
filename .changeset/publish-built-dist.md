---
'@revenexx/integrations-node-devkit': patch
---

Build the package before packing, so the published tarball actually contains `dist/`.

`0.2.0` shipped without any code: `files` lists `dist`, but the release workflow ran
`npm ci` followed straight by `changeset publish`, and nothing built in between. The
tarball held only `assets/`, `README.md`, `LICENSE` and `package.json`, so `bin`
(`dist/cli.js`), `main` and both `exports` subpaths pointed at files that were not there
— `npx integrations-devkit` and `import '…/testing'` both failed on a fresh install.
`0.1.0` escaped this only because it was published by hand from a checkout that already
had a build.

Fixed with a `prepack` script rather than a workflow step, so the build is guaranteed for
`npm publish` and `npm pack` alike, whoever runs them.
