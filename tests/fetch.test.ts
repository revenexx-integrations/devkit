import { afterEach, describe, expect, it } from 'vitest';
import { fakeTokenEndpoint, stubFetch } from '../src/testing/index.js';

let active: { restore(): void } | undefined;

afterEach(() => {
  active?.restore();
  active = undefined;
});

describe('stubFetch', () => {
  it('serves a JSON body as a real Response', async () => {
    active = stubFetch({ status: 201, json: { ok: true } });

    const res = await fetch('https://example.test/thing', { method: 'POST' });
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('branches on url/method via a handler and records calls', async () => {
    const stub = stubFetch(({ url, method }) => (method === 'GET' && url.endsWith('/health') ? { status: 200, body: 'ok' } : { status: 404, json: { error: 'nope' } }));
    active = stub;

    const good = await fetch('https://x.test/health');
    expect(good.status).toBe(200);
    await expect(good.text()).resolves.toBe('ok');

    const bad = await fetch('https://x.test/other', { method: 'POST' });
    expect(bad.status).toBe(404);

    expect(stub.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('restores the previous global fetch', () => {
    const original = globalThis.fetch;
    const stub = stubFetch({ json: {} });
    expect(globalThis.fetch).not.toBe(original);
    stub.restore();
    expect(globalThis.fetch).toBe(original);
  });
});

describe('fakeTokenEndpoint', () => {
  it('returns an OAuth token body with refresh token when requested', async () => {
    active = stubFetch(fakeTokenEndpoint({ accessToken: 'AT', refreshToken: 'RT', expiresIn: 60 }));
    const res = await fetch('https://provider.test/token', { method: 'POST' });
    await expect(res.json()).resolves.toEqual({
      access_token: 'AT',
      token_type: 'Bearer',
      expires_in: 60,
      refresh_token: 'RT',
    });
  });

  it('404s requests to a non-matching url when tokenUrl is pinned', async () => {
    active = stubFetch(fakeTokenEndpoint({ tokenUrl: 'https://provider.test/token' }));
    const res = await fetch('https://provider.test/other');
    expect(res.status).toBe(404);
  });
});
