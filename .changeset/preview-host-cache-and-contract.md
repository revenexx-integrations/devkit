---
"@revenexx/integrations-node-devkit": minor
---

Move the preview host out of consuming repos, and verify the mock against the real API contract.

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
