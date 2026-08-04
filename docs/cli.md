# CLI Reference

The package installs one binary, `integrations-devkit`. Run it from the root of a node
package — all relative defaults resolve against the current working directory.

## Commands

| Command | What it does |
| --- | --- |
| `integrations-devkit` | Start the mock Integrations API. Serves a static UI when `--ui` is given. |
| `integrations-devkit preview` | Scaffold the Nuxt preview host if needed, install its dependencies, then run it together with the mock. |
| `integrations-devkit init-preview` | Only scaffold the Nuxt preview host, then stop. The scaffold is yours to edit afterwards. |
| `integrations-devkit reset` | Delete the persisted session overlay. |
| `integrations-devkit --version` | Print the devkit version. `-v` also works. |

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--entry <path>` | `src/index.ts`, else `dist/index.js` | Package entry to load. |
| `--seed <dir>` | `dev/seeds` | Committed seed directory. |
| `--state <file>` | `.revenexx-dev/state.json` | Session overlay file. |
| `--no-persist` | off | Keep everything in memory; never write the overlay. |
| `--port <n>` | `$PORT`, else `3555` | Mock API listen port. |
| `--ui <dir>` | resolve the UI package | Serve a prebuilt static UI from this directory. |
| `--no-ui` | off | Run API-only. |
| `--open` | off | Open the preview in a browser. |
| `--env <path>` | `.env` when present | Env file to load before seeds are applied, *instead of* `.env`. Needs Node >= 20.12. |
| `--no-env` | off | Load no env file at all, not even `.env`. |
| `--dir <path>` | `.revenexx-dev/preview` | Preview host directory. Applies to `preview` and `init-preview`. |
| `--force` | off | Overwrite existing scaffold files. Applies to `preview` and `init-preview`. |

## Common invocations

Preview a package whose entry is not the default:

```bash
npx integrations-devkit preview --entry src/nodes/index.ts
```

Run the mock on another port, without touching disk:

```bash
npx integrations-devkit --no-ui --port 4000 --no-persist
```

Re-scaffold a preview host you have modified beyond repair:

```bash
npx integrations-devkit init-preview --force
```

Throw away the interactive session state and start from the committed seeds again:

```bash
npx integrations-devkit reset
```

Load a different env file for the seeds' `${VAR}` references — or none at all:

```bash
npx integrations-devkit preview --env .env.staging
npx integrations-devkit preview --no-env
```

A `.env` in the package root is loaded automatically when present, and `--env` **replaces**
it: exactly one env file is ever read. Repeat the flag and the last one wins. A shell
variable beats the file either way, since `process.loadEnvFile` never overwrites what is
already set.

The value is a **path**, not an environment name — `--env .env.staging`, not `--env
staging`. If you pass a bare name and the matching `.env.<name>` exists, the error says so.

> The flag is `--env`, **not** `--env-file`. Node reserves `--env-file` and
> `--env-file-if-exists` and acts on them wherever they appear — even after the script
> path — so `--env-file missing.env` fails inside Node (exit code 9) before the devkit
> starts. Passing one is not an error, but the devkit will point you at `--env`.

Scaffold the host into a directory outside the package — useful to keep the package's
own git tree untouched:

```bash
npx integrations-devkit preview --dir /tmp/devkit-preview
```
