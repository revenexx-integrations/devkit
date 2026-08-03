import type { AddressInfo } from 'node:net';
import type {
  IConfigField,
  IConfigOption,
  ICredential,
  ICredentialContext,
  ICredentialResolveResult,
  ICredentialTestResult,
  INode,
  INodeAuthorContext,
  INodeContext,
  INodeResult,
  IOutputPort,
  ITemplateDescription,
} from '@revenexx/integrations-node-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevServer, DevStore, resolveExports } from '../src/index.js';

/** A node exercising all three author-time resolvers + a secret-ref field. */
class PlaygroundNode implements INode {
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

  async execute(_ctx: INodeContext, _inputs: Record<string, unknown>): Promise<INodeResult> {
    return { outputs: {} };
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

class StaticCredential implements ICredential {
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

const template: ITemplateDescription = {
  slug: 'devkit:starter',
  version: '1.0.0',
  category: 'sales',
  level: 'beginner',
  name: 'Starter',
  blobVersion: 'v0-draft',
  definition: { nodes: [], edges: [] },
  triggers: [{ handle: 'trig-1', type: 'manual' }],
};

const loaded = resolveExports({
  NODES: [new PlaygroundNode()],
  CREDENTIALS: [new StaticCredential()],
  TEMPLATES: [template],
});

const store = new DevStore();
const server = createDevServer({
  getPackage: () => loaded,
  store,
  schemas: { node: { $id: 'node' }, 'node/v0-draft': { $id: 'node/v0-draft' } },
});

let base = '';

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}
async function send(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('nodes catalogue', () => {
  it('lists nodes with dynamic flags', async () => {
    const { status, body } = await get('/nodes');
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      slug: 'devkit:playground',
      namespace: 'devkit',
      version: '1.0.0',
      manifest_version: 'v0-draft',
      has_dynamic_options: true,
      has_dynamic_schema: true,
      has_dynamic_outputs: true,
    });
  });

  it('lists versions and fetches a single node', async () => {
    expect((await get('/nodes/devkit:playground/versions')).body).toEqual({ data: ['1.0.0'] });
    const single = await get('/nodes/devkit:playground/latest');
    expect(single.body.slug).toBe('devkit:playground');
  });
});

describe('config:resolve (in-process, real node code)', () => {
  it('resolves dynamic options for a field', async () => {
    const { status, body } = await send('POST', '/nodes/devkit:playground/1.0.0/config:resolve', {
      target: 'category',
      config: {},
    });
    expect(status).toBe(200);
    expect(body.options).toEqual([
      { value: 'orders', label: 'Orders' },
      { value: 'customers', label: 'Customers' },
    ]);
  });

  it('resolves a dynamic-schema field from the driving config', async () => {
    const { body } = await send('POST', '/nodes/devkit:playground/1.0.0/config:resolve', {
      target: 'params',
      config: { category: 'orders' },
    });
    expect(body.fields).toEqual([{ key: 'orders_id', label: 'Id', type: 'string', required: true }]);
  });

  it('resolves outputs and the "*" aggregate', async () => {
    const outputs = await send('POST', '/nodes/devkit:playground/1.0.0/config:resolve', { target: 'outputs', config: {} });
    expect(outputs.body.outputs.map((o: IOutputPort) => o.name)).toEqual(['matched', 'default']);

    const all = await send('POST', '/nodes/devkit:playground/1.0.0/config:resolve', { target: '*', config: { category: 'customers' } });
    expect(all.body.fields[0].key).toBe('customers_id');
    expect(all.body.outputs).toHaveLength(2);
  });

  it('422s a missing target', async () => {
    const { status, body } = await send('POST', '/nodes/devkit:playground/1.0.0/config:resolve', { config: {} });
    expect(status).toBe(422);
    expect(body.errors.target).toBeDefined();
  });
});

describe('credentials', () => {
  it('creates a credential and masks secret fields in public_config', async () => {
    const created = await send('POST', '/credentials', {
      credential_type_slug: 'devkit:basic',
      name: 'My basic',
      config: { host: 'mail.test', password: 'hunter2' },
    });
    expect(created.status).toBe(201);
    expect(created.body.public_config).toEqual({ host: 'mail.test' });
    expect(created.body.public_config.password).toBeUndefined();

    const id = created.body.id;
    const test = await send('POST', `/credentials/${id}/test`);
    expect(test.body).toEqual({ ok: true });

    const list = await get('/credentials?type=devkit:basic');
    expect(list.body.data).toHaveLength(1);
  });

  it('tests inline config and lists credential types', async () => {
    expect((await send('POST', '/credentials/test', { credential_type_slug: 'devkit:basic', config: { host: 'x' } })).body).toEqual({ ok: true });
    expect((await get('/credential-types')).body.data[0].auth_kind).toBe('static');
  });
});

describe('secret-ref plumbing during resolve', () => {
  it('feeds a stored secret into loadOptions', async () => {
    await send('POST', '/secrets', { key: 'orders-label', value: 'LIVE' });
    const { body } = await send('POST', '/nodes/devkit:playground/1.0.0/config:resolve', {
      target: 'category',
      config: { secretName: 'orders-label' },
    });
    expect(body.options[0].label).toBe('Orders (LIVE)');
  });
});

describe('templates + workflows + schemas', () => {
  it('instantiates a template into a workflow with its trigger', async () => {
    const inst = await send('POST', '/templates/devkit:starter/instantiate', { name: 'From starter' });
    expect(inst.status).toBe(201);
    const workflowId = inst.body.id;
    const triggers = await get(`/workflows/${workflowId}/triggers`);
    expect(triggers.body.data[0].type).toBe('manual');
  });

  it('serves vendored schemas and 404s unknown routes', async () => {
    expect((await get('/schemas/node/v0-draft')).body).toEqual({ $id: 'node/v0-draft' });
    expect((await get('/schemas/node')).body).toEqual({ $id: 'node' });
    expect((await get('/nope')).status).toBe(404);
  });
});
