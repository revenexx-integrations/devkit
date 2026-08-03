import type { INodeAuthorContext } from '@revenexx/integrations-node-sdk';
import { vi } from 'vitest';

/**
 * Builds an {@link INodeAuthorContext} for unit-testing a node's *author-time*
 * resolvers (`loadOptions`, `resolveConfigSchema`, `resolveOutputs`). Until this
 * package existed, this factory was reinvented inline in each repo's resolver
 * tests. Mirrors {@link createMockContext}: `secrets.get` / `credentials.get`
 * are `vi.fn()`-backed and seedable.
 */

export type MockAuthorLogger = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

export type MockAuthorContext = INodeAuthorContext & {
  logger: MockAuthorLogger;
  secrets: { get: ReturnType<typeof vi.fn> };
  credentials: { get: ReturnType<typeof vi.fn> };
};

export interface CreateAuthorContextOptions {
  signal?: AbortSignal;
  /** Preferred locale for resolved labels. */
  locale?: string;
  secrets?: Record<string, string>;
  secretsError?: Error;
  credentials?: Record<string, Record<string, unknown>>;
  credentialsError?: Error;
}

export function createAuthorContext(config: Record<string, unknown> = {}, options: CreateAuthorContextOptions = {}): MockAuthorContext {
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
    config,
    secrets: { get: secretsGet },
    credentials: { get: credentialsGet },
    locale: options.locale,
  };
}
