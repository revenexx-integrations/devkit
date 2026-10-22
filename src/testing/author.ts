import type { INodeAuthorContext } from '@revenexx/integrations-node-sdk';
import { vi } from 'vitest';
import type { AnyFn, AnyMock } from './mock.js';

/**
 * Builds an {@link INodeAuthorContext} for unit-testing a node's *author-time*
 * resolvers (`loadOptions`, `resolveConfigSchema`, `resolveOutputs`). Until this
 * package existed, this factory was reinvented inline in each repo's resolver
 * tests. Mirrors {@link createMockContext}: `secrets.get` / `credentials.get`
 * are `vi.fn<AnyFn>()`-backed and seedable.
 */

export type MockAuthorLogger = {
  info: AnyMock;
  warn: AnyMock;
  error: AnyMock;
};

export type MockAuthorContext = INodeAuthorContext & {
  logger: MockAuthorLogger;
  secrets: { get: AnyMock };
  credentials: { get: AnyMock };
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
    ? vi.fn<AnyFn>(async () => {
        throw options.secretsError;
      })
    : vi.fn<AnyFn>(async (key: string) => {
        if (options.secrets && key in options.secrets) {
          return options.secrets[key];
        }
        return `secret-value-for-${key}`;
      });

  const credentialsGet = options.credentialsError
    ? vi.fn<AnyFn>(async () => {
        throw options.credentialsError;
      })
    : vi.fn<AnyFn>(async (id: string) => {
        if (options.credentials && id in options.credentials) {
          return options.credentials[id];
        }
        return {};
      });

  return {
    signal,
    logger: {
      info: vi.fn<AnyFn>(),
      warn: vi.fn<AnyFn>(),
      error: vi.fn<AnyFn>(),
    },
    config,
    secrets: { get: secretsGet },
    credentials: { get: credentialsGet },
    locale: options.locale,
  };
}
