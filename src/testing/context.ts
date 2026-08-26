import type { INodeContext } from '@revenexx/integrations-node-sdk';
import { vi } from 'vitest';

/**
 * Drop-in replacement for the `createMockContext` helper that was, until this
 * package existed, copy-pasted byte-for-byte into every node repo's
 * `tests/helpers/context.ts`. Builds a full {@link INodeContext} with
 * `vi.fn()`-backed `logger`, `secrets.get`, `credentials.get` and `state` so a
 * node's `execute` can be unit-tested in isolation.
 *
 * The state mock is **stateful on purpose**: what the node writes, it reads
 * back. A node's interesting behaviour is precisely the second run — the one
 * that finds the mapping it created the first time — and a mock that forgets
 * would only ever exercise the create branch. It is the one place an author can
 * test writes at all: in the real product, author-time execution is read-only.
 */

export type MockLogger = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

export type MockSecrets = {
  get: ReturnType<typeof vi.fn>;
};

export type MockCredentials = {
  get: ReturnType<typeof vi.fn>;
};

/** Every state operation is a `vi.fn()`, so calls can be asserted on. */
export type MockState = {
  mapping: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
  cursor: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  claim: ReturnType<typeof vi.fn>;
  digest: { unchanged: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
};

/**
 * What the store already knows when the node starts — the "this ran before"
 * half of any sync test.
 */
export interface MockStateSeed {
  /** namespace -> { leftKey: rightKey }; readable from either side. */
  mappings?: Record<string, Record<string, string>>;
  /** namespace -> partitionKey ('' for the unpartitioned one) -> watermark. */
  cursors?: Record<string, Record<string, unknown>>;
  /** namespace -> keys already claimed, so `claim` returns false for them. */
  claims?: Record<string, string[]>;
  /** namespace -> { entityKey: digest }. */
  digests?: Record<string, Record<string, string>>;
}

export type MockContext = INodeContext & {
  logger: MockLogger;
  secrets: MockSecrets;
  credentials: MockCredentials;
  state: MockState;
};

export interface CreateMockContextOptions {
  signal?: AbortSignal;
  /** Secret key -> value returned by `secrets.get`. Unknown keys fall back to a deterministic stub. */
  secrets?: Record<string, string>;
  /** When set, `secrets.get` rejects with this error instead of resolving. */
  secretsError?: Error;
  /** Credential instance id -> resolved access data returned by `credentials.get`. */
  credentials?: Record<string, Record<string, unknown>>;
  /** When set, `credentials.get` rejects with this error instead of resolving. */
  credentialsError?: Error;
  /** What the state store already holds when the node starts. */
  state?: MockStateSeed;
  /**
   * When set, every state call rejects with this error — the shape of the
   * engine refusing a namespace the workflow never declared.
   */
  stateError?: Error;
}

export function createMockContext(options: CreateMockContextOptions = {}): MockContext {
  const signal = options.signal ?? new AbortController().signal;

  const secretsGet = options.secretsError
    ? vi.fn(async () => {
        throw options.secretsError;
      })
    : vi.fn(async (key: string) => {
        if (options.secrets && key in options.secrets) {
          return options.secrets[key];
        }
        return `secret-value-for-${key}`;
      });

  const credentialsGet = options.credentialsError
    ? vi.fn(async () => {
        throw options.credentialsError;
      })
    : vi.fn(async (id: string) => {
        if (options.credentials && id in options.credentials) {
          return options.credentials[id];
        }
        return {};
      });

  return {
    signal,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    secrets: {
      get: secretsGet,
    },
    credentials: {
      get: credentialsGet,
    },
    state: createMockState(options.state, options.stateError),
  };
}

/**
 * A tiny in-memory stand-in for the four state roles. Seeds are copied rather
 * than referenced, so a test that writes cannot leak into the next one.
 */
function createMockState(seed: MockStateSeed = {}, error?: Error): MockState {
  const mappings = new Map<string, Map<string, string>>();
  const cursors = new Map<string, Map<string, unknown>>();
  const claims = new Map<string, Set<string>>();
  const digests = new Map<string, Map<string, string>>();

  for (const [namespace, pairs] of Object.entries(seed.mappings ?? {})) {
    mappings.set(namespace, new Map(Object.entries(pairs)));
  }
  for (const [namespace, partitions] of Object.entries(seed.cursors ?? {})) {
    cursors.set(namespace, new Map(Object.entries(partitions)));
  }
  for (const [namespace, keys] of Object.entries(seed.claims ?? {})) {
    claims.set(namespace, new Set(keys));
  }
  for (const [namespace, entries] of Object.entries(seed.digests ?? {})) {
    digests.set(namespace, new Map(Object.entries(entries)));
  }

  /** Wraps an operation so `stateError` short-circuits every one of them. */
  const op = <A extends unknown[], R>(fn: (...args: A) => R) =>
    vi.fn(async (...args: A): Promise<R> => {
      if (error) {
        throw error;
      }
      return fn(...args);
    });

  return {
    mapping: {
      get: op((namespace: string, key: string, side: 'left' | 'right' = 'left') => {
        const pairs = mappings.get(namespace);
        if (!pairs) {
          return null;
        }
        if (side === 'left') {
          return pairs.get(key) ?? null;
        }
        for (const [left, right] of pairs) {
          if (right === key) {
            return left;
          }
        }
        return null;
      }),
      put: op((namespace: string, left: string, right: string) => {
        const pairs = mappings.get(namespace) ?? new Map<string, string>();
        pairs.set(left, right);
        mappings.set(namespace, pairs);
      }),
    },
    cursor: {
      get: op((namespace: string, partitionKey = '') => cursors.get(namespace)?.get(partitionKey)),
      set: op((namespace: string, value: unknown, partitionKey = '') => {
        const partitions = cursors.get(namespace) ?? new Map<string, unknown>();
        partitions.set(partitionKey, value);
        cursors.set(namespace, partitions);
      }),
    },
    // First caller wins, like the real claim — so a test can drive both the
    // fresh and the duplicate path without reconfiguring the mock.
    claim: op((namespace: string, key: string) => {
      const held = claims.get(namespace) ?? new Set<string>();
      if (held.has(key)) {
        return false;
      }
      held.add(key);
      claims.set(namespace, held);
      return true;
    }),
    digest: {
      unchanged: op((namespace: string, entityKey: string, digest: string) => digests.get(namespace)?.get(entityKey) === digest),
      set: op((namespace: string, entityKey: string, digest: string) => {
        const entries = digests.get(namespace) ?? new Map<string, string>();
        entries.set(entityKey, digest);
        digests.set(namespace, entries);
      }),
    },
  };
}
