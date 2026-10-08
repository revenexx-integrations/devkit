import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { importFresh } from './loader.js';
import { type DevStore, type DevStoreSnapshot, STORE_SCHEMA_VERSION } from './store.js';

/**
 * Layered persistence for the preview session:
 *   1. committed seeds (this module's {@link applySeeds}) — the durable base,
 *      fixed values only: a credential with a secret is created in the UI;
 *   2. `.revenexx-dev/state.json` overlay ({@link loadState}/{@link saveState}) —
 *      interactive session state, versioned and disposable.
 */

export interface CredentialSeed {
  credentialTypeSlug: string;
  name: string;
  config: Record<string, unknown>;
  /** Stable id so workflows can reference the credential across restarts. */
  id?: string;
  status?: string;
  durableCreds?: Record<string, unknown> | null;
}

export interface SecretSeed {
  key: string;
  value: string;
}

export interface WorkflowSeed {
  name: string;
  /** The workflow graph, named as the service names it. */
  blob?: Record<string, unknown>;
  /**
   * @deprecated The mock called this `definition` before it was aligned to the
   * service contract. Still accepted so existing seed files keep working.
   */
  definition?: Record<string, unknown>;
  description?: string | null;
  active?: boolean;
  executionMode?: string;
}

export interface DevSeeds {
  credentials?: CredentialSeed[];
  secrets?: SecretSeed[];
  workflows?: WorkflowSeed[];
}

/** Applies committed seeds to the store, as written. */
export function applySeeds(store: DevStore, seeds: DevSeeds): void {
  for (const secret of seeds.secrets ?? []) {
    const { key, value } = secret;
    store.setSecret(key, value);
  }
  for (const credential of seeds.credentials ?? []) {
    const resolved = credential;
    store.createCredential({
      credentialTypeSlug: resolved.credentialTypeSlug,
      name: resolved.name,
      config: resolved.config,
      id: resolved.id,
      status: resolved.status,
      durableCreds: resolved.durableCreds ?? null,
    });
  }
  for (const workflow of seeds.workflows ?? []) {
    const resolved = workflow;
    store.createWorkflow({
      name: resolved.name,
      blob: resolved.blob ?? resolved.definition ?? {},
      description: resolved.description,
      active: resolved.active,
      executionMode: resolved.executionMode,
    });
  }
}

/**
 * Reads a persisted session snapshot. Returns `null` (and warns) when the file
 * is absent or its `schemaVersion` no longer matches — the overlay is
 * disposable, so a mismatch is discarded rather than migrated.
 */
export function loadState(file: string, log: (msg: string) => void = console.warn): DevStoreSnapshot | null {
  if (!existsSync(file)) {
    return null;
  }
  let parsed: DevStoreSnapshot;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8')) as DevStoreSnapshot;
  } catch {
    log(`Ignoring ${file}: not valid JSON.`);
    return null;
  }
  if (parsed.schemaVersion !== STORE_SCHEMA_VERSION) {
    log(`Ignoring ${file}: schemaVersion ${parsed.schemaVersion} != ${STORE_SCHEMA_VERSION} (discarded, seeds are the source of truth).`);
    return null;
  }
  return parsed;
}

export function saveState(file: string, snapshot: DevStoreSnapshot): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf-8');
}

const SEED_ENTRY_CANDIDATES = ['index.ts', 'index.mjs', 'index.js', 'seeds.ts', 'seeds.js'];

/**
 * Loads committed seeds from a directory (default `dev/seeds`). Resolves the
 * first present entry file and reads its `default` or named `seeds` export.
 * Returns empty seeds when no seed directory/entry exists.
 */
export async function loadSeedsFromDir(dir: string): Promise<DevSeeds> {
  for (const candidate of SEED_ENTRY_CANDIDATES) {
    const path = resolve(dir, candidate);
    if (existsSync(path)) {
      const mod = await importFresh<{ default?: DevSeeds; seeds?: DevSeeds }>(path);
      return mod.default ?? mod.seeds ?? {};
    }
  }
  return {};
}
