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
`src/preview/scaffold.ts` and `src/preview/templates.ts` generate that app into
`.revenexx-dev/preview/`.

The scaffold registers `@revenexx/studio-shared`, `@solar-icons/nuxt` and
`@revenexx/studio-integrations` as Nuxt **modules**, and points
`runtimeConfig.public.integrationsApi` at the mock. No auth shim is required: the
standalone `usePlatformAuth` / `usePlatformTenant` from `@revenexx/studio-shared` read a
dev token and tenant from `NUXT_PUBLIC_DEV_TOKEN` / `NUXT_PUBLIC_DEV_TENANT`, which the
devkit sets and the mock ignores.

The scaffold is generated once and then belongs to you — edit it freely, or
re-generate it with `--force`.

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
  UI's client-side schema validation is inactive until then.
