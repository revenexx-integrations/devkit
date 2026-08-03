import type { AddressInfo } from 'node:net';
import type { IConfigField, INode, INodeAuthorContext, INodeContext, INodeResult } from '@revenexx/integrations-node-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevServer, DevStore, resolveExports } from '../src/index.js';

/** A node whose config exercises required / validation rules + a dynamic-schema. */
class RulesNode implements INode {
  description = {
    slug: 'devkit:rules',
    version: '1.0.0',
    category: 'action' as const,
    name: 'Rules',
    inputs: {},
    outputs: [],
    config: [
      { key: 'host', label: 'Host', type: 'string' as const, required: true },
      { key: 'port', label: 'Port', type: 'number' as const, validation: { min: 1, max: 65535 } },
      { key: 'code', label: 'Code', type: 'string' as const, validation: { pattern: '^[A-Z]{3}$' } },
      {
        key: 'mode',
        label: 'Mode',
        type: 'select' as const,
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
      { key: 'token', label: 'Token', type: 'string' as const, required: true, expressionAllowed: true },
      { key: 'params', label: 'Params', type: 'dynamic-schema' as const, dependsOn: ['host'] },
    ],
  };

  async execute(_ctx: INodeContext, _inputs: Record<string, unknown>): Promise<INodeResult> {
    return { outputs: {} };
  }

  async resolveConfigSchema(_ctx: INodeAuthorContext): Promise<IConfigField[]> {
    return [{ key: 'entity_id', label: 'Entity Id', type: 'string', required: true }];
  }
}

const loaded = resolveExports({ NODES: [new RulesNode()] });
const store = new DevStore();
const server = createDevServer({ getPackage: () => loaded, store });

let base = '';

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function validate(config: Record<string, unknown>) {
  const res = await fetch(`${base}/nodes/devkit:rules/1.0.0/config:validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  return { status: res.status, body: (await res.json()) as { valid: boolean; errors: Record<string, string[]> } };
}

describe('config:validate', () => {
  it('flags a missing required field (and its dynamic-schema child)', async () => {
    const { status, body } = await validate({});
    expect(status).toBe(200);
    expect(body.valid).toBe(false);
    expect(body.errors.host).toBeDefined();
    expect(body.errors.token).toBeDefined();
    // dynamic-schema child schema is resolved and its required rule applied
    expect(body.errors.entity_id).toBeDefined();
  });

  it('enforces number range, pattern, and select membership', async () => {
    const { body } = await validate({ host: 'h', token: 't', entity_id: 'e', port: 70000, code: 'ab', mode: 'z' });
    expect(body.valid).toBe(false);
    expect(body.errors.port?.[0]).toMatch(/<= 65535/);
    expect(body.errors.code).toBeDefined();
    expect(body.errors.mode).toBeDefined();
  });

  it('treats an expression value as provided for a required field', async () => {
    const { body } = await validate({ host: 'h', token: '${{ $json.t }}', entity_id: 'e' });
    expect(body.valid).toBe(true);
    expect(body.errors).toEqual({});
  });

  it('passes a fully valid payload', async () => {
    const { body } = await validate({ host: 'db.local', token: 'secret', entity_id: 'e-1', port: 5432, code: 'ABC', mode: 'a' });
    expect(body).toEqual({ valid: true, errors: {} });
  });
});
