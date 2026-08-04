---
'@revenexx/integrations-node-devkit': patch
---

Fix a repeated `--env` being silently ignored, and explain a bare environment name.

`resolveEnvFile` located the flag with `argv.indexOf('--env')`, so only the *first*
occurrence was ever read while `parseArgs` skipped the rest without complaint:
`--env one.env --env two.env` loaded `one.env`. It now resolves to the last one, matching
every other option in the CLI, whose parse loop simply overwrites. Every occurrence is
still validated, so `--env --env ok.env` reports the malformed first one rather than
quietly accepting the second.

`--env` takes a path, not Laravel's bare environment name — it mirrors Node's `--env-file`,
and a path can point outside the package (`--env /run/secrets/env`). Passing a name used to
fail with a flat "does not exist"; when the matching `.env.<name>` is sitting right there,
the error now names it:

    --env: /pkg/staging does not exist. Did you mean --env .env.staging?
    The flag takes a path, not an environment name.

`--env` continues to *replace* the default `.env` rather than layering on top of it, and a
shell variable still beats the file.
