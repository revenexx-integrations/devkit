# Seeds & Persistence

The devkit's state is layered. From the bottom up:

1. **Committed seeds** in `dev/seeds/` — stable fixtures checked into the repo.
2. **`.revenexx-dev/state.json`** — the interactive session overlay.
3. **In-memory** — with `--no-persist`, nothing is written at all.

The seeds are the source of truth; the overlay is disposable.

## Committed seeds

Put a `dev/seeds/index.ts` in your node package and default-export a `DevSeeds` object.
Reference sensitive values with `${ENV_VAR}` — they are resolved from the environment at
load time, so only the reference is committed, never the value:

```ts
// dev/seeds/index.ts
import type { DevSeeds } from '@revenexx/integrations-node-devkit';

const seeds: DevSeeds = {
  secrets: [{ key: 'api-key', value: '${MY_API_KEY}' }],
  credentials: [
    {
      id: 'smtp-dev', // stable id, so workflows can reference it
      credentialTypeSlug: 'revenexx:smtp',
      name: 'Local SMTP',
      config: { host: 'localhost', port: 1025, password: '${SMTP_PW}' },
    },
  ],
};

export default seeds;
```

`DevSeeds` also accepts `workflows`. Give every seeded entity a **stable `id`** so that
references between them survive a reset.

Point at a different directory with `--seed <dir>`.

## Where `${ENV_VAR}` values come from

A `.env` in the package root is loaded automatically before the seeds are applied
(Node >= 20.12). Values already present in the environment are **not** overwritten, so
the shell always wins over the file:

```bash
# .env supplies the rest, this one call overrides MY_API_KEY
MY_API_KEY=other npm run preview
```

Use `--env <path>` for a different file, or `--no-env` to load none. A missing `.env` is
fine; a missing file you named explicitly is an error, so a typo does not turn into a
confusing seed failure later. (It is `--env`, not `--env-file` — that one belongs to Node
itself; see the [CLI Reference](cli.md).)

> **A referenced variable that is not set anywhere is an error** — `interpolateEnv`
> throws rather than seeding an empty value, since a silently blank credential is worse
> than a clear failure. So `${VAR}` suits secrets your whole team has a value for. For a
> credential only some developers can fill — a personal API key, say — attach it
> conditionally instead, because seeds are ordinary TypeScript:
>
> ```ts
> const apiKey = process.env.MY_API_KEY;
>
> const seeds: DevSeeds = {
>   credentials: [
>     ...(apiKey ? [{ id: 'api-dev', credentialTypeSlug: 'x:api', name: 'API', config: { apiKey } }] : []),
>   ],
> };
> ```

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
