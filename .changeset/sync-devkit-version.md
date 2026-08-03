---
'@revenexx/integrations-node-devkit': patch
---

Keep `DEVKIT_VERSION` in step with the package version on release.

The version is a hardcoded constant in `src/index.ts` — a public export, and what
`integrations-devkit --version` prints — but `changeset version` only rewrites
package.json, and the release workflow used the action's default versioning step. Any
release past 0.1.0 would therefore have kept reporting `0.1.0`.

Adds `scripts/sync-version.mjs` and a `version` npm script that runs it after
`changeset version`, and points the workflow at that script. The sync exits non-zero if
the declaration cannot be found, so a rename fails the release instead of silently
shipping a stale version.
