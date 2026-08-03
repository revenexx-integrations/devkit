# catalog-info.yaml reference

The `catalog-info.yaml` at the repository root is the **only** trigger for a repo to
appear in the revenexx Developer Portal. This file documents its fields, the discovery
mechanism, and the errors that keep a repo out of the catalog.

## Table of contents

- [How discovery works](#how-discovery-works)
- [Minimal Component](#minimal-component)
- [Field reference](#field-reference)
- [Annotations](#annotations)
- [Kinds beyond Component](#kinds-beyond-component)
- [Common failures](#common-failures)

## How discovery works

Backstage runs **GitHub Entity Providers** (configured in the backstage repo's
`app-config.yaml`) that poll every GitHub organization on a schedule and register any
`catalog-info.yaml` they find.

- **Orgs scanned:** `revenexx`, `revenexx-sdks`, `revenexx-integrations`. A repo in any
  other org is invisible — confirm the repo's org first.
- **Path:** exactly `/catalog-info.yaml` at the repo root. Not `docs/`, not a subfolder.
- **Branch:** `main` only. A file that lives only on a feature branch is not discovered;
  it must be merged to `main`.
- **Cadence:** every 5 minutes. After merging, a new/edited entity appears within ~5 min.
  There is no manual "refresh" for discovered entities — wait for the next poll.
- **Access:** the `revenexx Backstage` GitHub App must have access to the repo. A private
  repo the app cannot read is never scanned.

Do not hardcode these values in generated output — they are the current backstage config
and can change. When in doubt, read the `catalog.providers.github` block of the backstage
repo's `app-config.yaml`.

## Minimal Component

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: my-service              # unique across the whole catalog, kebab-case
  description: One-line summary of what this component is.
  annotations:
    github.com/project-slug: revenexx/my-service
    backstage.io/techdocs-ref: url:https://github.com/revenexx/my-service/tree/main/
  tags:
    - typescript
  links:
    - url: https://my-service.rvnxx.com
      title: Production
      icon: dashboard
spec:
  type: service                 # service | website | library
  owner: group:default/<team>   # MUST reference an existing Group — verify via MCP
  system: revenue-cloud         # MUST reference an existing System — verify via MCP
  lifecycle: production         # experimental | production | deprecated
```

## Field reference

| Field | Required | Notes |
| --- | --- | --- |
| `apiVersion` | yes | Always `backstage.io/v1alpha1`. |
| `kind` | yes | `Component`, `API`, `System`, `Resource`, `Group`, `User`, `Location` (per catalog rules). |
| `metadata.name` | yes | **Unique across the entire catalog**, kebab-case. A duplicate name silently collides with an existing entity. |
| `metadata.description` | yes | Shown in catalog list. Keep it one line. |
| `metadata.tags` | no | Free-form, lowercase. Used for filtering. |
| `metadata.links` | no | External URLs (prod, dashboards, tickets) with `title` + `icon`. |
| `spec.type` | yes | For `Component`: `service`, `website`, or `library`. |
| `spec.owner` | yes | `group:default/<name>` — must resolve to a real Group. |
| `spec.system` | recommended | Groups the component into a System (e.g. `revenue-cloud`). |
| `spec.lifecycle` | yes | `experimental`, `production`, or `deprecated`. |
| `spec.subcomponentOf` | no | `component:default/<parent>` to nest under a parent component. |

## Annotations

| Annotation | Purpose |
| --- | --- |
| `github.com/project-slug: <org>/<repo>` | Links the entity to its GitHub repo (enables the GitHub tabs, PR/issue counts). |
| `backstage.io/techdocs-ref: url:https://github.com/<org>/<repo>/tree/main/` | Tells TechDocs where the docs source is. **Without this annotation the Docs tab does not appear.** |

Use the `url:` form pointing at the repo's `main` tree — this is what every working
revenexx repo does (`cover`, `status`, `insights`, `website`, `backstage` itself), verified
against the live catalog. The backstage repo's `docs/onboarding.md` still shows `dir:.`,
but no production entity uses it; follow the live convention, not the onboarding guide.

## Kinds beyond Component

- **API** — register an OpenAPI/AsyncAPI/GraphQL spec. Use `kind: API`, `spec.type: openapi`,
  and `spec.definition` (inline or `$text` pointing at the spec file). See the backstage
  repo's `docs/api-guide.md` for the revenexx convention and proxy setup.
- **System** — a grouping of components. Usually already defined centrally (e.g.
  `revenue-cloud`); a new repo rarely needs to create one.
- Multiple entities can live in one file, separated by `---`.

## Common failures

- **Repo not in a scanned org** → not discovered at all. Check the org.
- **`spec.owner` points at a non-existent Group** → entity registers but shows an
  "unknown owner" error and does not link. The org's Groups have historically been
  inconsistent (duplicate/renamed teams), so never assume a name — verify via MCP
  (`catalog_search` / `catalog_get_entity`) before writing it.
- **`spec.system` does not exist** → same problem, broken relation.
- **`metadata.name` collides** with an existing catalog entity → one silently overwrites
  the other. Search the catalog for the name first.
- **File not on `main`** → invisible until merged.
- **Missing `techdocs-ref`** → entity appears but has no Docs tab even if `docs/` exists.
- **Invalid YAML / wrong indentation** → the provider skips the file; nothing appears and
  the error is only in backend logs.
