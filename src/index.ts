/**
 * `@revenexx/integrations-node-devkit` — local development kit for Revenexx
 * integration node packages. Dev/CI only; never bundled into a node package.
 *
 * Two surfaces:
 *   - `@revenexx/integrations-node-devkit`          → the mock-API preview server (this entry)
 *   - `@revenexx/integrations-node-devkit/testing`  → the unit-testing harness
 */

import { readFileSync } from 'node:fs';

// Read from package.json rather than hardcoded, so the released version can
// never drift from what `integrations-devkit --version` prints. `../` resolves
// to the package root from both `src/` and the bundled `dist/`. The CJS build
// needs tsup's `shims: true` for `import.meta.url`.
const manifestUrl = new URL('../package.json', import.meta.url);
export const DEVKIT_VERSION: string = JSON.parse(readFileSync(manifestUrl, 'utf8')).version;

export {
  ENV_FILE_MIN_NODE,
  type EnvFileChoice,
  loadEnvFile,
  type LoadEnvFileOptions,
  nodeOwnedEnvFlag,
  resolveEnvFile,
} from './env.js';
export { DevApiError } from './errors.js';
export {
  ensureTsxRegistered,
  importFresh,
  type LoadedPackage,
  loadPackageFromEntry,
  resolveExports,
} from './loader.js';
export {
  applySeeds,
  type CredentialSeed,
  type DevSeeds,
  interpolateEnv,
  loadSeedsFromDir,
  loadState,
  saveState,
  type SecretSeed,
  type WorkflowSeed,
} from './persistence.js';
export {
  buildOAuthAuthorizeUrl,
  exchangeOAuthCode,
  findCredential,
  findCredentialType,
  findNode,
  nodeVersions,
  type ResolveNodeConfigInput,
  type ResolveNodeConfigResult,
  resolveCredentialInstance,
  resolveNodeConfig,
  testCredentialConfig,
  testCredentialInstance,
  type ValidateNodeConfigInput,
  type ValidateNodeConfigResult,
  validateNodeConfig,
} from './resolve.js';
export {
  createDevServer,
  createRequestListener,
  type DevServerDeps,
} from './server.js';
export {
  type CredentialRecord,
  DEV_TENANT_ID,
  DevStore,
  type DevStoreSnapshot,
  type SecretRecord,
  STORE_SCHEMA_VERSION,
  type TriggerRecord,
  type WorkflowRecord,
} from './store.js';
