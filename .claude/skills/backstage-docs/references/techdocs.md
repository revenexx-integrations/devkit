# TechDocs setup reference

TechDocs renders a repo's Markdown as the **Docs** tab in Backstage. It is separate from
catalog discovery: an entity can be in the catalog with no docs. Three things must line up.

## Table of contents

- [The three requirements](#the-three-requirements)
- [mkdocs.yml](#mkdocsyml)
- [docs/ layout](#docs-layout)
- [How it builds](#how-it-builds)
- [Common failures](#common-failures)

## The three requirements

1. The entity's `catalog-info.yaml` carries
   `backstage.io/techdocs-ref: url:https://github.com/<org>/<repo>/tree/main/`
2. An `mkdocs.yml` exists at the repo root.
3. A `docs/` directory exists with at least `docs/index.md`, and every file listed in the
   `mkdocs.yml` `nav` actually exists.

If all three hold, the Docs tab appears and rebuilds when the repo changes.

## mkdocs.yml

Minimal, matching the revenexx convention (Material theme + `techdocs-core` plugin):

```yaml
site_name: My Service
site_description: What this service is and who it is for.
repo_url: https://github.com/revenexx/my-service
docs_dir: docs

nav:
  - Home: index.md
  - Getting Started: getting-started.md
  - Architecture: architecture.md
  - Runbooks:
      - Operations: runbooks/operations.md

theme:
  name: material

plugins:
  - techdocs-core
```

Rules:

- `docs_dir: docs` — keep docs under a `docs/` subfolder. **Never `docs_dir: .`** — mkdocs
  rejects the config file living inside its own docs dir, and the TechDocs build fails with
  *"docs_dir should not be the parent directory of the config file"*. Every working revenexx
  repo uses `docs_dir: docs`.
- **Every `nav` entry must point at a file that exists.** A `nav` referencing a missing
  file fails the build and the Docs tab shows an error instead of content.
- Nested `nav` (a list under a label) produces a sub-menu, as with Runbooks above.
- Keep `plugins: [techdocs-core]` — the backstage instance builds with the local generator
  (`techdocs.generator.runIn: local`), which expects the core plugin set. Do not add
  mkdocs plugins that are not installed in the backstage image; they break the build.

## docs/ layout

```
docs/
├── index.md            # required — landing page (what/why/for whom)
├── getting-started.md
├── architecture.md
├── img/                # images referenced from Markdown
└── runbooks/
    └── operations.md
```

See `references/doc-structure.md` for what goes *into* these pages and for which audience.

## How it builds

The backstage instance is configured for **local** TechDocs
(`builder: local`, `generator.runIn: local`, `publisher.type: local`). That means Backstage
generates docs on demand from the repo — there is no separate CI publish step required for a
repo to get docs (the pipeline in the backstage repo's `docs/pipeline-setup.md` describes the
production path if/when it moves to external storage). Practically: get the three
requirements right and merge to `main`; docs render after the next catalog poll.

## Common failures

- **`nav` points at a missing file** → build error on the Docs tab. Every referenced `.md`
  must exist.
- **No `index.md`** → empty/broken docs. `index.md` is the entry point.
- **`techdocs-ref` missing from catalog-info.yaml** → no Docs tab at all (this is a catalog
  problem, not an mkdocs problem — see `references/catalog-info.md`).
- **Unsupported mkdocs plugin in `mkdocs.yml`** → generator fails. Stick to `techdocs-core`.
- **Relative links to files outside `docs/`** → do not resolve. Keep everything under
  `docs/` and reference images from `docs/img/`.
