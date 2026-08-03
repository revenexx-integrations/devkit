---
name: backstage-docs
description: >
  Register a repository in the revenexx Developer Portal (Backstage) and write its
  documentation. Use when adding a new repo to Backstage, when a repo is missing from the
  catalog or has no Docs tab, when creating or fixing a catalog-info.yaml, when setting up
  TechDocs (mkdocs.yml + docs/), or when writing/structuring a repo's technical docs
  (index, getting-started, architecture, API, runbooks). Covers auto-discovery mechanics,
  generating the required files, verifying owner/system against the live catalog via the
  Backstage MCP, and auditing existing repos for why they do not appear.
version: 0.1.3
visibility: private
license: MIT
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
metadata:
  title: Backstage Docs
  category: development
  tags:
    - backstage
    - documentation
    - techdocs
    - catalog
    - developer-portal
    - onboarding
  keywords:
    - backstage
    - catalog-info
    - techdocs
    - mkdocs
    - software-catalog
    - auto-discovery
    - developer-portal
    - runbook
    - documentation
  authors:
    - Elmar Hepp
  homepage: https://github.com/revenexx/skills-catalog
  targets:
    - claude-code
---

# Backstage Docs

Get a repository into the revenexx Developer Portal (Backstage) and give it real
documentation. Two independent jobs are involved and both matter:

1. **Discovery** — a `catalog-info.yaml` makes the repo appear as a catalog entity.
2. **TechDocs** — `mkdocs.yml` + `docs/` give it a rendered **Docs** tab.

An entity can exist with no docs, and a `docs/` folder renders nothing without the catalog
entry pointing at it. Set up both.

## First: is the Backstage MCP available?

This skill verifies owners and systems against the **live** catalog rather than trusting a
hardcoded list — the org's group references are genuinely inconsistent (see the warning
below), so guessing produces broken entities.

Check for the Backstage MCP tools (`catalog_search`, `catalog_get_entity`,
`docs_search`). If present, use them for every owner/system verification. If not, tell the
user the entity's `owner`/`system` cannot be verified and must be confirmed by hand against
the backstage repo's `org.yaml`, then proceed but flag the risk.

## Workflow

### Step 1 — Determine what the repo is

Establish before writing anything:

- **Component type**: `service` (backend/API), `website` (frontend), or `library` (SDK/pkg).
- **GitHub org + repo**: must be `revenexx`, `revenexx-sdks`, or `revenexx-integrations`
  — only these orgs are scanned. A repo elsewhere will never be discovered.
- **Owner** (a Group) and **System** — resolve these next, do not assume them.

### Step 2 — Resolve owner and system against the live catalog

**Do not hardcode owner/system.** Verify each against the catalog:

- `catalog_search` with `group` → list real Groups; pick the correct owning team.
- `catalog_get_entity` `Group:default/<name>` → confirm it exists (a "not found" error
  means the reference is broken).
- `catalog_get_entity` `System:default/<name>` → confirm the system exists.

Write owner as `group:default/<name>` (namespaced) and system as the bare system name.

Also **check `metadata.name` for a collision now**, not at the end: `catalog_search` the
intended name. Names are unique across the whole catalog, and a duplicate silently
overwrites another entity. A repo forked or moved between orgs (e.g. an old `revenexx-sdks`
copy and a new `revenexx` one) commonly produces two `catalog-info.yaml` files claiming the
same name — resolve which one wins before shipping.

> **Why this matters — real breakage in the live catalog.** The same two teams appear under
> at least five different owner strings today: `group:default/platform-team`,
> `group:default/platform`, `group:platform`, `group:team-platform`, plus
> `group:default/developer` vs `group:default/developer-experience`. Several
> (`group:team-platform`, `group:platform`) do **not** resolve to a real Group — they are
> broken references sitting in production. Verify; never copy an owner string from another
> repo on faith.

### Step 3 — Generate the files

Use the bundled script to scaffold catalog + TechDocs at the repo root:

```bash
python3 scripts/init_docs.py \
  --repo-root <path/to/repo> \
  --name <kebab-name> \
  --description "<one line>" \
  --type service|website|library \
  --owner group:default/<team> \
  --system <system> \
  --slug <org>/<repo> \
  --lifecycle experimental|production|deprecated
```

It writes `catalog-info.yaml`, `mkdocs.yml`, and a `docs/` page set matched to `--type`
(it refuses to overwrite without `--force`). The generated `catalog-info.yaml` already
carries `github.com/project-slug` and
`backstage.io/techdocs-ref: url:https://github.com/<slug>/tree/main/` (the live revenexx
convention — see references/catalog-info.md).

If the repo already has a `docs/` folder, inspect it first: TechDocs needs `docs/index.md`
as the entry point and `docs_dir: docs` in `mkdocs.yml`. Existing pages that are generated
command dumps or lack an `index.md` do not form a valid docs root on their own — add
`index.md` and a real `nav`, do not just point TechDocs at the folder.

For anything the script does not cover (extra `API` entities, `subcomponentOf`, links,
tags), edit by hand using **references/catalog-info.md** as the field reference.

### Step 4 — Write the documentation

The scaffolded `docs/` pages are stubs. Fill them with real content — an honest short doc
beats a long templated one full of `TODO`s. Structure, per-page audience, and what belongs
on each page are in **references/doc-structure.md**. The backstage repo's own `docs/` is a
working model for docs *content* (`docs/index.md`, `docs/runbooks/mcp-server.md`); read it
for content only, not for the `techdocs-ref` form (see references/catalog-info.md).

Match the repo's existing documentation language; the revenexx default for code-facing docs
is English.

### Step 5 — Verify and ship

- Every `nav` entry in `mkdocs.yml` points at a file that exists (a missing file breaks the
  Docs build). See **references/techdocs.md**.
- `catalog-info.yaml` is valid YAML at the repo root.
- The file must be on **`main`** — a feature branch is not discovered. The entity appears
  after the next catalog poll (~5 min); there is no manual refresh.

## Auditing an existing repo that is missing or broken

When a repo does not show up, or shows up without docs, diagnose in this order:

1. **Right org?** Not in `revenexx` / `revenexx-sdks` / `revenexx-integrations` → never
   scanned.
2. **`catalog-info.yaml` at root on `main`?** Missing/on a branch/in a subfolder → not
   discovered.
3. **Owner/system resolve?** Verify via MCP (`catalog_get_entity`). Broken refs register
   the entity but leave it unlinked with an "unknown owner" error.
4. **Name collision?** `metadata.name` must be unique across the whole catalog; a duplicate
   silently overwrites.
5. **No Docs tab?** Missing `backstage.io/techdocs-ref`, missing `mkdocs.yml`, or a `nav`
   pointing at a non-existent file. See **references/techdocs.md**.

For an entity already registered, `catalog_get_entity` shows how Backstage actually parsed
it — the fastest way to spot a broken owner/system relation.

## References

- **references/catalog-info.md** — `catalog-info.yaml` fields, annotations, discovery
  mechanics, and the common failures.
- **references/techdocs.md** — `mkdocs.yml` + `docs/` setup and how TechDocs builds.
- **references/doc-structure.md** — documentation structure, per-audience page content,
  and writing rules.
