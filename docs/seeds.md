# Seeds & Persistence

The devkit's state is layered. From the bottom up:

1. **Committed seeds** in `dev/seeds/` — stable fixtures checked into the repo.
2. **`.revenexx-dev/state.json`** — the interactive session overlay.
3. **In-memory** — with `--no-persist`, nothing is written at all.

The seeds are the source of truth; the overlay is disposable.

## Committed seeds

Put a `dev/seeds/index.ts` in your node package and default-export a `DevSeeds` object.
Seeds hold **fixed values only** — a credential for a local container, a workflow to start
from. They are applied as written; the devkit reads no env file.

```ts
// dev/seeds/index.ts
import type { DevSeeds } from '@revenexx/integrations-node-devkit';

const seeds: DevSeeds = {
  credentials: [
    {
      id: 'smtp-dev', // stable id, so workflows can reference it
      credentialTypeSlug: 'revenexx:smtp',
      name: 'Local SMTP',
      config: { host: 'localhost', port: 1025, user: 'dev', password: 'dev' },
    },
  ],
};

export default seeds;
```

`DevSeeds` also accepts `secrets` and `workflows`. Give every seeded entity a **stable
`id`** so that references between them survive a reset.

Point at a different directory with `--seed <dir>`. A package without `dev/seeds/` starts
with no seeds.

## A credential with a secret

A credential that needs a key, a token or a password is **not** seeded. Create it in the
preview's Credentials dialog and press **Connect**, the way a customer does. That tries
the credential's form and its `test()` along the way, which a seed skips. What you create
is kept in the session overlay below, so it survives a restart.

## The session overlay

Anything you create in the preview UI is written to `.revenexx-dev/state.json`. It is:

- **Gitignored** — add `.revenexx-dev/` to your `.gitignore`.
- **Versioned** — it carries a `STORE_SCHEMA_VERSION`. On a mismatch it is *discarded,
  not migrated*, because the seeds can rebuild the useful state.
- **Disposable** — `integrations-devkit reset` deletes it.

Relocate it with `--state <file>`.

## In-memory only

```bash
npx integrations-devkit --no-persist
```

Seeds still load; nothing is written; everything resets on restart. This is the right
mode for CI and for scripted experiments.

## Which layer wins

Seeds load first, then the overlay is applied on top. So an entity you edited in the UI
keeps your edit until you `reset`, at which point the committed seed value returns.
