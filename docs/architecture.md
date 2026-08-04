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

What is shared and what is not is a deliberate split: the ~500 MB dependency tree is shared
(that is the whole point), the compiled app is not. `preview` points each consumer repo at
its own `.nuxt-<hash-of-cwd>/` inside the host directory via `DEVKIT_NUXT_BUILD_DIR`, so
previewing two node packages simultaneously does not have them building over one another.

Two structural guards keep the directory honest, both of the same shape — a marker file
recording that a step *finished*, because "the output looks present" cannot tell a completed
step from an interrupted one:

- `.devkit-copy-complete` — written after the file copy. Without it, an interrupted copy that
  happened to land `package.json` and `nuxt.config.ts` would count as a host forever.
- `.devkit-install-complete` — written after a successful `npm install`, holding a fingerprint
  of the dependency blocks it installed. Changed pins therefore reinstall.

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
