---
'@revenexx/integrations-node-devkit': minor
---

Make two previews at once actually work, and say so when they cannot

Running `preview` in a second repo failed with a raw `EADDRINUSE` stack trace — after the
multi-minute `npm install`, and possibly orphaning the Nuxt child. The port was only the
symptom: parallel previews were broken by construction, and that error was the sole thing
preventing them.

Two repos previewing out of the shared host destroyed each other. Vite anchors its
dependency cache on `rootDir` — the shared directory — while invalidating it on a hash that
covers the per-repo build dir, so each instance judged the other's cache stale and `rm -rf`'d
the directory the other was serving from. Meanwhile the shared `.env`, rewritten every run
because it carries the mock's port, made Nuxt respawn every *other* running preview. The two
fed each other indefinitely. The per-repo build dir, documented as what made this safe, was
the thing that caused it.

- Each repo now gets its own Vite cache (`.vite-<hash>/`) and dotenv file (`.env.<hash>`)
  beside its build dir, and sibling build dirs are ignored so a starting preview no longer
  forces a full reload in the running ones.
- `preview` refuses a second run by default, naming the repo, pid and ports of the one it
  found — most often a preview forgotten from an earlier session. `--parallel` runs both.
- The mock's **default** port moves to the next free one and says so; an **explicit**
  `--port` or `$PORT` is honoured or reported as a conflict, never silently relocated.
  `--port abc`, and `--port` with no value, are now errors instead of `NaN` and a silent
  fallback.
- `PORT` no longer leaks into the Nuxt child, where listhen also reads it: `PORT=4000
  preview` used to have the mock and the UI both claim 4000. The UI's URL is now printed by
  Nuxt, which is the only party that knows the port it got.
- `npm install` in the shared host is serialized with a lock, and `--force` is refused while
  a preview is running rather than reinstalling under it.
- The mock binds before the copy and install, so a port clash or an unloadable entry costs
  seconds instead of minutes.
- A change to the shipped `preview-host/` now re-copies within the same devkit version,
  which version-keying alone never covered.
