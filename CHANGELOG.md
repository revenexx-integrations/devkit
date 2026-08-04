# @revenexx/integrations-node-devkit

## 0.4.0

### Minor Changes

- 42b1d5f: Make two previews at once actually work, and say so when they cannot

  Running `preview` in a second repo failed with a raw `EADDRINUSE` stack trace — after the
  multi-minute `npm install`, and possibly orphaning the Nuxt child. The port was only the
  symptom: parallel previews were broken by construction, and that error was the sole thing
  preventing them.

  Two repos previewing out of the shared host destroyed each other. Vite anchors its
  dependency cache on `rootDir` — the shared directory — while invalidating it on a hash that
  covers the per-repo build dir, so each instance judged the other's cache stale and `rm -rf`'d
  the directory the other was serving from. Meanwhile the shared `.env`, rewritten every run
  because it carries the mock's port, made Nuxt respawn every _other_ running preview. The two
  fed each other indefinitely. The per-repo build dir, documented as what made this safe, was
  the thing that caused it.

  - Each repo now gets its own Vite cache (`.vite-<hash>/`) and dotenv file (`.env.<hash>`)
    beside its build dir, and sibling build dirs are ignored so a starting preview no longer
    forces a full reload in the running ones.
  - `preview` refuses a second run by default, naming the repo, pid and ports of the one it
    found — most often a preview forgotten from an earlier session. `--parallel` runs both.
  - The mock's **default** port moves to the next free one and says so; an **explicit**
    `--port` or `$PORT` is honoured or reported as a conflict, never silently relocated.
    `--port abc`, and `--port` with no value, are now errors instead of `NaN` and a silent
    fallback.
  - `PORT` no longer leaks into the Nuxt child, where listhen also reads it: `PORT=4000
preview` used to have the mock and the UI both claim 4000. The UI's URL is now printed by
    Nuxt, which is the only party that knows the port it got.
  - `npm install` in the shared host is serialized with a lock, and `--force` is refused while
    a preview is running rather than reinstalling under it.
  - The mock binds before the copy and install, so a port clash or an unloadable entry costs
    seconds instead of minutes.
  - A change to the shipped `preview-host/` now re-copies within the same devkit version,
    which version-keying alone never covered.

## 0.3.0

### Minor Changes

- 5d0b2f1: Move the preview host out of consuming repos, and verify the mock against the real API contract.

  **The Nuxt preview host is no longer scaffolded into your repo.** It now ships as real
  files (`preview-host/`) and is materialized into a version-keyed cache directory —
  `${XDG_CACHE_HOME:-~/.cache}/revenexx/devkit-preview/<devkit-version>/` — so every node
  package on a machine shares one dependency install. Your repo keeps only
  `.revenexx-dev/state.json`.

  Why: a per-repo copy was skipped whenever the directory already existed, so a devkit
  upgrade never reached it and left a silently stale host behind — unfixable for external
  node authors. Keying the directory by devkit version makes that impossible. It also ends
  ~500 MB of duplicated dependencies per repo, and makes the studio/Nuxt pins visible to
  Dependabot (they were string literals in the old generator).

  - An existing `.revenexx-dev/preview/` is now unused. `preview` says so once; delete it
    to reclaim the space.
  - `--force` now actually reinstalls. It used to rewrite `package.json` with new pins and
    then skip `npm install` because `node_modules/` existed, booting Nuxt against the old
    tree.
  - `init-preview` now **requires** `--dir`. It exists to give you an unmanaged copy to
    modify; the managed copy is `preview`'s business and is replaced on version bumps.

  **The mock is now checked against the service's OpenAPI contract** (`contract/integrations-v1.json`,
  refreshed with `npm run refresh-contract`). `tests/contract.test.ts` requests all 49
  contract paths and asserts route, status code and declared response properties, with
  explicit allowlists for what is deliberately not mocked. This is what will go red when a
  new `@revenexx/studio-integrations` expects an API the mock no longer satisfies.

  That found nine real divergences, all fixed:

  - **`POST`/`PUT /workflows` read `body.definition`, but the contract (and the UI) send
    `blob`** — so every workflow saved from the real UI silently stored an empty graph.
    Workflows now carry `blob`, `blob_definition_version`, `description`, `active`,
    `execution_mode`, `revision` and `warnings`. Store schema version bumped to 2, so a
    pre-existing `state.json` is discarded rather than misread; workflow seeds accept
    `blob` and still accept the old `definition`.
  - **`GET /me` returned a flat `{id, name, email, tenant_id}`** instead of the contract's
    `{user, context, claims}`.
  - **All `DELETE`s answered `200 {deleted:true}`** instead of `204` with no body.
  - **`GET /secrets` returned `{data:[…]}`** instead of `{keys: […]}` — the envelope the UI
    carries a three-way fallback for.
  - **The two schema routes had the same shape.** `GET /schemas/{domain}` is a version
    listing (`{domain, versions}`); `GET /schemas/{domain}/{version}` wraps the schema
    (`{domain, version, schema}`).
  - **`GET /templates/{slug}` was not wrapped in `data`**, and
    `…/requirements` used `credentials` where the contract says `credentialTypes`.
  - **`GET /nodes` omitted `package` and sent null timestamps.** The package identity is now
    read from your `package.json` and the timestamps report when the mock loaded the entry.
  - **`POST /credentials/{id}/test` returned a bare `{ok}`.** It now records the outcome and
    reports `message`, `last_test_at`, `last_test_ok` like the service does.
  - **Missing `images`** on credential types and templates; template triggers always carry
    `config`.

  New endpoints:

  - **`POST /nodes/{slug}/{version}/execute:test`** runs your node's real `execute` in-process
    and returns `{outputs, branch, logs}`, honouring `timeout_ms` (floor 1000 ms).
  - `DELETE /nodes/{slug}/{version}` and `GET /up` (the service's health path).

  Note that `POST /nodes/{slug}/{version}/config:validate` is a **devkit-only** endpoint —
  it does not exist in the real API. It is listed in the test's `DEVKIT_ONLY` and called out
  in the docs; do not write node code that depends on it.

  Two things about the shared host that follow from sharing it:

  - The dependency install is shared, the **build is not**. Each repo compiles into its own
    `.nuxt-<hash>/` inside the host directory, so two node packages can be previewed at the
    same time.
  - An unmanaged `--dir` copy keeps its `.env` once written — that copy is yours. The managed
    one is refreshed every run, because its API URL follows `--port`.

  `GET /schemas/{domain}/{version}` now 404s an unknown version instead of falling back to
  the latest schema, which had it answering 200 for any version string at all.

### Patch Changes

- 5d0b2f1: Hot-reload now notices `.mjs`, `.cjs`, `.jsx` and `.json` changes.

  The watcher's filter was the TypeScript family plus a bare `.js`, so a package whose entry
  is a built ESM `dist/index.mjs` never reloaded: edits landed, the mock kept serving the old
  manifest, and nothing was logged to say why. `.json` is included too, because a node that
  imports locale strings or lookup data from one has to re-evaluate when it changes.

  The filter is now `isReloadableSource()` in `src/loader.ts`, next to the loading it gates,
  with tests — it used to be an inline regex in the watcher callback, which is a good part of
  why the gap was easy to miss.

## 0.2.2

### Patch Changes

- 3c39456: Fix a repeated `--env` being silently ignored, and explain a bare environment name.

  `resolveEnvFile` located the flag with `argv.indexOf('--env')`, so only the _first_
  occurrence was ever read while `parseArgs` skipped the rest without complaint:
  `--env one.env --env two.env` loaded `one.env`. It now resolves to the last one, matching
  every other option in the CLI, whose parse loop simply overwrites. Every occurrence is
  still validated, so `--env --env ok.env` reports the malformed first one rather than
  quietly accepting the second.

  `--env` takes a path, not Laravel's bare environment name — it mirrors Node's `--env-file`,
  and a path can point outside the package (`--env /run/secrets/env`). Passing a name used to
  fail with a flat "does not exist"; when the matching `.env.<name>` is sitting right there,
  the error now names it:

      --env: /pkg/staging does not exist. Did you mean --env .env.staging?
      The flag takes a path, not an environment name.

  `--env` continues to _replace_ the default `.env` rather than layering on top of it, and a
  shell variable still beats the file.

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
