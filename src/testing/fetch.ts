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
   * Pass `false` for a test that checks real resolution: this stub then takes
   * no hold on DNS (another active stub without it still keeps DNS stubbed until
   * it is restored). A `lookup` the test
   * already replaced on `node:dns/promises` with a vitest mock is left in place
   * either way, so a test that makes a host resolve to a private address keeps
   * its answer.
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
 * A lookup that asks for IPv6 only (`family: 6`) gets {@link STUB_DNS_ADDRESS_V6}.
 */
export const STUB_DNS_ADDRESS = '93.184.215.14';

/** The IPv6 counterpart of {@link STUB_DNS_ADDRESS}, also public. */
export const STUB_DNS_ADDRESS_V6 = '2606:2800:21f:cb07:6820:80da:af6b:8b2c';

type PromisesLookup = typeof dns.promises.lookup;

/**
 * The one DNS stub every active {@link stubFetch} shares, and how many of them
 * hold it. Counted rather than stacked, so restores in any order put the
 * original back once the last holder is gone.
 */
let sharedDnsStub: { original: PromisesLookup; stubbed: PromisesLookup; holders: number } | undefined;

function stubbedAnswer(options: unknown): { address: string; family: number } {
  const family = typeof options === 'number' ? options : typeof options === 'object' && options !== null ? (options as { family?: unknown }).family : undefined;
  return family === 6 || family === 'IPv6' ? { address: STUB_DNS_ADDRESS_V6, family: 6 } : { address: STUB_DNS_ADDRESS, family: 4 };
}

function setLookup(lookup: PromisesLookup): void {
  dns.promises.lookup = lookup;
  syncBuiltinESMExports();
}

/**
 * Replaces `lookup` on `node:dns/promises` — the object `require` hands out and,
 * after `syncBuiltinESMExports()`, the ESM namespace an `import()` of it reads —
 * and returns the function that releases this hold on it.
 *
 * A lookup that is already a vitest mock is left alone: the test installed it to
 * answer DNS itself, often with a private address, and stubbing over it would
 * quietly make the SSRF guard pass.
 */
function stubDnsLookup(): () => void {
  const current = dns.promises.lookup;
  if (sharedDnsStub !== undefined && current === sharedDnsStub.stubbed) {
    sharedDnsStub.holders += 1;
  } else if (vi.isMockFunction(current)) {
    return () => {};
  } else {
    const original = current;
    const stubbed = ((hostname: string, options?: unknown) => {
      if (hostname === 'localhost' || isIP(hostname) !== 0) {
        return (original as (h: string, o?: unknown) => Promise<unknown>)(hostname, options);
      }
      const address = stubbedAnswer(options);
      const all = typeof options === 'object' && options !== null && (options as { all?: unknown }).all === true;
      return Promise.resolve(all ? [address] : address);
    }) as PromisesLookup;
    sharedDnsStub = { original, stubbed, holders: 1 };
    setLookup(stubbed);
  }
  const held = sharedDnsStub;
  let released = false;
  return () => {
    if (released || held === undefined) return;
    released = true;
    held.holders -= 1;
    if (held.holders > 0) return;
    if (sharedDnsStub === held) sharedDnsStub = undefined;
    // Only undo our own replacement: a lookup somebody installed over it is
    // theirs to restore.
    if (dns.promises.lookup === held.stubbed) setLookup(held.original);
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
