import {
  type IConfigField,
  type IConfigOption,
  type ICredential,
  type ICredentialContext,
  type ICredentialDescription,
  type ICredentialResolveResult,
  type ICredentialTestResult,
  type INode,
  type INodeAuthorContext,
  type INodeDescription,
  type INodeState,
  type IOutputPort,
  isOAuthAuthorizeCredential,
  settingApplies,
} from '@revenexx/integrations-node-sdk';
import { DevApiError } from './errors.js';
import { assertNotRepointed, assertTtlInRange, DEFAULT_CLAIM_TTL_SECONDS } from './state-rules.js';
import type { LoadedPackage } from './loader.js';
import type { DevStore } from './store.js';

/**
 * The fidelity centre of the mock API: instead of the production sandbox +
 * content-addressed bundle, the developer's live node/credential instances are
 * invoked directly in-process. Author-time resolvers, credential `test`, and
 * `resolve` run exactly as the developer wrote them. The PO-145 grant/security
 * model is intentionally omitted — this is dev-only.
 */

const noopLogger = {
  info() {},
  warn() {},
  error() {},
};

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(n => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function nodeVersions(loaded: LoadedPackage, slug: string): string[] {
  return loaded.nodes
    .filter(n => n.description.slug === slug)
    .map(n => n.description.version)
    .sort((a, b) => compareSemver(b, a));
}

/**
 * The order `GET /nodes` lists a package's nodes in: every version of a slug
 * together, newest first, with the slugs themselves in the order the package
 * exports them.
 *
 * Export order alone is not enough any more. The registry answers each slug's
 * versions semver-descending, and the studio's catalogue takes that order as
 * given rather than parsing a semver of its own — since
 * `@revenexx/studio-integrations` 1.3.0 `newerExecutableVersions()` reads "newer
 * than the pinned one" as "earlier in this array". A package that exports 1.0.0
 * before 2.0.0 — the order a human writes them in — would therefore have the
 * inspector announce the OLDER version as the upgrade, and say nothing about the
 * real one. `GET /nodes/{slug}/versions` has always sorted; this is the same
 * order on the listing the catalogue is actually built from.
 */
export function listNodesNewestFirst(nodes: readonly INodeDescription[]): INodeDescription[] {
  const bySlug = new Map<string, INodeDescription[]>();
  for (const node of nodes) {
    const group = bySlug.get(node.slug);
    if (group) {
      group.push(node);
    } else {
      bySlug.set(node.slug, [node]);
    }
  }
  return [...bySlug.values()].flatMap(group => [...group].sort((a, b) => compareSemver(b.version, a.version)));
}

export function findNode(loaded: LoadedPackage, slug: string, version?: string): INode {
  const matches = loaded.nodes.filter(n => n.description.slug === slug);
  if (matches.length === 0) {
    throw new DevApiError(404, `Node '${slug}' not found.`);
  }
  if (!version || version === 'latest') {
    return [...matches].sort((a, b) => compareSemver(b.description.version, a.description.version))[0]!;
  }
  const exact = matches.find(n => n.description.version === version);
  if (!exact) {
    throw new DevApiError(404, `Node '${slug}' has no version '${version}'.`);
  }
  return exact;
}

export function findCredential(loaded: LoadedPackage, slug: string): ICredential {
  const cred = loaded.credentials.find(c => c.description.slug === slug);
  if (!cred) {
    throw new DevApiError(404, `Credential type '${slug}' not found.`);
  }
  return cred;
}

export function findCredentialType(loaded: LoadedPackage, slug: string): ICredentialDescription {
  return findCredential(loaded, slug).description;
}

function credentialContext(store: DevStore, credentialId?: string): ICredentialContext {
  return {
    signal: new AbortController().signal,
    logger: noopLogger,
    persistDurableCreds: credentialId
      ? async (durableCreds: Record<string, unknown>) => {
          store.updateCredential(credentialId, { durableCreds });
        }
      : undefined,
  };
}

/** Resolves a credential instance's access data by running its real `resolve`. */
export async function resolveCredentialInstance(loaded: LoadedPackage, store: DevStore, credentialId: string): Promise<ICredentialResolveResult> {
  const instance = store.getCredential(credentialId);
  if (!instance) {
    throw new DevApiError(404, `Credential instance '${credentialId}' not found.`);
  }
  const cred = findCredential(loaded, instance.credentialTypeSlug);
  const ctx = credentialContext(store, credentialId);
  return cred.resolve(ctx, instance.config, instance.durableCreds);
}

/**
 * `ctx.state` for one preview run (PO-374), backed by the dev store — so a node
 * that correlates ids behaves on its second call like a second run.
 *
 * Returns the state surface together with the `commit` that ends the run. A
 * mapping and a claim go straight to the store, because a correlation dropped by
 * a later failure is how the next run creates a duplicate; a cursor and a digest
 * are staged here and written only when `commit` is called, so a read during the
 * run answers what the last *completed* run left. That is the store's visibility
 * rule, and it is the reason `INodeState` has four operations instead of a
 * generic get/set.
 *
 * **Deliberately divergent from production in one respect**, and the one place
 * this mock does not mirror the real API: there, author-time execution is
 * read-only, because a correlation created by a test click would be
 * indistinguishable from one a production run made and the next real run would
 * trust it. Locally there is no such stake — the whole store is a disposable
 * overlay in `.revenexx-dev/` — and refusing writes would make it impossible to
 * exercise the very nodes the state store exists for. The divergence is noted in
 * the README.
 */
function createRunState(store: DevStore): { state: INodeState; commit: () => void } {
  /** Staged for this run: written to the store by `commit`, dropped otherwise. */
  const staged: Array<{ namespace: string; role: 'cursor' | 'digest'; key: string; value: unknown }> = [];
  const stage = (entry: (typeof staged)[number]): void => {
    staged.push(entry);
  };

  const state: INodeState = {
    mapping: {
      async get(namespace, key, side = 'left') {
        if (side === 'left') {
          const entry = store.getStateEntry('mapping', namespace, key);
          return entry ? String(entry.value) : null;
        }
        const match = store.listStateEntries('mapping', namespace).find(e => String(e.value) === key);
        return match ? match.key : null;
      },
      async put(namespace, left, right) {
        assertNotRepointed(
          namespace,
          store.listStateEntries('mapping', namespace).map(e => [e.key, String(e.value)] as [string, string]),
          left,
          right,
        );
        store.putStateEntry({ namespace, role: 'mapping', key: left, value: right });
      },
    },
    cursor: {
      async get(namespace, partitionKey = '') {
        return store.getStateEntry('cursor', namespace, partitionKey)?.value;
      },
      async set(namespace, value, partitionKey = '') {
        stage({ namespace, role: 'cursor', key: partitionKey, value });
      },
    },
    async claim(namespace, key, opts) {
      assertTtlInRange(opts?.ttlSeconds);
      const held = store.getStateEntry('dedupe', namespace, key);
      // Expiry is honoured so a short TTL can actually be exercised locally,
      // rather than a claim looking permanent for the whole session.
      if (held && Number(held.value) > Date.now()) {
        return false;
      }
      const ttlSeconds = opts?.ttlSeconds ?? DEFAULT_CLAIM_TTL_SECONDS;
      store.putStateEntry({ namespace, role: 'dedupe', key, value: Date.now() + ttlSeconds * 1000 });
      return true;
    },
    digest: {
      async unchanged(namespace, entityKey, digest) {
        return store.getStateEntry('digest', namespace, entityKey)?.value === digest;
      },
      async set(namespace, entityKey, digest) {
        stage({ namespace, role: 'digest', key: entityKey, value: digest });
      },
    },
  };

  return {
    state,
    commit() {
      for (const entry of staged) {
        store.putStateEntry(entry);
      }
      staged.length = 0;
    },
  };
}

function authorContext(loaded: LoadedPackage, store: DevStore, config: Record<string, unknown>, locale?: string): INodeAuthorContext {
  return {
    signal: new AbortController().signal,
    logger: noopLogger,
    config,
    secrets: {
      async get(key: string): Promise<string> {
        const secret = store.getSecret(key);
        if (!secret) {
          throw new DevApiError(404, `Secret '${key}' not found.`);
        }
        return secret.value;
      },
    },
    credentials: {
      async get(id: string): Promise<Record<string, unknown>> {
        return (await resolveCredentialInstance(loaded, store, id)).credentials;
      },
    },
    locale,
  };
}

export interface ResolveNodeConfigInput {
  slug: string;
  version?: string;
  /** `"*"` (all), `"outputs"`, or a specific config field key. */
  target: string;
  config: Record<string, unknown>;
  locale?: string;
}

export interface ResolveNodeConfigResult {
  options?: IConfigOption[];
  fields?: IConfigField[];
  outputs?: IOutputPort[];
}

/**
 * Runs a node's author-time resolvers for the requested `target`, mirroring
 * the server's `config:resolve` semantics.
 */
export async function resolveNodeConfig(loaded: LoadedPackage, store: DevStore, input: ResolveNodeConfigInput): Promise<ResolveNodeConfigResult> {
  const node = findNode(loaded, input.slug, input.version);
  const ctx = authorContext(loaded, store, input.config ?? {}, input.locale);

  try {
    if (input.target === 'outputs') {
      if (!node.resolveOutputs) {
        return { outputs: [] };
      }
      return { outputs: await node.resolveOutputs(ctx) };
    }

    if (input.target === '*') {
      const result: ResolveNodeConfigResult = {};
      if (node.resolveConfigSchema) {
        result.fields = await node.resolveConfigSchema(ctx);
      }
      if (node.resolveOutputs) {
        result.outputs = await node.resolveOutputs(ctx);
      }
      return result;
    }

    // A specific config field key.
    const field = node.description.config?.find(f => f.key === input.target);
    if (field?.type === 'dynamic-schema') {
      if (!node.resolveConfigSchema) {
        return { fields: [] };
      }
      return { fields: await node.resolveConfigSchema(ctx) };
    }
    if (!node.loadOptions) {
      return { options: [] };
    }
    return { options: await node.loadOptions(ctx, input.target) };
  } catch (err) {
    if (err instanceof DevApiError) {
      throw err;
    }
    throw new DevApiError(502, `Node resolve failed: ${(err as Error).message}`);
  }
}

export interface ValidateNodeConfigInput {
  slug: string;
  version?: string;
  config: Record<string, unknown>;
  locale?: string;
}

export interface ValidateNodeConfigResult {
  valid: boolean;
  /** Config field key → human-readable messages. Empty object when valid. */
  errors: Record<string, string[]>;
}

/** True when a value counts as "provided" (mirrors the UI's `isResolvableValue`). */
function isProvided(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

/** An expression placeholder (`${{…}}` / leading `=`) is "set" but not statically checkable. */
function isExpression(value: unknown): boolean {
  return typeof value === 'string' && (value.startsWith('=') || value.includes('${{'));
}

/** Applies one field's static rules to `value`, pushing messages under `field.key`. */
function validateField(field: IConfigField, value: unknown, errors: Record<string, string[]>): void {
  const push = (msg: string): void => {
    (errors[field.key] ??= []).push(msg);
  };
  const provided = isProvided(value);
  if (field.required && !provided) {
    push('This field is required.');
    return;
  }
  if (!provided || isExpression(value)) {
    // Optional-and-empty, or an expression the mock cannot evaluate — skip type/rules.
    return;
  }

  switch (field.type) {
    case 'string':
    case 'secret-ref':
    // A `state-ref` carries the chosen namespace NAME, so a string is all there
    // is to check here: which names exist is the workflow's declaration, and
    // nothing declares one locally (see the README's fidelity caveats).
    case 'state-ref':
    case 'expression':
      if (typeof value !== 'string') {
        push('Expected a string.');
      }
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        push('Expected a number.');
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        push('Expected a boolean.');
      }
      break;
    case 'select':
      // Dynamic options are only known after resolve — can't check membership here.
      if (!field.dynamic && field.options && !field.options.some(o => o.value === value)) {
        push('Not one of the allowed options.');
      }
      break;
    case 'multiselect':
      if (!Array.isArray(value)) {
        push('Expected an array.');
      } else if (!field.dynamic && field.options) {
        const allowed = new Set(field.options.map(o => o.value));
        for (const v of value) {
          if (!allowed.has(v as string | number | boolean)) {
            push(`Value '${String(v)}' is not an allowed option.`);
          }
        }
      }
      break;
    case 'array':
      if (!Array.isArray(value)) {
        push('Expected an array.');
      }
      break;
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        push('Expected an object.');
      }
      break;
    // credentials-ref / dynamic-schema carry no scalar type check here.
  }

  const v = field.validation;
  if (v) {
    if (typeof value === 'string') {
      if (v.pattern !== undefined && !new RegExp(v.pattern).test(value)) {
        push(`Does not match pattern ${v.pattern}.`);
      }
      if (v.minLength !== undefined && value.length < v.minLength) {
        push(`Must be at least ${v.minLength} characters.`);
      }
      if (v.maxLength !== undefined && value.length > v.maxLength) {
        push(`Must be at most ${v.maxLength} characters.`);
      }
    }
    if (typeof value === 'number') {
      if (v.min !== undefined && value < v.min) {
        push(`Must be >= ${v.min}.`);
      }
      if (v.max !== undefined && value > v.max) {
        push(`Must be <= ${v.max}.`);
      }
    }
    if (Array.isArray(value)) {
      if (v.minLength !== undefined && value.length < v.minLength) {
        push(`Must have at least ${v.minLength} items.`);
      }
      if (v.maxLength !== undefined && value.length > v.maxLength) {
        push(`Must have at most ${v.maxLength} items.`);
      }
    }
  }
}

/**
 * Validates a submitted node `config` against the field rules in its manifest
 * (`required`, `IConfigValidation`, types, static options). For `dynamic-schema`
 * fields the resolved child schema is fetched and its rules applied to the
 * flattened keys. Deep cross-field validation is intentionally out of scope
 * (the production service does that on save); this mirrors the mock's
 * "light, schema-based" fidelity. Unknown extra keys are ignored.
 *
 * A field whose `showIf` does not hold (SDK 1.0.0, PO-410) is skipped whole —
 * not demanded when required, and not type-checked either. The editor does not
 * draw it, so whatever is left under its key is a leftover from a choice the
 * author has since changed, and refusing to save because of it would leave them
 * with an error against a field they cannot see. `settingApplies` comes from the
 * SDK rather than being re-implemented here: the editor drawing the field and
 * this validator deciding whether to demand it have to agree word for word.
 */
export async function validateNodeConfig(loaded: LoadedPackage, store: DevStore, input: ValidateNodeConfigInput): Promise<ValidateNodeConfigResult> {
  const node = findNode(loaded, input.slug, input.version);
  const config = input.config ?? {};
  const errors: Record<string, string[]> = {};
  const fields = node.description.config ?? [];

  for (const field of fields) {
    if (field.type === 'dynamic-schema') {
      continue; // resolved child fields are validated below
    }
    if (!settingApplies(field, config)) {
      continue; // its `showIf` says it is not on screen — see the doc comment
    }
    validateField(field, config[field.key], errors);
  }

  // A `dynamic-schema` marker can carry a `showIf` of its own — the condition
  // sits on `IConfigFieldBase`, not on the leaf types — and then the whole group
  // it stands for is off screen. `resolveConfigSchema` is per node rather than
  // per field, so a node with several markers resolves as soon as one of them
  // applies: which children came from which marker is not something the callback
  // says, and demanding none of them would be the worse guess of the two.
  if (fields.some(f => f.type === 'dynamic-schema' && settingApplies(f, config)) && node.resolveConfigSchema) {
    const ctx = authorContext(loaded, store, config, input.locale);
    let children: IConfigField[];
    try {
      children = await node.resolveConfigSchema(ctx);
    } catch (err) {
      if (err instanceof DevApiError) {
        throw err;
      }
      throw new DevApiError(502, `Node resolve failed: ${(err as Error).message}`);
    }
    for (const child of children) {
      if (!settingApplies(child, config)) {
        continue;
      }
      validateField(child, config[child.key], errors);
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export interface ExecuteNodeTestInput {
  slug: string;
  version?: string;
  /** The node's config values to run with. */
  config: Record<string, unknown>;
  /** Simulated input payloads, merged OVER the config (the contract's wording). */
  inputs: Record<string, unknown>;
  /** Wall-clock limit; clamped to >= 1000 ms like the real runtime. */
  timeoutMs?: number;
}

export interface ExecuteNodeTestResult {
  outputs: Record<string, unknown>;
  branch: string | null;
  logs: Array<{ level: string; message: string; meta?: Record<string, unknown> }>;
}

/** Floor the contract puts on `timeout_ms`, and the default when none is given. */
const MIN_TIMEOUT_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Thrown by the timeout arm of the race; never leaves `executeNodeTest`. */
class ExecuteTimeout extends Error {}

/**
 * Runs a node's real `execute` in-process — the closest the mock gets to the
 * production sandbox, and the endpoint node authors care about most.
 *
 * `execute(ctx, inputs)` takes a single merged object, so `config` and `inputs`
 * are merged here with `inputs` winning, matching how the service describes it.
 * Logger calls are collected and returned as `logs` instead of being dropped.
 *
 * The timeout is enforced by racing, not just by aborting `ctx.signal`. A node
 * that never looks at the signal — an accidental infinite loop's `await`, a
 * third-party client that takes no `AbortSignal` — would otherwise hang the
 * request until Node's own 300 s `requestTimeout`, which is the opposite of what
 * "honours timeout_ms" should mean for someone debugging their own node. The
 * signal is still aborted first, so a well-behaved node fails fast and its own
 * error wins the race.
 */
export async function executeNodeTest(loaded: LoadedPackage, store: DevStore, input: ExecuteNodeTestInput): Promise<ExecuteNodeTestResult> {
  const node = findNode(loaded, input.slug, input.version);
  const logs: ExecuteNodeTestResult['logs'] = [];
  const record = (level: string) => (message: string, meta?: Record<string, unknown>) => {
    logs.push(meta === undefined ? { level, message } : { level, message, meta });
  };

  const timeoutMs = Math.max(MIN_TIMEOUT_MS, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const run = createRunState(store);
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ExecuteTimeout());
    }, timeoutMs);
  });

  const ctx = {
    signal: controller.signal,
    logger: { info: record('info'), warn: record('warn'), error: record('error') },
    secrets: {
      async get(key: string): Promise<string> {
        const secret = store.getSecret(key);
        if (!secret) {
          throw new DevApiError(404, `Secret '${key}' not found.`);
        }
        return secret.value;
      },
    },
    credentials: {
      async get(id: string): Promise<Record<string, unknown>> {
        return (await resolveCredentialInstance(loaded, store, id)).credentials;
      },
    },
    state: run.state,
  };

  try {
    const result = await Promise.race([node.execute(ctx, { ...input.config, ...input.inputs }), expired]);
    // The run completed, so what it staged is adopted. A node that threw, or one
    // the timeout cut off, leaves its cursors and digests where they were — the
    // failed-run case the staging rule exists for, and the one an author is most
    // likely to have got wrong.
    run.commit();
    return { outputs: result.outputs ?? {}, branch: result.branch ?? null, logs };
  } catch (err) {
    if (err instanceof DevApiError) {
      throw err;
    }
    // The node itself threw, or the race expired. 502 mirrors how the mock reports a
    // failing author-time resolver, and the collected logs go along so the failure is
    // diagnosable — a timeout in particular is usually only readable from the logs
    // the node managed to emit before it stalled.
    const reason = err instanceof ExecuteTimeout || controller.signal.aborted ? `timed out after ${timeoutMs} ms` : (err as Error).message;
    throw new DevApiError(502, `Node execution failed: ${reason}`, { logs: logs.map(l => `${l.level}: ${l.message}`) });
  } finally {
    // Also stops the timer from holding the event loop open when the node won.
    clearTimeout(timer);
  }
}

/** Runs a credential type's `test` against inline (unsaved) config. */
export async function testCredentialConfig(loaded: LoadedPackage, store: DevStore, typeSlug: string, config: Record<string, unknown>): Promise<ICredentialTestResult> {
  const cred = findCredential(loaded, typeSlug);
  return cred.test(credentialContext(store), config);
}

/** Runs `test` against a saved credential instance's stored config. */
export async function testCredentialInstance(loaded: LoadedPackage, store: DevStore, credentialId: string): Promise<ICredentialTestResult> {
  const instance = store.getCredential(credentialId);
  if (!instance) {
    throw new DevApiError(404, `Credential instance '${credentialId}' not found.`);
  }
  const cred = findCredential(loaded, instance.credentialTypeSlug);
  return cred.test(credentialContext(store, credentialId), instance.config);
}

export async function buildOAuthAuthorizeUrl(
  loaded: LoadedPackage,
  store: DevStore,
  credentialId: string,
  params: { redirectUri: string; state: string },
): Promise<{ authorizeUrl: string; codeVerifier?: string }> {
  const instance = store.getCredential(credentialId);
  if (!instance) {
    throw new DevApiError(404, `Credential instance '${credentialId}' not found.`);
  }
  const cred = findCredential(loaded, instance.credentialTypeSlug);
  if (!isOAuthAuthorizeCredential(cred)) {
    throw new DevApiError(422, `Credential type '${instance.credentialTypeSlug}' is not a 3-legged OAuth type.`);
  }
  return cred.buildAuthorizeUrl(credentialContext(store, credentialId), instance.config, params);
}

export async function exchangeOAuthCode(
  loaded: LoadedPackage,
  store: DevStore,
  credentialId: string,
  params: { code: string; redirectUri: string; codeVerifier?: string },
): Promise<{ durableCreds: Record<string, unknown> }> {
  const instance = store.getCredential(credentialId);
  if (!instance) {
    throw new DevApiError(404, `Credential instance '${credentialId}' not found.`);
  }
  const cred = findCredential(loaded, instance.credentialTypeSlug);
  if (!isOAuthAuthorizeCredential(cred)) {
    throw new DevApiError(422, `Credential type '${instance.credentialTypeSlug}' is not a 3-legged OAuth type.`);
  }
  const out = await cred.exchangeCode(credentialContext(store, credentialId), instance.config, params);
  store.updateCredential(credentialId, { durableCreds: out.durableCreds, status: 'active' });
  return out;
}
