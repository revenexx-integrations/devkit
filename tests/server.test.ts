import type { AddressInfo } from 'node:net';
import type { INode, IOutputPort } from '@revenexx/integrations-node-sdk';
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

  /**
   * The whole point of the state store is the *second* run. A preview that
   * forgot between calls could only ever show the create branch, which is the
   * one an author does not need help with.
   */
  it('remembers what a node correlated, so the second call takes the update branch', async () => {
    const first = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      inputs: { correlate: 'pim:12345' },
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ branch: 'created', outputs: { known: null } });

    const second = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      inputs: { correlate: 'pim:12345' },
    });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ branch: 'updated', outputs: { known: 'erp:pim:12345' } });
  });

  /**
   * A cursor is staged, not written: the run that advances the watermark does
   * not read it back, and a run that fails afterwards leaves it where it was.
   * Getting this wrong locally is invisible until a production run fails and
   * silently skips everything it never read.
   */
  it('adopts a staged cursor only once the run completes', async () => {
    const first = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      inputs: { advance: '2026-08-26T10:00:00Z' },
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ outputs: { from: null } });

    const second = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      inputs: { advance: '2026-08-27T10:00:00Z' },
    });
    expect(second.body).toMatchObject({ outputs: { from: { updatedAfter: '2026-08-26T10:00:00Z' } } });
  });

  it('drops what a failed run staged, so the next one reads the old watermark', async () => {
    await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      inputs: { advance: '2026-09-01T10:00:00Z' },
    });

    const failed = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      inputs: { advance: '2026-09-02T10:00:00Z', thenBoom: true },
    });
    expect(failed.status).toBe(502);

    const next = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      inputs: { advance: '2026-09-03T10:00:00Z' },
    });
    expect(next.body).toMatchObject({ outputs: { from: { updatedAfter: '2026-09-01T10:00:00Z' } } });
  });

  /**
   * The four roles share a namespace and a key without sharing a slot. A digest
   * written for the entity that was just correlated must not become the answer
   * `mapping.get` gives, or the next call takes the update branch on a partner
   * id that was never a partner id.
   */
  it('keeps a correlation and a digest for the same key apart', async () => {
    const first = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      inputs: { correlate: 'pim:77', digestToo: true },
    });
    expect(first.body).toMatchObject({ branch: 'created' });

    const second = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      inputs: { correlate: 'pim:77' },
    });
    expect(second.body).toMatchObject({ branch: 'updated', outputs: { known: 'erp:pim:77' } });
  });

  it('keeps a different key on the create branch', async () => {
    await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', { inputs: { correlate: 'pim:1' } });

    const other = await send('POST', '/nodes/devkit:playground/1.0.0/execute:test', {
      inputs: { correlate: 'pim:2' },
    });
    expect(other.body).toMatchObject({ branch: 'created' });
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

/**
 * `GET /nodes` is the listing the studio builds its node catalogue from, and
 * since `@revenexx/studio-integrations` 1.3.0 that catalogue reads "a newer
 * version of this node exists" as position in the array rather than by parsing a
 * semver. Export order — the order a human writes the versions in, oldest first
 * — would therefore have the inspector offer a DOWNGRADE as the upgrade.
 */
describe('node listing order', () => {
  class Versioned implements Pick<INode, 'description'> {
    constructor(
      private readonly slug: string,
      private readonly version: string,
    ) {}
    get description() {
      return {
        slug: this.slug,
        version: this.version,
        category: 'action' as const,
        name: this.slug,
        inputs: {},
        outputs: [{ kind: 'branch' as const, dataType: 'any' as const }],
        config: [],
      };
    }
    async execute() {
      return { outputs: {} };
    }
  }

  const multi = resolveExports({
    NODES: [new Versioned('devkit:alpha', '1.0.0'), new Versioned('devkit:alpha', '2.0.0'), new Versioned('devkit:beta', '0.9.0'), new Versioned('devkit:alpha', '1.10.0')] as unknown as INode[],
  });
  const multiServer = createDevServer({ getPackage: () => multi, store: new DevStore() });
  let multiBase = '';

  beforeAll(async () => {
    await new Promise<void>(resolve => multiServer.listen(0, resolve));
    multiBase = `http://127.0.0.1:${(multiServer.address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => {
    await new Promise<void>(resolve => multiServer.close(() => resolve()));
  });

  it('groups a slug together, newest version first, slugs in export order', async () => {
    const res = await fetch(`${multiBase}/nodes`);
    const body = (await res.json()) as { data: Array<{ slug: string; version: string }> };
    expect(body.data.map(n => `${n.slug}@${n.version}`)).toEqual([
      // 1.10.0 above 1.0.0 — a string compare would put it below.
      'devkit:alpha@2.0.0',
      'devkit:alpha@1.10.0',
      'devkit:alpha@1.0.0',
      'devkit:beta@0.9.0',
    ]);
  });

  it('lists the same versions as GET /nodes/{slug}/versions, in the same order', async () => {
    const listed = await fetch(`${multiBase}/nodes`);
    const listedBody = (await listed.json()) as { data: Array<{ slug: string; version: string }> };
    const versions = await fetch(`${multiBase}/nodes/devkit%3Aalpha/versions`);
    const versionsBody = (await versions.json()) as { data: string[] };
    expect(listedBody.data.filter(n => n.slug === 'devkit:alpha').map(n => n.version)).toEqual(versionsBody.data);
  });
});
