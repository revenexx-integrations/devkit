#!/usr/bin/env python3
"""Scaffold Backstage catalog + TechDocs files for a repository.

Generates, at the target repo root:
  - catalog-info.yaml   (entity for Backstage auto-discovery)
  - mkdocs.yml          (TechDocs config)
  - docs/index.md       (+ starter pages based on --type)

Owner and System are written as given but are NOT verified here — they must resolve to
entities that already exist in the catalog. Verify them against the live instance (via the
Backstage MCP) before committing. See references/catalog-info.md.
"""

import argparse
import json
import sys
from pathlib import Path

TYPE_PAGES = {
    "service": ["getting-started", "architecture", "api", "runbooks/operations"],
    "website": ["getting-started", "architecture"],
    "library": ["getting-started", "usage"],
}

SCANNED_ORGS = ("revenexx", "revenexx-sdks", "revenexx-integrations")

PAGE_TITLES = {
    "getting-started": "Getting Started",
    "architecture": "Architecture",
    "api": "API",
    "usage": "Usage",
    "runbooks/operations": "Operations",
}


def catalog_info(name, description, ctype, owner, system, slug, lifecycle):
    return f"""apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: {json.dumps(name)}
  description: {json.dumps(description)}
  annotations:
    github.com/project-slug: {slug}
    backstage.io/techdocs-ref: url:https://github.com/{slug}/tree/main/
  tags: []
  links: []
spec:
  type: {ctype}
  owner: {owner}
  system: {system}
  lifecycle: {lifecycle}
"""


def mkdocs_yml(name, description, slug, pages):
    nav = ["  - Home: index.md"]
    runbooks = [p for p in pages if p.startswith("runbooks/")]
    flat = [p for p in pages if not p.startswith("runbooks/")]
    for p in flat:
        nav.append(f"  - {PAGE_TITLES[p]}: {p}.md")
    if runbooks:
        nav.append("  - Runbooks:")
        for p in runbooks:
            nav.append(f"      - {PAGE_TITLES[p]}: {p}.md")
    return f"""site_name: {json.dumps(name)}
site_description: {json.dumps(description)}
repo_url: https://github.com/{slug}
docs_dir: docs

nav:
{chr(10).join(nav)}

theme:
  name: material

plugins:
  - techdocs-core
"""


def page_stub(title, name):
    if title == "Home":
        return (
            f"# {name}\n\n"
            "One paragraph: what this is, the problem it solves, and who it is for.\n\n"
            "## Where it fits\n\n"
            "One line on its place in the platform.\n\n"
            "## Links\n\n"
            "- Production: <url>\n- Repository: <url>\n"
        )
    return f"# {title}\n\n<!-- Write for the intended reader. See doc-structure.md. -->\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo-root", required=True, help="Path to the target repo root")
    ap.add_argument("--name", required=True, help="Entity name (kebab-case, unique in catalog)")
    ap.add_argument("--description", required=True)
    ap.add_argument("--type", choices=list(TYPE_PAGES), default="service")
    ap.add_argument("--owner", required=True, help="e.g. group:default/platform-team")
    ap.add_argument("--system", required=True, help="e.g. revenue-cloud")
    ap.add_argument("--slug", required=True, help="GitHub org/repo, e.g. revenexx/my-service")
    ap.add_argument("--lifecycle", choices=["experimental", "production", "deprecated"],
                    default="experimental")
    ap.add_argument("--force", action="store_true", help="Overwrite existing files")
    args = ap.parse_args()

    root = Path(args.repo_root).resolve()
    if not root.is_dir():
        sys.exit(f"error: repo root does not exist: {root}")

    org = args.slug.split("/", 1)[0]
    if org not in SCANNED_ORGS:
        print(f"warning: org '{org}' is not scanned by Backstage auto-discovery "
              f"({', '.join(SCANNED_ORGS)}); the repo will not be discovered from here.",
              file=sys.stderr)

    pages = TYPE_PAGES[args.type]
    files = {
        root / "catalog-info.yaml": catalog_info(
            args.name, args.description, args.type, args.owner, args.system,
            args.slug, args.lifecycle),
        root / "mkdocs.yml": mkdocs_yml(args.name, args.description, args.slug, pages),
        root / "docs" / "index.md": page_stub("Home", args.name),
    }
    for p in pages:
        files[root / "docs" / f"{p}.md"] = page_stub(PAGE_TITLES[p], args.name)

    existing = [f for f in files if f.exists()]
    if existing and not args.force:
        sys.exit("error: would overwrite existing files (use --force):\n  " +
                 "\n  ".join(str(f.relative_to(root)) for f in existing))

    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        print(f"wrote {path.relative_to(root)}")

    print("\nNext:")
    print(f"  1. Verify owner ({args.owner}) and system ({args.system}) exist in the")
    print("     catalog via the Backstage MCP (catalog_search / catalog_get_entity),")
    print("     and confirm the metadata.name does not collide with an existing entity.")
    print("  2. Fill in docs/ pages — see references/doc-structure.md.")
    print("  3. Merge to main; the entity appears after the next catalog poll (~5 min).")


if __name__ == "__main__":
    main()
