# CLI Reference

The package installs one binary, `integrations-devkit`. Run it from the root of a node
package — all relative defaults resolve against the current working directory.

## Commands

| Command | What it does |
| --- | --- |
| `integrations-devkit` | Start the mock Integrations API. Serves a static UI when `--ui` is given. |
| `integrations-devkit preview` | Materialize the Nuxt preview host into the shared cache if needed, install its dependencies, then run it together with the mock. |
| `integrations-devkit init-preview --dir <path>` | Take an **unmanaged** copy of the preview host to modify. Requires `--dir`; without it the command errors, because the managed copy is `preview`'s business. |
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
| `--dir <path>` | the managed cache | Use this preview-host directory instead of the version-keyed cache. The copy becomes unmanaged — devkit upgrades will not touch it. Applies to `preview` and `init-preview`. |
| `--force` | off | Re-copy the host even when the target looks complete, and reinstall its dependencies. Applies to `preview` and `init-preview`. |

## Where the preview host lives

`preview` does not put anything in your repo except `.revenexx-dev/state.json`. The host
is copied into:

```
${XDG_CACHE_HOME:-~/.cache}/revenexx/devkit-preview/<devkit-version>/
```

Keying on the devkit version means all your node packages share one dependency install,
and an upgrade can never leave you on a stale host — a new version is simply a new
directory. Old directories are not pruned automatically; delete them when you want the
disk back.

The dependency install is shared, the **build is not**: each repo compiles into its own
`.nuxt-<hash>/` inside that directory, so two packages can be previewed at the same time
without building over each other.

For an unmanaged copy (`--dir`), the generated `.env` is written once and then left alone —
it is yours to edit. `preview` passes the same values to Nuxt on every run regardless, so
editing it only affects a manual `npm run dev` in that directory.

## Common invocations

Preview a package whose entry is not the default:

```bash
npx integrations-devkit preview --entry src/nodes/index.ts
```

Run the mock on another port, without touching disk:

```bash
npx integrations-devkit --no-ui --port 4000 --no-persist
```

Take a copy of the host to modify, and run it:

```bash
npx integrations-devkit init-preview --dir ./my-preview
npx integrations-devkit preview --dir ./my-preview
```

Force a clean re-copy and reinstall of the managed host (e.g. after an interrupted
install):

```bash
npx integrations-devkit preview --force
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

## Keeping the mock in step with the real API

The mock is verified against a vendored snapshot of the integrations service's OpenAPI
contract. Refresh the snapshot after the service changes:

```bash
# spec only (works offline from a sibling checkout of services/integrations)
npm run refresh-contract

# spec + the JSON schemas, which need a running service
npm run refresh-contract -- --service https://integrations.rvnxx.test/api/v1
```

Then run `npm test`: `tests/contract.test.ts` requests every path in the snapshot and
fails on any the mock does not serve, answers with the wrong status code, or returns
without a property the contract declares.
