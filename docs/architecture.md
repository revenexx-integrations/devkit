# Architecture

The devkit is three pieces: a package loader, an in-memory store behind a mock HTTP API,
and a scaffolded Nuxt host that runs the real Cockpit UI against that API.

```
your node package (src/index.ts)
        │  loaded in-process by tsx, re-imported on change
        ▼
   DevStore  ──►  mock /api/v1  ──►  Nuxt preview host  ──►  browser
   (seeds +        (node:http)       @revenexx/studio-      localhost:3000
    overlay)       localhost:3555     integrations           /integrations
```

## Loading your package

`src/loader.ts` registers `tsx` and imports your entry **in the devkit's own process**.
There is no bundling step and no forked sandbox. A file watcher re-imports the entry on
change, so `loadOptions`, `resolveConfigSchema`, `resolveOutputs`, `test` and `resolve`
always run against your current source.

The entry defaults to `src/index.ts`, falling back to `dist/index.js`.

## The mock API

`src/server.ts` builds a plain `node:http` request listener. Everything is served under
`/api/v1` (the prefix is stripped before routing):

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness — `{"status":"ok"}`. |
| `GET /me` | A single fixed dev user and tenant. |
| `GET /schemas/{domain}[/{version}]` | Vendored JSON schemas. |
| `/nodes` | Node listing and manifests. |
| `/credential-types` | Credential type definitions from your package. |
| `/credentials` | Credential instances, plus `test`, `resolve` and the OAuth endpoints. |
| `/secrets` | Secret store. |
| `/templates` | Node templates. |
| `/workflows` | Workflow CRUD. |

Two node endpoints do the interesting work:

- `POST /nodes/{slug}/{version}/config:resolve` — runs your author-time resolvers so the
  UI can render dynamic options and schemas.
- `POST /nodes/{slug}/{version}/config:validate` — validates a config payload against
  the manifest's field rules and returns per-field errors.

OAuth is mocked end to end: `POST /credentials/{id}/oauth/authorize-url` builds the
authorize URL, and `/credentials/oauth/callback` exchanges the code.

## The preview host

The Cockpit UI ships as the Nuxt **module** `@revenexx/studio-integrations` — Vue
components and composables, not a static bundle — so it needs a Nuxt app around it.
That app lives in this package as real files under `preview-host/`.

The host registers `@revenexx/studio-shared`, `@solar-icons/nuxt` and
`@revenexx/studio-integrations` as Nuxt **modules**, and points
`runtimeConfig.public.integrationsApi` at the mock. No auth shim is required: the
standalone `usePlatformAuth` / `usePlatformTenant` from `@revenexx/studio-shared` read a
dev token and tenant from `NUXT_PUBLIC_DEV_TOKEN` / `NUXT_PUBLIC_DEV_TENANT`, which the
devkit sets and the mock ignores.

### Where the host runs, and why not in your repo

`integrations-devkit preview` copies `preview-host/` into a **version-keyed cache
directory** — `${XDG_CACHE_HOME:-~/.cache}/revenexx/devkit-preview/<devkit-version>/` —
and installs its dependencies there once (`src/preview/host.ts`). Your repo only ever
holds `.revenexx-dev/state.json`.

Earlier versions scaffolded the host into `.revenexx-dev/preview/` per repo. That had
three costs, all of which this removes:

- **It went stale silently.** The scaffold was skipped whenever the directory already
  existed, so a devkit upgrade never reached it. Keying the directory by version makes
  a stale host impossible — a new version is a new directory.
- **Every repo paid for its own dependency tree** (~500 MB of the same packages).
- **The dependency pins were invisible to Dependabot**, because they lived as string
  literals in the generator rather than in a real `package.json`.

The consequence is that the managed copy is a **disposable artifact, not yours to
edit** — it is replaced on the next version bump. That is deliberate: the host's whole
value is the claim "this is what the real Cockpit looks like", and a locally patched
host voids it. If you do want to change it, take an explicit unmanaged copy:

```bash
integrations-devkit init-preview --dir ./my-preview
```

That copy is never updated by devkit upgrades, and `preview --dir ./my-preview` runs it. Its
generated `.env` is written once and then left alone, unlike the managed one which is
refreshed every run.

### What is shared, and what must not be

The ~500 MB dependency tree is shared — that is the whole point. Everything a *running*
Nuxt instance writes or watches must not be, and getting that list wrong is not a
performance question: two previews sharing any of these actively break each other.

| Per repo | Env var | Why it cannot be shared |
| --- | --- | --- |
| `.nuxt-<hash>/` | `DEVKIT_NUXT_BUILD_DIR` | Two repos would compile into one `.nuxt/`, and the second to start would serve the first one's app. |
| `.vite-<hash>/` | `DEVKIT_VITE_CACHE_DIR` | Vite's dependency cache — see below. |
| `.env.<hash>` | passed as `nuxt dev --dotenv` | Nuxt watches its dotenv file and *respawns* when it changes. The managed file carries the mock's port, so it is rewritten every run — a shared one restarted every other preview. The dedupe is mtime-based, so identical content did not help. |

`<hash>` is the first 12 hex digits of `sha256(cwd)`, so each is stable across runs — the
caches still pay off — and distinct per repo.

The Vite cache is the one worth understanding, because for a while the build-dir split
alone was not merely insufficient but the direct cause of the worst failure. Vite anchors
`cacheDir` on `rootDir` (the *shared* host), not on the build dir, so all repos used one
`node_modules/.cache/vite`. Vite invalidates that cache on a `configHash` computed over
`resolve.alias` — which contains Nuxt's `#build` alias — which is the per-repo build dir.
So each instance computed a different hash, judged the other's cache stale, and ran
`rm -rf` on the dependency directory the other was actively serving from. Every time, in
both directions, until one was killed. Overriding `cacheDir` per repo is what actually
isolates them, and it pays off sequentially too: switching repos no longer re-optimizes
from scratch.

One related setting is easy to miss: `preview-host/nuxt.config.ts` puts `.nuxt-*` and
`.vite-*` in `ignore`. Nuxt already ignores its own `buildDir`, but it cannot know that
sibling build dirs exist — and without them ignored, a second `preview` starting up makes
every running instance clear its module graph and force a full browser reload, because
Vite saw *a* `tsconfig.json` change (`reloadOnTsconfigChange`) that belonged to another
repo entirely.

### Guards on the directory

Three markers keep the shared directory honest. The first two have the same shape — a file
recording that a step *finished*, because "the output looks present" cannot tell a completed
step from an interrupted one:

- `.devkit-copy-complete` — written after the file copy, holding a content fingerprint of the
  shipped host. Without the marker, an interrupted copy that happened to land `package.json`
  and `nuxt.config.ts` would count as a host forever. Without the fingerprint, version-keying
  would cover staleness only *between* releases: anyone changing `preview-host/` while the
  version stands still — this repo's own developers included — silently kept running the copy
  from before their change. A changed host re-copies without reinstalling, since the install is
  keyed separately.
- `.devkit-install-complete` — written after a successful `npm install`, holding a fingerprint
  of the dependency blocks it installed. Changed pins therefore reinstall.
- `.devkit-install.lock` — held *during* `npm install`, created with the `wx` flag so
  exclusivity comes from the filesystem rather than a check-then-write. Two repos previewing
  for the first time after an upgrade both decide they need to install, into the same
  directory. It records a pid, so a lock left by a killed process can be taken over instead of
  wedging the cache forever.

`previews/<pid>.json` is the same idea applied to running processes rather than steps: one
file per live preview, recording repo, pid and both ports. It is what lets `preview` refuse a
second run unless `--parallel` is given, name the preview already holding the directory, and
refuse a `--force` reinstall that would swap `node_modules` out from under it. Dead entries
are pruned on read, because a preview killed with SIGKILL never gets to deregister and a
registry that only grew would refuse every future preview.

## Fidelity caveats

This is a faithful **dev** stand-in, not the production service:

- **No auth.** No Zitadel, no `X-Tenant-Id`; a single fixed dev tenant and principal.
- **No sandbox.** Author-time resolvers run in-process rather than in the forked
  sandbox, so bundle-build states (`409 not built yet`) and the PO-145 grant/egress
  model are not reproduced.
- **Light workflow validation.** Workflow-blob validation is schema-based; the
  production service does deeper cross-validation on save.
- **No run execution.** The Temporal parts — running a workflow, run history, `…/runs/*`
  — are intentionally not mocked.
- **No vendored schemas yet.** `assets/schemas/` currently holds only a `README.md`, so
  `GET /schemas/{domain}` returns 404 until schema snapshots are vendored into it. The
  UI's client-side schema validation is inactive until then. The schemas are PHP classes
  in the service (`app/Support/Schema/Versions/**`), so snapshotting them needs a running
  instance: `npm run refresh-contract -- --service <base-url>`.
- **One devkit-only endpoint.** `POST /nodes/{slug}/{version}/config:validate` does not
  exist in the real API — it backs the preview host's `/nodes` page. It is listed in
  `DEVKIT_ONLY` in `tests/contract.test.ts`; do not write node code that depends on it.

## Staying in step with the real API

`contract/integrations-v1.json` is a vendored snapshot of the service's OpenAPI 3.1
document (`services/integrations/docs/api/openapi.yaml`, generated by Scribe and
regenerated by that repo's CI on every push to `main`). `tests/contract.test.ts` starts
the mock and requests **every** path in it, asserting that the route exists, answers the
status code the contract declares, and returns every property the contract declares.

This is the mechanism that couples the mock to the UI: a new `@revenexx/studio-integrations`
talks to a newer API, Dependabot opens a PR against `preview-host/package.json`, and the
contract test decides on that PR whether the mock still holds up.

Two limits worth knowing:

- The test only detects **contract → mock** gaps. Routes the mock invents are not
  auto-detected (the router is a nested `switch` and cannot be enumerated), which is why
  `DEVKIT_ONLY` is hand-maintained.
- The snapshot only moves when someone runs `npm run refresh-contract`. That is a manual
  step — but a visible one, unlike the invisible drift it replaced.
