# @revenexx/integrations-node-devkit

## 0.2.1

### Patch Changes

- 34d0f37: Build before publishing, so the tarball actually contains `dist/`.

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

## 0.2.0

### Minor Changes

- 0f442ce: Load a `.env` automatically so seeds' `${ENV_VAR}` references resolve without exporting
  variables by hand — which is what the docs already promised.

  The file is read before option parsing, so it can also supply `PORT`. Values already
  present in the environment are never overwritten, so `MY_KEY=… npm run preview` still
  overrides the file. New flags: `--env <path>` to point elsewhere and `--no-env` to opt
  out. A missing default `.env` is ignored; a file named explicitly and missing is an error,
  so a typo fails loudly instead of resurfacing as a puzzling seed error.

  The flag is `--env` rather than `--env-file` because Node reserves `--env-file` and
  `--env-file-if-exists` and acts on them wherever they appear, including after the script
  path — `--env-file missing.env` dies inside Node before the CLI runs. Passing one is
  accepted rather than rejected, with a note pointing at `--env`.

  Requires Node >= 20.12 for `process.loadEnvFile`; on older runtimes the file is skipped
  with a warning rather than crashing.
