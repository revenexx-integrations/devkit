# Vendored JSON schemas

The mock API serves these at `GET /api/v1/schemas/{domain}[/{version}]` so the
Cockpit UI can run its client-side validation / form generation offline.

Naming: `<domain>-<version>.json` (split on the first dash). For example
`node-v0-draft.json` is served at both `/schemas/node/v0-draft` and
`/schemas/node` (latest).

These are snapshots of the integrations service output. To refresh, with the
Laravel service running:

```bash
curl -s https://integrations.rvnxx.test/api/v1/schemas/node/v0-draft \
  > node-v0-draft.json
curl -s https://integrations.rvnxx.test/api/v1/schemas/workflow/v0-draft \
  > workflow-v0-draft.json
```

If a schema file is absent the corresponding endpoint returns 404 with a hint;
the preview still works for everything that doesn't need client-side schema
validation.
