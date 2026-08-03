import { vi } from 'vitest';

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

export interface StubFetchResult {
  /** The `vi.fn()` installed as `globalThis.fetch` — assert calls on it. */
  fetchMock: ReturnType<typeof vi.fn>;
  /** Restores the previous `globalThis.fetch`. */
  restore(): void;
}

/**
 * Replaces `globalThis.fetch` with a `vi.fn()` driven by `handler`. Pass a
 * static {@link StubResponseInit} to answer every request identically, or a
 * {@link FetchHandler} to branch on url/method. Call `restore()` when done
 * (e.g. in `afterEach`).
 */
export function stubFetch(handler: FetchHandler | StubResponseInit): StubFetchResult {
  const previous = globalThis.fetch;
  const resolveInit: FetchHandler = typeof handler === 'function' ? handler : () => handler;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
