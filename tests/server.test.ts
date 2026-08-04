import type { AddressInfo } from 'node:net';
import type { IOutputPort } from '@revenexx/integrations-node-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevServer, DevStore, resolveExports } from '../src/index.js';
import { PlaygroundNode, StaticCredential, template } from './fixtures/package.js';

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

describe('execute:test (runs the real execute in-process)', () => {
  it('returns the outputs, branch and collected logs', async () => {
    const { status, body } = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      config: { category: 'orders' },
      inputs: { extra: 1 },
    });
    expect(status).toBe(200);
    // inputs are merged OVER config, per the contract's wording.
    expect(body).toMatchObject({ outputs: { echoed: { category: 'orders', extra: 1 } }, branch: 'matched' });
    expect(body.logs).toEqual([{ level: 'info', message: 'executing playground', meta: { keys: ['category', 'extra'] } }]);
  });

  it('reports a throwing node as 502 with the logs it managed to emit', async () => {
    const { status, body } = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', { inputs: { boom: true } });
    expect(status).toBe(502);
    expect(body.message).toContain('boom');
    expect(body.errors.logs).toEqual(['info: executing playground']);
  });

  /**
   * The node here never consults `ctx.signal`, so aborting the signal cannot stop
   * it — only the race can. Without enforcement the request hangs until Node's
   * 300 s `requestTimeout`, and `timeout_ms` is a promise the mock does not keep.
   */
  it('enforces the timeout even when the node ignores ctx.signal', async () => {
    const started = Date.now();
    const { status, body } = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      inputs: { hang: true },
      // Below the contract's 1000 ms floor on purpose — it must be clamped up.
      timeout_ms: 10,
    });
    expect(status).toBe(502);
    expect(body.message).toContain('timed out after 1000 ms');
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
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

    // Testing a SAVED credential records the outcome and reports it back, per the
    // contract; the inline variant (POST /credentials/test) returns a bare `{ ok }`.
    const id = created.body.id;
    const test = await send('POST', `/credentials/${id}/test`);
    expect(test.body).toMatchObject({ ok: true, message: null, last_test_ok: true });
    expect(typeof test.body.last_test_at).toBe('string');

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

  it('serves vendored schemas in the contract envelopes and 404s unknown routes', async () => {
    // The two routes have different shapes: /{domain} lists versions, while
    // /{domain}/{version} wraps the schema. The mock served the bare schema at
    // both until it was aligned to contract/integrations-v1.json.
    expect((await get('/schemas/node/v0-draft')).body).toEqual({
      domain: 'node',
      version: 'v0-draft',
      schema: { $id: 'node/v0-draft' },
    });
    expect((await get('/schemas/node')).body).toEqual({ domain: 'node', versions: ['v0-draft'] });
    expect((await get('/schemas/nope')).status).toBe(404);
    expect((await get('/nope')).status).toBe(404);
  });

  /**
   * A known domain with an unknown version must 404, not fall back to the latest
   * schema. Answering 200 there tells an author their version exists and hands
   * them a different document than the one they asked for.
   */
  it('404s an unknown version of a known schema domain', async () => {
    expect((await get('/schemas/node/v99-nope')).status).toBe(404);
  });
});
