# @revenexx/integrations-node-devkit

## 0.7.0

### Minor Changes

- a3f5a19: Support `ctx.state`, the tenant state store nodes gained in PO-374.

  `createMockContext` now builds a `state` mock, and it is **stateful**: what the
  node writes, it reads back. A node's interesting behaviour is the second run —
  the one that finds the mapping it created the first time — and a mock that
  forgot would only ever exercise the create branch. Seed what earlier runs left
  behind with `state: { mappings, cursors, claims, digests }`, force the engine's
  refusal with `stateError`, and assert on the calls: every operation is a
  `vi.fn()`.

  It reads back _when the store would let it_. A mapping and a claim take effect
  immediately; a cursor and a digest are staged and adopted only once the run
  completes, so `cursor.get` answers what the last completed run left. The mock
  context gains `completeRun()` for that ending — call it between two `execute`
  calls to play the second run, leave it out to play the run that failed after
  advancing its watermark. Re-pointing either side of an existing correlation is
  refused, and a `ttlSeconds` outside 1…31536000 is refused rather than clamped:
  the rules a node would otherwise meet for the first time in production.

  The local preview's `execute:test` is wired to the dev store too, so a node that
  correlates ids behaves on its second call like a second run, and a preview call
  that fails leaves its staged cursors and digests behind. That the store is
  writable at all is a deliberate divergence from production, where author-time
  execution is read-only — see the fidelity caveats in the README.

  `POST /nodes/{slug}/{version}/config:validate` now honours `showIf` and knows
  `state-ref`, the two config-field additions that ride along in the same SDK
  release (PO-410, PO-374). A setting whose condition does not hold is skipped
  whole — not demanded when required, not type-checked either, because the editor
  does not draw it — using the SDK's own `settingApplies` rather than a second
  copy of the rule. That covers a `dynamic-schema` marker carrying the condition:
  the group it stands for is neither demanded nor resolved, so no author-time
  resolver runs for a group nobody is looking at. A `state-ref` is checked as the
  namespace name it carries.

  Requires `@revenexx/integrations-node-sdk` >= 1.0.0, which is where
  `INodeContext.state` is declared. That SDK release is a major one precisely
  because `state` is required — and this package is the reason it is felt
  immediately: `MockContext` is `INodeContext & {…}`, so it cannot compile against
  the new contract without supplying `state`.

### Patch Changes

- 4394123: The preview host pins `@revenexx/studio` ^0.2.2, so its dependencies install again

  Moving the host to `@revenexx/studio-shared` ^0.3.0 left `@revenexx/studio` at `^0.1.3`,
  and 0.3.x peers `@revenexx/studio` `^0.2.0`. Because a caret on a 0.x version pins the
  minor, `^0.1.3` can never reach 0.2.x — so the two pins were unsatisfiable together and
  `npm install` in the copied host failed outright with `ERESOLVE`, before Nuxt ever booted.
  The devkit runs a plain `npm install` with no `--legacy-peer-deps`, so nothing papered over
  it: every fresh preview was broken, not merely resolving oddly.

  0.2.2 is the current release. Its only new peer, `vue-sonner` `^2.0.9`, is already
  satisfied by the host's `^2.0.0` pin.

  `@solar-icons/nuxt` stays on ^1.2.1 deliberately. Dependabot groups it with studio and
  offers ^2.1.0, but `@revenexx/studio-shared` 0.3.x peers `@solar-icons/nuxt` `^1.2.0` in
  both of its releases, so the major would trade this conflict for the same one one package
  over — and v2 reworks the module options and the auto-import names the studio components
  rely on. It waits until studio-shared moves.

## 0.6.0

### Minor Changes

- 9f77507: The preview host moves to `@revenexx/studio-integrations` 1.1.1

  The pin was 0.6.0, four releases and one major behind. The major (1.0.0) is about the
  workflow editor — one Save in the header, every dialog left by Cancel or Done — which the
  preview does not show, and it left `NodeInspector` alone: `update` is still emitted only
  when the draft is `dirty`, `close` still always, and `refusedFields` is still there. So the
  node preview's arrangement from 0.5.1 — the key stamped onto `selection` that makes `dirty`
  permanently true, which is what tells a Save from a Cancel — holds unchanged. The upstream
  `save` event that would retire it still does not exist.

  What the node preview gains is 1.0.0's reading of a manifest's `inputs`: the panel of
  available data now opens with what the node itself takes — data type, whether an upstream
  connection is required, and the publisher's sentence about it — and an output port's and
  field's descriptions appear on the Output tab and on the handle's tooltip. The studio had
  been asking the catalogue under a key the service does not use and dropping all of it. The
  mock passes the manifest through verbatim, so a node package that describes its ports gets
  this with no devkit change.

  `@revenexx/studio-shared` moves to ^0.3.0 with it, which is what 1.1.1 requires, and that
  brings two dependencies the host did not need before. 0.3.0 adds the Talkback realtime
  seam, and its `talkback.js` reaches for `@revenexx/talkback-js` through a dynamic import
  that Rolldown must still resolve — so `nuxt build` fails outright without the package, even
  though the composable is inert while `talkbackHost` is empty, which in the preview it always
  is. `@revenexx/talkback-js` and its own peer `centrifuge` are therefore direct dependencies
  of the host: present so the bundler can resolve them, never connected to.

  **Where the preview is now thinner than production.** studio 1.1.0 stopped assembling the
  tenant's runs, counts and schedules in the browser and reads the platform's own lists
  instead — `GET /runs`, `/runs/summary`, `/runs/latest-per-workflow`, `/schedules` and
  `/dead-letters/summary`. The mock serves none of them, so the Integrations dashboard's
  figures and the Schedules page report a refused read rather than the zeroes they used to
  show. That is the phase-1 boundary the workflow editor is already behind, and it is not new
  scope — but it is newly visible, and the guard that should have said so was asleep: the
  vendored contract snapshot predates all five endpoints, so `tests/contract.test.ts` passes
  while the mock lacks them. Refreshing it is its own change — it also surfaces a renamed
  trigger path parameter and a widened `secrets` response — and is not done here.

## 0.5.1

### Patch Changes

- 681133d: Cancel closes the node preview's config dialog again

  0.5.0 stopped the dialog vanishing on a Save that had nothing to report, but paid for it by
  making Cancel stop closing: studio's `NodeInspector` emits `update` only when its draft is
  dirty and then always emits `close`, so a Save on an untouched form is byte-for-byte what
  Cancel emits. Unable to tell them apart, the page held both — and an X that closes next to a
  Cancel that does not is worse than the bug it replaced.

  The distinction is now restored at the source of the ambiguity rather than worked around
  downstream. `dirty` is a JSON comparison of the inspector's draft against the `selection`
  prop; the page stamps a key onto `selection` once the inspector has cloned its draft, which
  makes that comparison permanently unequal. Save therefore always emits `update` first, and a
  bare `close` can only be Cancel, the header ✕, Esc or the backdrop. The inspector renders
  from its own draft, so the key never reaches the form or a validated payload — its one trace
  is a permanent "Unsaved changes" in the footer, which in a preview that persists nothing is
  not even wrong. The strip explaining the old arrangement is gone, and the dialog goes back to
  the editor's own chrome.

  This leans on how `dirty` is computed in `@revenexx/studio-integrations`, which is why the
  page says so at length. The real fix is a `save` event on the inspector that fires regardless
  of `dirty`; until that exists upstream, this holds the behaviour.

## 0.5.0

### Minor Changes

- 28c4107: The node preview says why a config is refused instead of closing on it

  Opening a node in the preview, pressing Save without filling anything in, and watching the
  lightbox vanish in silence was the fastest way to reach the mock's validation — and it never
  got there. Two separate faults, both on the way back from the inspector.

  Studio's `NodeInspector.save()` emits `update` only when the draft is _dirty_, then always
  emits `close`. The page kept the dialog open by flipping a flag inside the `update` handler,
  so an untouched form — exactly the "is this field required?" case — handed it nothing but a
  `close` and was discarded unvalidated. From the page the two are indistinguishable: Cancel
  looks the same. Since a preview has nothing to persist, both footer buttons now mean _check
  this config_: a `close` from the inspector validates and keeps the dialog open, and leaving
  is the dialog's own ✕, Esc or backdrop — which the dialog now shows a close button for, and
  a strip at the top of the lightbox states outright.

  The per-field highlight was promised by a prop that did not exist. `refusedFields` landed in
  `@revenexx/studio-integrations` 0.6.0 while the host pinned 0.5.1, so the binding fell
  through as an inert attribute and "N Feld(er) prüfen (rot markiert)" marked nothing. The
  host moves to 0.6.0, and the verdict strip also lists each refused key with its message —
  a field can sit behind a collapsed optional section or off-screen, where a colour alone is
  not an explanation.

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
