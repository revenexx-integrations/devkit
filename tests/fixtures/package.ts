import type {
  IConfigField,
  IConfigOption,
  ICredential,
  ICredentialContext,
  ICredentialOAuthAuthorize,
  ICredentialResolveResult,
  ICredentialTestResult,
  INode,
  INodeAuthorContext,
  INodeContext,
  INodeResult,
  IOutputPort,
  ITemplateDescription,
} from '@revenexx/integrations-node-sdk';

/**
 * The shared fixture package the server tests run the mock against: one node
 * exercising every author-time resolver, one static credential type, and one
 * template. Both tests/server.test.ts and tests/contract.test.ts mount it, so the
 * contract test exercises the same surface the behavioural tests do.
 */

/** A node exercising all three author-time resolvers + a secret-ref field. */
export class PlaygroundNode implements INode {
  description = {
    slug: 'devkit:playground',
    version: '1.0.0',
    category: 'action' as const,
    name: 'Playground',
    inputs: {},
    outputs: [{ kind: 'branch' as const, dataType: 'any' as const, resolveOutputs: true }],
    config: [
      { key: 'category', label: 'Category', type: 'select' as const, dynamic: true },
      { key: 'params', label: 'Params', type: 'dynamic-schema' as const, dependsOn: ['category'] },
      { key: 'secretName', label: 'Secret', type: 'secret-ref' as const },
    ],
  };

  /**
   * Echoes what it was given and logs once, so `POST …/execute:test` has an
   * observable `outputs` / `branch` / `logs` triple to assert against. Throws on
   * `{ boom: true }` so the failure path can be tested too.
   *
   * `{ hang: true }` stalls forever and deliberately never consults `ctx.signal` —
   * that is the case an abort-only timeout cannot rescue, and the reason the
   * timeout is enforced by racing.
   */
  async execute(ctx: INodeContext, inputs: Record<string, unknown>): Promise<INodeResult> {
    ctx.logger.info('executing playground', { keys: Object.keys(inputs) });
    if (inputs.boom) {
      throw new Error('boom');
    }
    if (inputs.hang) {
      await new Promise(() => {});
    }
    return { outputs: { echoed: inputs }, branch: 'matched' };
  }

  async loadOptions(ctx: INodeAuthorContext, fieldKey: string): Promise<IConfigOption[]> {
    if (fieldKey !== 'category') {
      return [];
    }
    // Prove secret plumbing when a secret-ref is set.
    const suffix = ctx.config.secretName ? await ctx.secrets.get(String(ctx.config.secretName)) : '';
    return [
      { value: 'orders', label: `Orders${suffix ? ` (${suffix})` : ''}` },
      { value: 'customers', label: 'Customers' },
    ];
  }

  async resolveConfigSchema(ctx: INodeAuthorContext): Promise<IConfigField[]> {
    return [{ key: `${ctx.config.category ?? 'none'}_id`, label: 'Id', type: 'string', required: true }];
  }

  async resolveOutputs(_ctx: INodeAuthorContext): Promise<IOutputPort[]> {
    return [
      { kind: 'branch', dataType: 'any', name: 'matched' },
      { kind: 'branch', dataType: 'any', name: 'default' },
    ];
  }
}

export class StaticCredential implements ICredential {
  description = {
    slug: 'devkit:basic',
    version: '1.0.0',
    name: 'Basic',
    authKind: 'static' as const,
    fields: [
      { key: 'host', label: 'Host', type: 'string' as const },
      { key: 'password', label: 'Password', type: 'secret' as const },
    ],
  };

  async test(_ctx: ICredentialContext, config: Record<string, unknown>): Promise<ICredentialTestResult> {
    return { ok: typeof config.host === 'string' && config.host.length > 0 };
  }

  async resolve(_ctx: ICredentialContext, config: Record<string, unknown>): Promise<ICredentialResolveResult> {
    return { credentials: { ...config } };
  }
}

/**
 * A 3-legged OAuth credential type, so the `/oauth/authorize-url` and
 * `/credentials/oauth/callback` routes have a type that can reach their success
 * path — a static type correctly 422s on both.
 */
export class OAuthCredential implements ICredential, ICredentialOAuthAuthorize {
  description = {
    slug: 'devkit:oauth',
    version: '1.0.0',
    name: 'OAuth',
    authKind: 'oauth2-authcode' as const,
    fields: [
      { key: 'clientId', label: 'Client id', type: 'string' as const },
      { key: 'clientSecret', label: 'Client secret', type: 'secret' as const },
    ],
  };

  async test(_ctx: ICredentialContext): Promise<ICredentialTestResult> {
    return { ok: true };
  }

  async resolve(_ctx: ICredentialContext, _config: Record<string, unknown>, durableCreds?: Record<string, unknown> | null): Promise<ICredentialResolveResult> {
    return { credentials: { accessToken: String(durableCreds?.accessToken ?? 'AT') } };
  }

  async buildAuthorizeUrl(_ctx: ICredentialContext, config: Record<string, unknown>, params: { redirectUri: string; state: string }): Promise<{ authorizeUrl: string; codeVerifier?: string }> {
    const url = new URL('https://oauth.devkit.test/authorize');
    url.searchParams.set('client_id', String(config.clientId ?? ''));
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    return { authorizeUrl: url.toString() };
  }

  async exchangeCode(
    _ctx: ICredentialContext,
    _config: Record<string, unknown>,
    params: { code: string; redirectUri: string; codeVerifier?: string },
  ): Promise<{ durableCreds: Record<string, unknown> }> {
    return { durableCreds: { accessToken: `AT-${params.code}`, refreshToken: 'RT' } };
  }
}

export const template: ITemplateDescription = {
  slug: 'devkit:starter',
  version: '1.0.0',
  category: 'sales',
  level: 'beginner',
  name: 'Starter',
  blobVersion: 'v0-draft',
  definition: { nodes: [], edges: [] },
  triggers: [{ handle: 'trig-1', type: 'manual' }],
};
