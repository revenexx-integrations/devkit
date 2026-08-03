# Branch & Release-Tag Protection

This repo ships its GitHub **rulesets as code** in [`.github/rulesets/`](../.github/rulesets/)
so the intended protections are reviewable and reproducible. GitHub does **not**
apply these files automatically — they are import sources for the UI. The set
mirrors [`integrations-node-sdk`](https://github.com/revenexx-integrations/sdk)
one-to-one; only the release-tag pattern differs (this package's name).

## Why

`main` has no direct-push guard, and publishing creates a release tag
(`@revenexx/integrations-node-devkit@*`). Without protection, anyone with push
access can push to `main` or create a release tag and thereby fire an
`npm publish`. The rulesets close both gaps.

## Files

| File | Target | What it enforces |
| --- | --- | --- |
| [`main.json`](../.github/rulesets/main.json) | default branch (`main`) | PR required (1 approval, dismiss stale, resolve conversations, squash/rebase only), required status checks `test` + `changeset` + up-to-date, linear history, no force-push, no deletion — **org admins may bypass via PR**, see below |
| [`release-tags.json`](../.github/rulesets/release-tags.json) | tags `@revenexx/integrations-node-devkit@*` | only **bypass actors** may create/update/delete release tags → protects the publish trigger (Repository admin **and** the release GitHub App are bypass actors) |
| [`branch-names.json`](../.github/rulesets/branch-names.json) | all branches **except** the allowed prefixes | restricts branch **creation**: only `feature/`, `hotfix/`, `bugfix/`, `chore/`, `release/`, `changeset-release/` (single segment each) and `dependabot/` (any depth) branches may be created (no bypass) |
| [`release-branches.json`](../.github/rulesets/release-branches.json) | branches `release/*` and `chore/*` | restricts `release/` and `chore/` branch **creation** to **repository admins** (the stand-in for "org members" — see note) |

The required status checks `test` and `changeset` are job names in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). `changeset` fails any
PR that changes a package without adding a changeset file (it self-skips on the
`changeset-release/main` PR, whose changesets are already consumed). Use
`npx changeset --empty` for PRs that intentionally need no release.

### The org-admin bypass on `main`

GitHub does not let you approve your own pull request, so a `main` ruleset with
**no** bypass actors makes a single available maintainer unable to land anything —
the failure mode when everyone else is on holiday. `main.json` therefore lists one
bypass actor:

```json
{ "actor_id": 1, "actor_type": "OrganizationAdmin", "bypass_mode": "pull_request" }
```

Two deliberate choices:

- **`OrganizationAdmin`, not `RepositoryRole` id 5.** Every collaborator in this org
  currently holds the repo **admin** role (see the caveat below), so a
  `RepositoryRole: 5` bypass would effectively exempt everyone. Org owners are the
  narrower set.
- **`bypass_mode: "pull_request"`, not `"always"`.** The bypass applies only to
  changes that go through a pull request; **direct pushes to `main` stay blocked**
  for everyone, so the accident guard survives.

> ⚠️ A ruleset bypass is **per actor, not per rule** — GitHub cannot exempt only
> the approval requirement. An org owner merging with the bypass also skips the
> `test` + `changeset` checks and the conversation-resolution rule. Treat it as a
> break-glass: normally wait for a review, and when you do use it, check CI is
> green by eye first. To remove it, set `bypass_actors` back to `[]` and re-apply.

Note this diverges from `integrations-node-sdk`, which keeps `bypass_actors: []` on
`main`. GitHub reports the applied actor as `"actor_id": null` for
`OrganizationAdmin` — an inert normalisation, not a drift from this file.

### Branch naming convention

`branch-names.json` enforces the allowed prefixes. Human branches are **single
level** — `feature/<desc>`, `hotfix/<desc>`, `bugfix/<desc>`, `chore/<desc>`,
`release/<desc>` — so `feature/a/b` is rejected. `dependabot/` is allowed at **any
depth** because Dependabot creates multi-segment branches
(`dependabot/npm_and_yarn/...`). `changeset-release/*` is excluded so the
`changesets/action` bot can create its `changeset-release/main` branch for the
“Version Packages” PR. `release-branches.json` then narrows `release/` and
`chore/` creation to repository admins; `feature/`, `hotfix/` and `bugfix/` are
open to any collaborator.

> **"Org members" caveat:** GitHub ruleset bypass actors are *repository roles or
> teams*, not raw org membership. The org currently has no teams and every
> collaborator is an admin, so `release/` + `chore/` creation is gated to the
> **Repository admin** role as the practical equivalent. When non-admin members
> should also create these, make a GitHub team and swap it into
> `release-branches.json`'s `bypass_actors`.

> **fnmatch gotcha:** in ref patterns `*` matches a single path segment and a
> *trailing* `**` also collapses to one segment — so `refs/heads/feature/*` allows
> exactly one level. To match any depth (as Dependabot needs), the pattern must
> end in `**/*`, e.g. `refs/heads/dependabot/**/*`. Patterns must be full refs
> (`refs/heads/…`); the bare `feature/*` form is rejected by the API.

## How to apply

1. **Settings → Rules → Rulesets → New ruleset → Import a ruleset**
2. Upload `.github/rulesets/main.json`, save.
3. Repeat for `release-tags.json`, `branch-names.json` and `release-branches.json`.
   When updating existing rulesets after a change here, edit the live ruleset to
   match — import only creates new ones.
4. On the **release-tags** ruleset, confirm the **Bypass list** contains
   **Repository admin** *and* the **release GitHub App** (the App actually pushes
   the tag — without it in the bypass list, publishing is blocked). Add the App by
   name in the UI so GitHub resolves its ID; the committed JSON carries it as a
   placeholder `Integration` entry with `actor_id: 0`. `release-tags.json` also
   ships `RepositoryRole` id `5` (= Repository admin); if the import rejects either
   entry, set the bypass actors in the UI instead.

## Status

The repo is **public**, so rulesets are **active and enforced** (ruleset
enforcement needs GitHub Team/Enterprise *or* a public repo). Keep these files in
sync with the live rulesets — they remain the source of truth and the import
sources for the UI.

## Release GitHub App

[`publish.yml`](../.github/workflows/publish.yml) mints a token from a dedicated
**GitHub App** via `actions/create-github-app-token` and runs `changesets/action`
with it, not the default `GITHUB_TOKEN`. Three reasons:

1. **Checks must run on the “Version Packages” PR.** PRs created by the default
   `GITHUB_TOKEN` do not trigger further workflows, so `test`/`changeset` would
   never run there and the PR could never satisfy the required checks.
2. **Tag creation must pass the release-tag ruleset.** `GITHUB_TOKEN` cannot be a
   bypass actor; the App is an `Integration` bypass actor in `release-tags.json`.
3. **No self-approval clash.** The App is a distinct identity (`app[bot]`), so a
   human maintainer can approve the bot's PR.

**Required repo secrets** — these are the exact names the workflow reads:

| Secret | Used by |
| --- | --- |
| `APP_CLIENT_ID` | `create-github-app-token`'s `client-id` input |
| `APP_PRIVATE_KEY` | the App's generated private key |

> ⚠️ The workflow authenticates by **client id**, not App id — a secret named
> `APP_ID` is **not read** by `publish.yml`. The header comment inside
> `publish.yml` still says “secrets.APP_ID / APP_PRIVATE_KEY”; that comment is
> stale (inherited from the SDK), the code below it is authoritative. Watch the
> spelling: `APP_CLIENT_ID`, not `APP_CLIEND_ID` — a typo'd secret resolves to an
> empty string and the release job fails at the first step.

**Setup:** create an org-owned GitHub App with **Repository permissions →
Contents: Read and write** + **Pull requests: Read and write**; no webhook, no
callback URL. Generate a private key, install the App on this repo, store the two
secrets above. The App is already wired into the **release-tags** bypass list:
`release-tags.json` carries `actor_id: 4132857` (`revenexx-integrations-release`,
the same App the SDK uses), so no manual UI step is needed — but the App must be
**installed on this repository** (it is installed org-wide with
`repository_selection: selected`, so check Settings → GitHub Apps).

**npm publishing** uses OIDC **trusted publishing** (`id-token: write` + npm
≥ 11.5.1), so no `NPM_TOKEN` is needed — but the binding on npmjs.com is keyed to
this repo **plus the workflow filename**. That is why the file stays
`publish.yml`, and why the trusted publisher must be configured on the
`@revenexx/integrations-node-devkit` package settings before the first automated
release.

## Dependabot

[`dependabot.yml`](../.github/dependabot.yml) is taken from the SDK: weekly npm
and github-actions updates, devDependencies grouped, production minor/patch
grouped, majors separate. No `registries:` section is needed — devkit's own
dependencies are all public npm (`tsx`, plus the peers
`@revenexx/integrations-node-sdk` and `vitest`).

> **Blind spot:** the private `@revenexx/studio-*` pins live in
> `src/preview/templates.ts` (the generated Nuxt-host package.json), not in this
> repo's `package.json`. Dependabot cannot see or bump them — the studio peer set
> stays a manual bump.

## Repository security features

Enabled at the repo level (free for public repos), complementing the rulesets:

- **Secret scanning** + **push protection** — blocks committing/pushing leaked secrets.
- **Dependabot alerts** + **security updates** — vulnerability alerts and automated
  fix PRs (version updates are configured separately in [`dependabot.yml`](../.github/dependabot.yml)).
