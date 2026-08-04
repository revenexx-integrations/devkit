import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildManifest, type ICredential, type INode, type ITemplateDescription, type NodeManifest } from '@revenexx/integrations-node-sdk';

/** Identity of the npm package the nodes came from, as `GET /nodes` reports it. */
export interface PackageInfo {
  name: string;
  version: string;
  label: string;
}

const UNKNOWN_PACKAGE: PackageInfo = { name: 'unknown', version: '0.0.0', label: 'Local package' };

/**
 * A node package loaded into the dev process: its live `NODES` / `CREDENTIALS`
 * / `TEMPLATES` instances (so author-time resolvers, `test`, and `resolve` can
 * be invoked in-process — no bundle, no sandbox) plus the derived manifest the
 * mock API serves.
 */
export interface LoadedPackage {
  nodes: INode[];
  credentials: ICredential[];
  templates: ITemplateDescription[];
  manifest: NodeManifest;
  /** Reported as each node's `package`; the contract declares it non-null. */
  packageInfo: PackageInfo;
  /** Stands in for the service's per-node `created_at`/`updated_at`. */
  loadedAt: string;
}

/**
 * Reads the nearest `package.json` above `entryPath` for the node package's
 * identity. The real service knows this from the published bundle; here it comes
 * from the developer's own manifest.
 */
export function readPackageInfo(entryPath: string): PackageInfo {
  let dir = dirname(entryPath);
  for (let up = 0; up < 6; up += 1) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { name?: string; version?: string; description?: string };
        if (pkg.name) {
          return { name: pkg.name, version: pkg.version ?? '0.0.0', label: pkg.name.split('/').pop() ?? pkg.name };
        }
      } catch {
        // Unreadable package.json is not worth failing the preview over.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return UNKNOWN_PACKAGE;
}

interface PackageExports {
  NODES?: unknown;
  CREDENTIALS?: unknown;
  TEMPLATES?: unknown;
}

/**
 * Validates a package's module exports and builds a {@link LoadedPackage}.
 * Mirrors the checks in the SDK's `rvnxx-nodes manifest` CLI so the dev loop
 * and the build produce identical manifests.
 */
export function resolveExports(mod: PackageExports, packageInfo: PackageInfo = UNKNOWN_PACKAGE): LoadedPackage {
  if (!Array.isArray(mod.NODES)) {
    throw new Error('Package entry does not export a `NODES` array. Export `NODES: INode[]`.');
  }
  if (mod.CREDENTIALS !== undefined && !Array.isArray(mod.CREDENTIALS)) {
    throw new Error('Package entry exports `CREDENTIALS` but it is not an array.');
  }
  if (mod.TEMPLATES !== undefined && !Array.isArray(mod.TEMPLATES)) {
    throw new Error('Package entry exports `TEMPLATES` but it is not an array.');
  }

  const nodes = mod.NODES as INode[];
  const credentials = (mod.CREDENTIALS as ICredential[] | undefined) ?? [];
  const templates = (mod.TEMPLATES as ITemplateDescription[] | undefined) ?? [];

  return {
    nodes,
    credentials,
    templates,
    manifest: buildManifest(nodes, credentials, templates),
    packageInfo,
    loadedAt: new Date().toISOString(),
  };
}

let tsxRegistered = false;

/**
 * Registers the `tsx` ESM loader once per process so `import()` can load
 * TypeScript sources directly. Idempotent.
 */
export async function ensureTsxRegistered(): Promise<void> {
  if (tsxRegistered) {
    return;
  }
  const { register } = await import('tsx/esm/api');
  register();
  tsxRegistered = true;
}

/**
 * File extensions whose change should reload the package.
 *
 * `[cm]?[jt]sx?` covers the whole matrix — `.ts .tsx .cts .mts .js .jsx .cjs .mjs`
 * — rather than the `.ts`-family-plus-bare-`.js` it used to be. That older pattern
 * silently ignored `.mjs` and `.cjs`, so a package whose entry is a built ESM
 * `dist/index.mjs` never hot-reloaded at all: edits landed, nothing happened, and
 * nothing said why.
 *
 * `.json` is in because a node that imports locale strings or lookup data from one
 * has to re-evaluate when it changes. A reload it did not need costs a few ms and
 * keeps the previous package on failure, so erring towards reloading is free.
 */
const RELOADABLE_SOURCE = /\.(?:[cm]?[jt]sx?|json)$/;

/** True when a changed file is package source the mock should reload for. */
export function isReloadableSource(file: string): boolean {
  return RELOADABLE_SOURCE.test(file);
}

/** Imports a module by path, registering tsx first for TypeScript sources. */
export async function importFresh<T = unknown>(entryPath: string): Promise<T> {
  if (/\.[cm]?tsx?$/.test(entryPath)) {
    await ensureTsxRegistered();
  }
  const href = `${pathToFileURL(entryPath).href}?t=${Date.now()}`;
  return (await import(href)) as T;
}

/**
 * Imports a package entry and resolves its exports. Supports TypeScript
 * sources directly (via `tsx`) so the preview runs against the developer's
 * live `src/`, not a built artifact. A cache-busting query is appended so
 * repeated calls (hot-reload) re-evaluate the module.
 */
export async function loadPackageFromEntry(entryPath: string): Promise<LoadedPackage> {
  return resolveExports(await importFresh<PackageExports>(entryPath), readPackageInfo(entryPath));
}
