# Getting Started

Get a node package rendering in the Cockpit preview.

## Prerequisites

- **Node.js >= 20.3.0**.
- An integration node package that exports nodes and/or credentials from `src/index.ts`.
- Plain public npm access. The preview host pulls `@revenexx/studio-integrations` and
  `@revenexx/studio-shared`, which are published publicly — no private registry or token
  is needed.

## Install

```bash
npm install -D @revenexx/integrations-node-devkit
```

Add a `preview` script to your node package. Leave any existing `dev` script (typically
`tsup --watch`) untouched:

```json
{
  "scripts": {
    "preview": "integrations-devkit preview"
  }
}
```

Add the devkit's working directory to `.gitignore`:

```
.revenexx-dev/
```

## Run the preview

```bash
npm run preview
```

On the first run this does four things:

1. Copies the Nuxt preview host into a shared cache directory,
   `${XDG_CACHE_HOME:-~/.cache}/revenexx/devkit-preview/<devkit-version>/`.
2. Runs `npm install` there — heavy the first time, as it pulls Nuxt and the studio
   packages. Subsequent node packages on the same machine reuse it, so this cost is paid
   once per devkit version, not once per repo.
3. Starts the mock Integrations API.
4. Runs `nuxt dev` wired to that mock.

Nothing but `.revenexx-dev/state.json` is written into your repo. The host in the cache is
a managed, disposable copy — see
[the architecture notes](architecture.md#where-the-host-runs-and-why-not-in-your-repo) if
you want to modify it.

## Verify it works

Two endpoints should respond:

- Open **<http://localhost:3000/integrations>** — the Cockpit UI, listing the nodes and
  credentials from your package.
- Check the mock directly:

  ```bash
  curl http://localhost:3555/api/v1/health
  # {"status":"ok"}

  curl http://localhost:3555/api/v1/nodes
  ```

  The node count must match what your `src/index.ts` exports.

Editing a node or credential in your package hot-reloads it; the console prints
`↻ Reloaded package (…)`.

## Run without the UI

To iterate against the mock API alone — useful when scripting or debugging:

```bash
npx integrations-devkit --no-ui
```

This starts only the mock on `http://localhost:3555/api/v1`, with no Nuxt host and no
install step.

## Run the tests

The testing harness is a separate entry point and needs no running server:

```bash
npx vitest
```

See [Testing Harness](testing.md) for what it provides. `vitest` is an optional peer
dependency — install it if your package does not already have it.

## Next steps

- Commit fixtures your team shares: [Seeds & Persistence](seeds.md).
- Look up the remaining commands and flags: [CLI Reference](cli.md).
