import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import { isIP } from 'node:net';
import { safeFetch } from '@revenexx/integrations-node-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeTokenEndpoint, STUB_DNS_ADDRESS, STUB_DNS_ADDRESS_V6, stubFetch } from '../src/testing/index.js';

let active: ReturnType<typeof stubFetch> | undefined;

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

describe('stubFetch and DNS', () => {
  const realLookup = dns.promises.lookup;

  /**
   * Every lookup but localhost and an IP literal fails, as on a runner with no DNS —
   * the preload from PO-745. A plain function rather than a `vi.fn`, because
   * `stubFetch` leaves a lookup that is already a mock alone; `calls` records the hosts.
   */
  function blockDns(): { lookup: typeof dns.promises.lookup; calls: string[] } {
    const calls: string[] = [];
    const lookup = (async (hostname: string) => {
      calls.push(hostname);
      // Answered without asking anybody, so the test holds on a runner with no DNS at all.
      if (hostname === 'localhost' || isIP(hostname) !== 0) return { address: isIP(hostname) ? hostname : '127.0.0.1', family: 4 };
      throw Object.assign(new Error('DNS blocked'), { code: 'ENOTFOUND' });
    }) as unknown as typeof dns.promises.lookup;
    dns.promises.lookup = lookup;
    syncBuiltinESMExports();
    return { lookup, calls };
  }

  afterEach(() => {
    dns.promises.lookup = realLookup;
    syncBuiltinESMExports();
  });

  it('lets a request through safeFetch reach the stub with DNS blocked', async () => {
    const blocked = blockDns();
    active = stubFetch({ json: { ok: true } });

    const res = await safeFetch('https://api.vendor.example/v1/things');
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(blocked.calls).toEqual([]);
  });

  it('answers the ESM namespace an import of node:dns/promises reads', async () => {
    active = stubFetch({ json: {} });
    const { lookup } = await import('node:dns/promises');

    await expect(lookup('api.vendor.example', { all: true })).resolves.toEqual([{ address: STUB_DNS_ADDRESS, family: 4 }]);
    await expect(lookup('api.vendor.example')).resolves.toEqual({ address: STUB_DNS_ADDRESS, family: 4 });
  });

  it('leaves localhost and an IP literal to the real lookup', async () => {
    const blocked = blockDns();
    active = stubFetch({ json: {} });

    await dns.promises.lookup('localhost');
    await dns.promises.lookup('127.0.0.1');
    expect(blocked.calls).toEqual(['localhost', '127.0.0.1']);
  });

  it('calls the real lookup with { dns: false }', async () => {
    const blocked = blockDns();
    active = stubFetch({ json: {} }, { dns: false });

    await expect(safeFetch('https://api.vendor.example/v1/things')).rejects.toThrow('DNS blocked');
    expect(active.fetchMock).not.toHaveBeenCalled();
    expect(blocked.calls).toEqual(['api.vendor.example']);
  });

  it('puts the previous lookup back on restore', async () => {
    const blocked = blockDns();
    const stub = stubFetch({ json: {} });
    expect(dns.promises.lookup).not.toBe(blocked.lookup);

    stub.restore();
    expect(dns.promises.lookup).toBe(blocked.lookup);
    const { lookup } = await import('node:dns/promises');
    expect(lookup).toBe(blocked.lookup);
  });

  it('puts the previous lookup back whatever order two stubs are restored in', () => {
    const blocked = blockDns();
    const first = stubFetch({ json: {} });
    const second = stubFetch({ json: {} });

    first.restore();
    expect(dns.promises.lookup).not.toBe(blocked.lookup);
    second.restore();
    expect(dns.promises.lookup).toBe(blocked.lookup);
  });

  it('leaves a lookup the test already mocked in place', async () => {
    const mocked = vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '10.0.0.7', family: 4 }] as never);
    syncBuiltinESMExports();
    active = stubFetch({ json: {} });

    expect(dns.promises.lookup).toBe(mocked);
    await expect(safeFetch('https://internal.vendor.example/x')).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    expect(active.fetchMock).not.toHaveBeenCalled();
    mocked.mockRestore();
  });

  it('answers a lookup that asks for IPv6 only with a public IPv6 address', async () => {
    active = stubFetch({ json: {} });

    await expect(dns.promises.lookup('api.vendor.example', { family: 6, all: true })).resolves.toEqual([{ address: STUB_DNS_ADDRESS_V6, family: 6 }]);
    await expect(dns.promises.lookup('api.vendor.example', 6)).resolves.toEqual({ address: STUB_DNS_ADDRESS_V6, family: 6 });
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
