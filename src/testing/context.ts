import type { INodeContext } from '@revenexx/integrations-node-sdk';
import { vi } from 'vitest';
import { assertNotRepointed, assertTtlInRange } from '../state-rules.js';

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
 *
 * It reads back *when the store would let it*, which is not the same for all
 * four roles (SDK 1.0.0, `specs/workflow-state.md`): a mapping and a claim take
 * effect immediately, a cursor and a digest are staged and adopted only once the
 * run completes. So `cursor.get` after `cursor.set` still answers what the last
 * completed run left — call {@link MockContext.completeRun} between two
 * `execute` calls to play the second run, and leave it uncalled to play the run
 * that failed and left the watermark where it was.
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
  /**
   * Adopts what this run staged — the cursors and digests it set — the way the
   * engine does when a run completes. Not part of {@link INodeContext}: it is
   * the harness standing in for the run's own ending, and a node can never call
   * it. A test that never calls it has played a run that did not complete.
   */
  completeRun: () => void;
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
  const { state, completeRun } = createMockState(options.state, options.stateError);

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
    state,
    completeRun,
  };
}

/**
 * A tiny in-memory stand-in for the four state roles. Seeds are copied rather
 * than referenced, so a test that writes cannot leak into the next one.
 *
 * The write calls split the way the store does. A mapping and a claim land in
 * the committed maps at once; a cursor and a digest land in a staging map that
 * only `completeRun` folds in, so a read during the run answers what the last
 * completed one left. That is the whole reason there are four operations rather
 * than a generic get/set, and a mock that adopted everything immediately would
 * hide the case the rule exists for: the run that fails after advancing its
 * watermark.
 */
function createMockState(seed: MockStateSeed = {}, error?: Error): { state: MockState; completeRun: () => void } {
  const mappings = new Map<string, Map<string, string>>();
  const cursors = new Map<string, Map<string, unknown>>();
  const claims = new Map<string, Set<string>>();
  const digests = new Map<string, Map<string, string>>();
  /** What this run has staged: adopted by `completeRun`, dropped otherwise. */
  const stagedCursors = new Map<string, Map<string, unknown>>();
  const stagedDigests = new Map<string, Map<string, string>>();

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

  const state: MockState = {
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
        assertNotRepointed(namespace, pairs, left, right);
        pairs.set(left, right);
        mappings.set(namespace, pairs);
      }),
    },
    cursor: {
      // The committed watermark: what *this* run staged is deliberately not in
      // the answer, exactly as the real store describes it.
      get: op((namespace: string, partitionKey = '') => cursors.get(namespace)?.get(partitionKey)),
      set: op((namespace: string, value: unknown, partitionKey = '') => {
        const partitions = stagedCursors.get(namespace) ?? new Map<string, unknown>();
        partitions.set(partitionKey, value);
        stagedCursors.set(namespace, partitions);
      }),
    },
    // First caller wins, like the real claim — so a test can drive both the
    // fresh and the duplicate path without reconfiguring the mock. A claim is
    // never handed on here: a TTL is a wall-clock window, and no unit test
    // outlives the shortest one the store accepts.
    claim: op((namespace: string, key: string, opts?: { ttlSeconds?: number }) => {
      assertTtlInRange(opts?.ttlSeconds);
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
        const entries = stagedDigests.get(namespace) ?? new Map<string, string>();
        entries.set(entityKey, digest);
        stagedDigests.set(namespace, entries);
      }),
    },
  };

  const completeRun = (): void => {
    for (const [namespace, partitions] of stagedCursors) {
      const committed = cursors.get(namespace) ?? new Map<string, unknown>();
      for (const [partitionKey, value] of partitions) {
        committed.set(partitionKey, value);
      }
      cursors.set(namespace, committed);
    }
    for (const [namespace, entries] of stagedDigests) {
      const committed = digests.get(namespace) ?? new Map<string, string>();
      for (const [entityKey, digest] of entries) {
        committed.set(entityKey, digest);
      }
      digests.set(namespace, committed);
    }
    stagedCursors.clear();
    stagedDigests.clear();
  };

  return { state, completeRun };
}
