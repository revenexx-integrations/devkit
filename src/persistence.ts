import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { importFresh } from './loader.js';
import { type DevStore, type DevStoreSnapshot, STORE_SCHEMA_VERSION } from './store.js';

/**
 * Layered persistence for the preview session:
 *   1. committed seeds (this module's {@link applySeeds}) — the durable base,
 *      with `${ENV_VAR}` references interpolated from the environment;
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

const ENV_REF = /\$\{([A-Z0-9_]+)\}/g;

/**
 * Recursively replaces `${ENV_VAR}` references in string values from `env`.
 * Throws a clear error when a referenced variable is unset so a developer
 * knows to add it to their `.env` — keeping secrets out of committed seeds.
 */
export function interpolateEnv<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof value === 'string') {
    return value.replace(ENV_REF, (_match, name: string) => {
      const resolved = env[name];
      if (resolved === undefined) {
        throw new Error(`Seed references \${${name}} but that environment variable is not set (add it to your .env).`);
      }
      return resolved;
    }) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => interpolateEnv(item, env)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = interpolateEnv(val, env);
    }
    return out as T;
  }
  return value;
}

/** Applies committed seeds to the store (env-interpolated). */
export function applySeeds(store: DevStore, seeds: DevSeeds, env: NodeJS.ProcessEnv = process.env): void {
  for (const secret of seeds.secrets ?? []) {
    const { key, value } = interpolateEnv(secret, env);
    store.setSecret(key, value);
  }
  for (const credential of seeds.credentials ?? []) {
    const resolved = interpolateEnv(credential, env);
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
    const resolved = interpolateEnv(workflow, env);
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
