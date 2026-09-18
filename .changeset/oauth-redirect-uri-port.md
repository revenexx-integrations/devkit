---
"@revenexx/integrations-node-devkit": patch
---

The OAuth redirect URI carries the port the dev server actually listens on

`handle()` parsed every request against the fixed base `http://localhost`, and
`req.url` is only ever the path, so `url.origin` was `http://localhost` — port 80
— no matter where the server was bound. The authorize route did not even go
through it: it passed a hard-coded `http://localhost/api/v1/credentials/oauth/callback`.

The two agreed with each other, which is why nothing 400s at the provider, and
also why the failure is confusing: consent succeeds, and then the browser is sent
to port 80, where the devkit is not listening. On the default port the callback
that completes the flow was unreachable, so a 3-legged credential could never
reach `active` in the preview.

Both now derive from the `Host` header of the incoming request, so with
`--port 3555` the redirect URI is
`http://localhost:3555/api/v1/credentials/oauth/callback` — the value to register
with the provider, now written down in `docs/architecture.md`. Authorize and
exchange still read from one place, so they cannot drift apart; a missing or
malformed `Host` falls back to the old base rather than throwing.

Nothing else reads `url.origin`, so no other route changes. Packages that worked
around this by overriding `buildAuthorizeUrl`/`exchangeCode` to substitute their
own redirect URI can drop the override — the value they receive is now the
reachable one.
