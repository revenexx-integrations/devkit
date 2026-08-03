import { pathToFileURL } from 'node:url';
import { buildManifest, type ICredential, type INode, type ITemplateDescription, type NodeManifest } from '@revenexx/integrations-node-sdk';

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
export function resolveExports(mod: PackageExports): LoadedPackage {
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
  return resolveExports(await importFresh<PackageExports>(entryPath));
}
