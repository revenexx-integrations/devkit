/**
 * `@revenexx/integrations-node-devkit` — local development kit for Revenexx
 * integration node packages. Dev/CI only; never bundled into a node package.
 *
 * Two surfaces:
 *   - `@revenexx/integrations-node-devkit`          → the mock-API preview server (this entry)
 *   - `@revenexx/integrations-node-devkit/testing`  → the unit-testing harness
 */

export const DEVKIT_VERSION = '0.1.0';

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
