import type { ICredential, ICredentialContext, ICredentialResolveResult, ICredentialTestResult } from '@revenexx/integrations-node-sdk';
import { isOAuthAuthorizeCredential } from '@revenexx/integrations-node-sdk';
import { vi } from 'vitest';

/**
 * Harness for unit-testing a credential type's `test` / `resolve` / 3-legged
 * OAuth without the credentials broker or a real provider. Combine with
 * {@link stubFetch} / {@link fakeTokenEndpoint} to drive the token endpoint,
 * and inspect the returned `persistDurableCreds` spy to assert refresh-token
 * rotation.
 */

export type MockCredentialLogger = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

export type MockCredentialContext = ICredentialContext & {
  logger: MockCredentialLogger;
  /** Spy wired to `ctx.persistDurableCreds`; assert `.toHaveBeenCalledWith(...)`. */
  persistDurableCreds: ReturnType<typeof vi.fn>;
};

export interface CreateCredentialContextOptions {
  signal?: AbortSignal;
}

export function createCredentialContext(options: CreateCredentialContextOptions = {}): MockCredentialContext {
  const signal = options.signal ?? new AbortController().signal;
  const persistDurableCreds = vi.fn(async (_durableCreds: Record<string, unknown>) => {});
  return {
    signal,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    persistDurableCreds,
  };
}

export interface RunCredentialTestOptions {
  config: Record<string, unknown>;
  signal?: AbortSignal;
}

/** Runs a credential's `test(ctx, config)` and returns its result. */
export async function runCredentialTest(credential: ICredential, options: RunCredentialTestOptions): Promise<ICredentialTestResult> {
  const ctx = createCredentialContext({ signal: options.signal });
  return credential.test(ctx, options.config);
}

export interface RunCredentialResolveOptions {
  config: Record<string, unknown>;
  /** System-managed long-lived secrets (e.g. an OAuth `refresh_token`). */
  durableCreds?: Record<string, unknown> | null;
  signal?: AbortSignal;
}

export interface RunCredentialResolveResult {
  result: ICredentialResolveResult;
  /** Spy wired to `ctx.persistDurableCreds` — assert rotation happened. */
  persistDurableCreds: ReturnType<typeof vi.fn>;
  /** The context used, for further assertions (logger calls, etc.). */
  ctx: MockCredentialContext;
}

/** Runs a credential's `resolve(ctx, config, durableCreds)` and captures rotation. */
export async function runCredentialResolve(credential: ICredential, options: RunCredentialResolveOptions): Promise<RunCredentialResolveResult> {
  const ctx = createCredentialContext({ signal: options.signal });
  const result = await credential.resolve(ctx, options.config, options.durableCreds ?? null);
  return { result, persistDurableCreds: ctx.persistDurableCreds, ctx };
}

export interface RunOAuthAuthorizeUrlOptions {
  config: Record<string, unknown>;
  redirectUri: string;
  state: string;
  signal?: AbortSignal;
}

/** Runs `buildAuthorizeUrl` on a 3-legged OAuth credential; throws if unsupported. */
export async function runOAuthAuthorizeUrl(credential: ICredential, options: RunOAuthAuthorizeUrlOptions): Promise<{ authorizeUrl: string; codeVerifier?: string }> {
  if (!isOAuthAuthorizeCredential(credential)) {
    throw new Error(`${credential.description.slug} is not a 3-legged OAuth credential`);
  }
  const ctx = createCredentialContext({ signal: options.signal });
  return credential.buildAuthorizeUrl(ctx, options.config, {
    redirectUri: options.redirectUri,
    state: options.state,
  });
}

export interface RunOAuthExchangeCodeOptions {
  config: Record<string, unknown>;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  signal?: AbortSignal;
}

/** Runs `exchangeCode` on a 3-legged OAuth credential; throws if unsupported. */
export async function runOAuthExchangeCode(credential: ICredential, options: RunOAuthExchangeCodeOptions): Promise<{ durableCreds: Record<string, unknown> }> {
  if (!isOAuthAuthorizeCredential(credential)) {
    throw new Error(`${credential.description.slug} is not a 3-legged OAuth credential`);
  }
  const ctx = createCredentialContext({ signal: options.signal });
  return credential.exchangeCode(ctx, options.config, {
    code: options.code,
    redirectUri: options.redirectUri,
    codeVerifier: options.codeVerifier,
  });
}
