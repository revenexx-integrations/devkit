# @revenexx/integrations-node-devkit

Local development kit for Revenexx integration node packages. It gives node
developers two things without the full Docker stack:

1. **A mock Integrations API** the (WIP) Cockpit preview UI runs against, so you
   can see the credentials / nodes / templates you're building rendered by the
   real production UI components — including live **config-field resolving**.
2. **A unit-testing harness** for node `execute`, author-time resolvers, and
   credential `test` / `resolve` / OAuth.

It is a **dev/CI-only** dependency and is **never** part of a built node bundle.

The mock invokes your package's real `loadOptions` / `resolveConfigSchema` /
`resolveOutputs` / `test` / `resolve` **in-process** — no bundle, no sandbox, no
PO-145 grant model (all intentionally omitted; this is dev-only). What you see
is your actual source, reloaded on save.

## Install

```bash
npm install -D @revenexx/integrations-node-devkit
```

Add a script to your node package:

```jsonc
// package.json
{
  "scripts": {
    "dev": "integrations-devkit"
  }
}
```

## Preview

```bash
npm run dev
```

Starts the mock API (default `http://localhost:3555/api/v1`) loaded from your
`src/index.ts`. Edit your nodes/credentials and the package hot-reloads.

### Preview with the Cockpit UI

The Cockpit UI ships as the **Nuxt module** `@revenexx/studio-integrations`
(Vue components + composables), *not* a static bundle — so it runs inside a Nuxt
host app. The devkit scaffolds and runs that host for you:

```jsonc
// package.json — `dev` (tsup --watch) is left untouched
{ "scripts": { "preview": "integrations-devkit preview" } }
```

```bash
npm run preview
```

This (1) scaffolds a minimal Nuxt host into `.revenexx-dev/preview/` (gitignored)
on first run, (2) `npm install`s it (heavy first time — pulls Nuxt + the studio
packages), (3) starts the mock API, and (4) runs `nuxt dev` wired to the mock.
Open **http://localhost:3000/integrations**.

No auth shim is needed: `@revenexx/studio-shared`'s standalone
`usePlatformAuth`/`usePlatformTenant` read a dev token/tenant from
`NUXT_PUBLIC_DEV_TOKEN` / `NUXT_PUBLIC_DEV_TENANT` (the devkit sets them; the
mock ignores the values). `runtimeConfig.public.integrationsApi` is pointed at
the mock automatically.

- `integrations-devkit init-preview` — only scaffold the host (then edit it; it's yours).
- `integrations-devkit preview --dir <path> --force` — custom dir / re-scaffold.

> **Scope:** the preview targets the **slimmed** studio build — node listing +
> credential/template management + **config-field resolving**. `studio-integrations`
> 0.1.4 still ships the workflow editor and renders `field.options` statically;
> config-field resolving needs the UI to `POST /nodes/{slug}/{version}/config:resolve`
> (the mock already serves it). The Temporal parts (run history, `…/runs/*`) are
> intentionally not mocked.

Pass `--ui <dir>` to `integrations-devkit` if you instead have a prebuilt static SPA.

### CLI options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--entry <path>` | `src/index.ts` (else `dist/index.js`) | Package entry to load |
| `--seed <dir>` | `dev/seeds` | Committed seed directory |
| `--state <file>` | `.revenexx-dev/state.json` | Session overlay file |
| `--no-persist` | off | In-memory only; don't write the overlay |
| `--port <n>` | `$PORT` or `3555` | Listen port |
| `--ui <dir>` | resolve UI package | Static UI build to serve |
| `--no-ui` | off | Run API-only |
| `--open` | off | Open the preview in a browser |
| `reset` (subcommand) | | Delete the session overlay |

## Seeds + persistence (layered)

Three layers, base to top:

1. **Committed seeds** in `dev/seeds/` — stable instances checked into the repo.
   Reference sensitive values via `${ENV_VAR}` (resolved from `.env`; only the
   reference is committed, never the value):

   ```ts
   // dev/seeds/index.ts
   import type { DevSeeds } from '@revenexx/integrations-node-devkit';

   const seeds: DevSeeds = {
     secrets: [{ key: 'api-key', value: '${MY_API_KEY}' }],
     credentials: [
       {
         id: 'smtp-dev', // stable id so workflows can reference it
         credentialTypeSlug: 'revenexx:smtp',
         name: 'Local SMTP',
         config: { host: 'localhost', port: 1025, password: '${SMTP_PW}' },
       },
     ],
   };
   export default seeds;
   ```

2. **`.revenexx-dev/state.json`** — interactive session state (what you create
   in the preview UI). Gitignored, versioned, and disposable: on a schema-
   version mismatch it is discarded rather than migrated, because the seeds are
   the source of truth. `integrations-devkit reset` clears it.

3. **In-memory** (`--no-persist`) — nothing is written; reset on restart.

Add to your `.gitignore`:

```
.revenexx-dev/
```

## Testing harness

```ts
import { describe, it, expect } from 'vitest';
import {
  createMockContext,
  createAuthorContext,
  runCredentialResolve,
  stubFetch,
  fakeTokenEndpoint,
} from '@revenexx/integrations-node-devkit/testing';

// execute
const ctx = createMockContext({ credentials: { 'smtp-1': { host: 'mail' } } });
const res = await node.execute(ctx, { credentials: 'smtp-1' });

// author-time resolver
const authorCtx = createAuthorContext({ category: 'fruits' });
const options = await node.loadOptions(authorCtx, 'item');

// credential resolve + OAuth rotation, no network / broker
const stub = stubFetch(fakeTokenEndpoint({ accessToken: 'AT', refreshToken: 'RT' }));
const { result, persistDurableCreds } = await runCredentialResolve(cred, {
  config: { clientId: 'x' },
  durableCreds: { refreshToken: 'old' },
});
expect(persistDurableCreds).toHaveBeenCalledWith({ refreshToken: 'RT' });
stub.restore();
```

`vitest` is an optional peer dependency (the harness uses `vi` spies).

## Fidelity caveats

This is a faithful **dev** stand-in, not the production service:

- No auth / Zitadel / `X-Tenant-Id`; a single fixed dev tenant + principal.
- Author-time resolvers run in-process (not the forked sandbox), so bundle-build
  states (`409 not built yet`) and the PO-145 grant/egress model are not
  reproduced.
- Workflow-blob validation is light and schema-based; the production service
  does deeper cross-validation on save.
- Workflow **run execution** is not included (v1).
