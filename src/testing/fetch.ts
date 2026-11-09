import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import { isIP } from 'node:net';
import { vi } from 'vitest';
import type { AnyFn, AnyMock } from './mock.js';

/**
 * Utilities for stubbing the global `fetch` so a credential's `resolve` /
 * `test` (which reach an OAuth token endpoint via the SDK's `postForm`) or a
 * node's `execute` (which uses `safeFetch` → global `fetch`) can be
 * unit-tested without touching the network. Builds real `Response` objects so
 * `res.ok` / `res.status` / `res.text()` / `res.json()` all behave exactly as
 * in production.
 */

export interface StubResponseInit {
  status?: number;
  headers?: Record<string, string>;
  /** JSON body — serialized and served as `application/json` unless `body` is set. */
  json?: unknown;
  /** Raw string body. Takes precedence over `json`. */
  body?: string;
}

export interface StubbedRequest {
  url: string;
  method: string;
  init?: RequestInit;
}

export type FetchHandler = (request: StubbedRequest) => StubResponseInit | Response | Promise<StubResponseInit | Response>;

/** Builds a real `Response` from a {@link StubResponseInit}. */
export function buildResponse(init: StubResponseInit): Response {
  const headers = new Headers(init.headers ?? {});
  let body: string | undefined;
  if (init.body !== undefined) {
    body = init.body;
  } else if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }
  return new Response(body, { status: init.status ?? 200, headers });
}

export interface StubFetchOptions {
  /**
   * Answer DNS too, while the stub is active (default `true`). The SDK's
   * `safeFetch` resolves a request's host through `node:dns/promises` before it
   * calls `fetch`, to refuse private addresses — so without this, a test whose
   * `fetch` is stubbed still asks real DNS, and fails offline or on a slow
   * resolver. With it, every host but `localhost` and an IP literal resolves to
   * {@link STUB_DNS_ADDRESS}, a public address, so the guard lets the request
   * through to the stub.
   *
   * Pass `false` for a test that checks real resolution, or that installs its
   * own `lookup` to make a host resolve to a private address.
   */
  dns?: boolean;
}

export interface StubFetchResult {
  /** The `vi.fn<AnyFn>()` installed as `globalThis.fetch` — assert calls on it. */
  fetchMock: AnyMock;
  /** Restores the previous `globalThis.fetch`, and the previous DNS `lookup` where it was replaced. */
  restore(): void;
}

/**
 * The address every host but `localhost` and an IP literal resolves to while
 * {@link stubFetch} answers DNS. Public, so the SDK's SSRF guard lets it through.
 */
export const STUB_DNS_ADDRESS = '93.184.215.14';

type PromisesLookup = typeof dns.promises.lookup;

/**
 * Replaces `lookup` on `node:dns/promises` — the object `require` hands out and,
 * after `syncBuiltinESMExports()`, the ESM namespace an `import()` of it reads —
 * and returns the function that puts the previous one back.
 */
function stubDnsLookup(): () => void {
  const previous = dns.promises.lookup;
  const stubbed = ((hostname: string, options?: unknown) => {
    if (hostname === 'localhost' || isIP(hostname) !== 0) {
      return (previous as (h: string, o?: unknown) => Promise<unknown>)(hostname, options);
    }
    const address = { address: STUB_DNS_ADDRESS, family: 4 };
    const all = typeof options === 'object' && options !== null && (options as { all?: unknown }).all === true;
    return Promise.resolve(all ? [address] : address);
  }) as PromisesLookup;
  dns.promises.lookup = stubbed;
  syncBuiltinESMExports();
  return () => {
    // Only undo our own replacement: a lookup somebody installed after this one
    // is theirs to restore.
    if (dns.promises.lookup === stubbed) {
      dns.promises.lookup = previous;
      syncBuiltinESMExports();
    }
  };
}

/**
 * Replaces `globalThis.fetch` with a `vi.fn<AnyFn>()` driven by `handler`. Pass a
 * static {@link StubResponseInit} to answer every request identically, or a
 * {@link FetchHandler} to branch on url/method. Unless `options.dns` is `false`,
 * it answers DNS as well (see {@link StubFetchOptions.dns}), so a request through
 * the SDK's `safeFetch` never reaches the network. Call `restore()` when done
 * (e.g. in `afterEach`).
 */
export function stubFetch(handler: FetchHandler | StubResponseInit, options: StubFetchOptions = {}): StubFetchResult {
  const previous = globalThis.fetch;
  const restoreDns = options.dns === false ? () => {} : stubDnsLookup();
  const resolveInit: FetchHandler = typeof handler === 'function' ? handler : () => handler;

  const fetchMock = vi.fn<AnyFn>(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const out = await resolveInit({ url, method, init });
    return out instanceof Response ? out : buildResponse(out);
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    fetchMock,
    restore() {
      globalThis.fetch = previous;
      restoreDns();
    },
  };
}

export interface FakeTokenEndpointOptions {
  /** Only answer requests to this exact URL; other requests 404. Omit to answer any URL. */
  tokenUrl?: string;
  accessToken?: string;
  tokenType?: string;
  /** Seconds until expiry (OAuth `expires_in`). Set `null` to omit the field. */
  expiresIn?: number | null;
  /** Included as `refresh_token` when set (e.g. to assert rotation). */
  refreshToken?: string;
  /** Extra fields merged into the token response body. */
  extra?: Record<string, unknown>;
}

/**
 * A {@link FetchHandler} that emulates an OAuth token endpoint, returning
 * `{ access_token, token_type, expires_in, refresh_token? }`. Compose with
 * {@link stubFetch} to unit-test `oauth2-*` credentials' `resolve` / OAuth
 * `exchangeCode`.
 */
export function fakeTokenEndpoint(options: FakeTokenEndpointOptions = {}): FetchHandler {
  const { tokenUrl, accessToken = 'fake-access-token', tokenType = 'Bearer', expiresIn = 3600, refreshToken, extra } = options;

  return ({ url }) => {
    if (tokenUrl && url !== tokenUrl) {
      return { status: 404, json: { error: `no stub for ${url}` } };
    }
    const json: Record<string, unknown> = {
      access_token: accessToken,
      token_type: tokenType,
      ...(expiresIn !== null ? { expires_in: expiresIn } : {}),
      ...(refreshToken !== undefined ? { refresh_token: refreshToken } : {}),
      ...extra,
    };
    return { status: 200, json };
  };
}
