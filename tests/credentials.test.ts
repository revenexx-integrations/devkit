import type { ICredential, ICredentialContext, ICredentialOAuthAuthorize, ICredentialResolveResult, ICredentialTestResult } from '@revenexx/integrations-node-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeTokenEndpoint, runCredentialResolve, runCredentialTest, runOAuthAuthorizeUrl, runOAuthExchangeCode, stubFetch } from '../src/testing/index.js';

let active: { restore(): void } | undefined;
afterEach(() => {
  active?.restore();
  active = undefined;
});

/**
 * A minimal 3-legged-OAuth-shaped credential that exercises every seam the
 * harness wires: `fetch` for the token endpoint, `ctx.persistDurableCreds` for
 * rotation, and the OAuth authorize/exchange methods.
 */
class FakeOAuthCredential implements ICredential, ICredentialOAuthAuthorize {
  description = {
    slug: 'test:fake-oauth',
    version: '1.0.0',
    name: 'Fake OAuth',
    authKind: 'oauth2-authcode' as const,
    fields: [],
  };

  async test(_ctx: ICredentialContext, config: Record<string, unknown>): Promise<ICredentialTestResult> {
    return { ok: typeof config.clientId === 'string' && config.clientId.length > 0 };
  }

  async resolve(ctx: ICredentialContext, config: Record<string, unknown>, durableCreds: Record<string, unknown> | null): Promise<ICredentialResolveResult> {
    const res = await fetch(String(config.tokenUrl), { method: 'POST' });
    const body = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    if (body.refresh_token && body.refresh_token !== durableCreds?.refreshToken) {
      await ctx.persistDurableCreds?.({ refreshToken: body.refresh_token });
    }
    return {
      credentials: { accessToken: body.access_token, tokenType: 'Bearer' },
      expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
    };
  }

  async buildAuthorizeUrl(_ctx: ICredentialContext, config: Record<string, unknown>, params: { redirectUri: string; state: string }): Promise<{ authorizeUrl: string; codeVerifier?: string }> {
    const url = new URL('https://provider.test/authorize');
    url.searchParams.set('client_id', String(config.clientId));
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    return { authorizeUrl: url.href, codeVerifier: 'verifier-123' };
  }

  async exchangeCode(
    _ctx: ICredentialContext,
    _config: Record<string, unknown>,
    params: { code: string; redirectUri: string; codeVerifier?: string },
  ): Promise<{ durableCreds: Record<string, unknown> }> {
    return { durableCreds: { refreshToken: `refresh-for-${params.code}` } };
  }
}

describe('runCredentialTest', () => {
  it('runs the credential test against the given config', async () => {
    const cred = new FakeOAuthCredential();
    await expect(runCredentialTest(cred, { config: { clientId: 'abc' } })).resolves.toEqual({ ok: true });
    await expect(runCredentialTest(cred, { config: {} })).resolves.toEqual({ ok: false });
  });
});

describe('runCredentialResolve', () => {
  it('resolves access data through the stubbed token endpoint', async () => {
    active = stubFetch(fakeTokenEndpoint({ accessToken: 'AT-1', expiresIn: 120 }));
    const cred = new FakeOAuthCredential();

    const { result } = await runCredentialResolve(cred, { config: { tokenUrl: 'https://p.test/token' } });

    expect(result.credentials).toEqual({ accessToken: 'AT-1', tokenType: 'Bearer' });
    expect(typeof result.expiresAt).toBe('string');
  });

  it('captures refresh-token rotation via the persistDurableCreds spy', async () => {
    active = stubFetch(fakeTokenEndpoint({ accessToken: 'AT-2', refreshToken: 'RT-new' }));
    const cred = new FakeOAuthCredential();

    const { persistDurableCreds } = await runCredentialResolve(cred, {
      config: { tokenUrl: 'https://p.test/token' },
      durableCreds: { refreshToken: 'RT-old' },
    });

    expect(persistDurableCreds).toHaveBeenCalledWith({ refreshToken: 'RT-new' });
  });

  it('does not rotate when the refresh token is unchanged', async () => {
    active = stubFetch(fakeTokenEndpoint({ accessToken: 'AT-3', refreshToken: 'RT-same' }));
    const cred = new FakeOAuthCredential();

    const { persistDurableCreds } = await runCredentialResolve(cred, {
      config: { tokenUrl: 'https://p.test/token' },
      durableCreds: { refreshToken: 'RT-same' },
    });

    expect(persistDurableCreds).not.toHaveBeenCalled();
  });
});

describe('OAuth helpers', () => {
  it('builds an authorize url and exchanges a code', async () => {
    const cred = new FakeOAuthCredential();

    const { authorizeUrl, codeVerifier } = await runOAuthAuthorizeUrl(cred, {
      config: { clientId: 'cid' },
      redirectUri: 'https://app.test/cb',
      state: 'st',
    });
    expect(authorizeUrl).toContain('client_id=cid');
    expect(codeVerifier).toBe('verifier-123');

    const { durableCreds } = await runOAuthExchangeCode(cred, {
      config: { clientId: 'cid' },
      code: 'AUTHCODE',
      redirectUri: 'https://app.test/cb',
      codeVerifier,
    });
    expect(durableCreds).toEqual({ refreshToken: 'refresh-for-AUTHCODE' });
  });

  it('throws for a non-OAuth credential', async () => {
    const notOauth: ICredential = {
      description: { slug: 'test:static', version: '1.0.0', name: 'S', authKind: 'static', fields: [] },
      async test() {
        return { ok: true };
      },
      async resolve() {
        return { credentials: {} };
      },
    };
    await expect(runOAuthAuthorizeUrl(notOauth, { config: {}, redirectUri: 'x', state: 'y' })).rejects.toThrow('not a 3-legged OAuth credential');
  });
});
