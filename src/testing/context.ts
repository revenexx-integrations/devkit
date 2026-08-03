import type { INodeContext } from '@revenexx/integrations-node-sdk';
import { vi } from 'vitest';

/**
 * Drop-in replacement for the `createMockContext` helper that was, until this
 * package existed, copy-pasted byte-for-byte into every node repo's
 * `tests/helpers/context.ts`. Builds a full {@link INodeContext} with
 * `vi.fn()`-backed `logger`, `secrets.get`, and `credentials.get` so a node's
 * `execute` can be unit-tested in isolation.
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

export type MockContext = INodeContext & {
  logger: MockLogger;
  secrets: MockSecrets;
  credentials: MockCredentials;
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
  };
}
