import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_VERSION } from '../src/http.js';
import { createDevServer, DevStore, resolveExports } from '../src/index.js';
import { OAuthCredential, PlaygroundNode, StaticCredential, template } from './fixtures/package.js';

/**
 * Checks the mock against the integrations service's own OpenAPI contract.
 *
 * WHY this exists: `@revenexx/studio-integrations` talks to a specific version of
 * the integrations API and the devkit mocks it. When the service adds or changes
 * an endpoint and a new studio-integrations ships, nothing used to notice — the
 * preview just behaved differently from production, and external node authors got
 * a prettier lie. This test is the thing that goes red instead.
 *
 * HOW: behavioural, not introspective. The mock's router is a nested switch and
 * cannot be enumerated, so instead the real server is started and every path in
 * the spec is actually requested. That has the pleasant property that it cannot
 * drift from what the mock really does.
 *
 * LIMIT, deliberately accepted: this only detects spec → mock gaps (endpoints the
 * service has and the mock lacks). It cannot detect mock → spec extras, because
 * there is no route table to enumerate. DEVKIT_ONLY below is therefore
 * documentation, not detection. Spec → mock is the direction that matters here: it
 * is the one a studio-integrations upgrade breaks.
 *
 * Refresh the snapshot with `npm run refresh-contract`.
 */

const SPEC_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../contract/integrations-v1.json');

interface Spec {
  openapi: string;
  info: { version: string };
  'x-devkit-source'?: string;
  'x-devkit-fetched'?: string;
  paths: Record<string, Record<string, Operation>>;
}

interface Operation {
  responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }>;
}

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
}

const spec = JSON.parse(readFileSync(SPEC_FILE, 'utf-8')) as Spec;
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * Endpoints the mock deliberately does not implement, with the reason. Everything
 * here is backed by Temporal or by storage the devkit has no stand-in for; see
 * "Fidelity caveats" in docs/architecture.md.
 *
 * Removing an entry without implementing the route makes this suite fail — which
 * is the point: the list is a decision record, not a mute button.
 */
const INTENTIONALLY_NOT_MOCKED: Record<string, string> = {
  'GET /api/v1/audit-logs': 'no audit trail in the mock; nothing writes one',
  'GET /api/v1/node-packages/images/{id}': 'no image storage; templates reference remote URLs',
  'GET /api/v1/webhooks/{handle}': 'webhook ingestion belongs to the trigger runtime',
  'GET /api/v1/workflows/{workflowId}/dead-letters': 'dead letters come from Temporal',
  'POST /api/v1/dead-letters/{id}/discard': 'dead letters come from Temporal',
  'POST /api/v1/dead-letters/{id}/replay': 'dead letters come from Temporal',
  'GET /api/v1/workflows/{workflowId}/revisions': 'no revision history; the store keeps one version',
  'GET /api/v1/workflows/{workflowId}/revisions/{revision}': 'no revision history',
  'POST /api/v1/workflows/{workflowId}/revisions/{revision}/restore': 'no revision history',
  'GET /api/v1/workflows/{workflowId}/runs': 'workflow execution is phase 2 (no Temporal)',
  'POST /api/v1/workflows/{workflowId}/runs': 'workflow execution is phase 2 (no Temporal)',
  'GET /api/v1/workflows/{workflowId}/runs/{runId}': 'workflow execution is phase 2',
  'GET /api/v1/workflows/{workflowId}/runs/{runId}/details': 'workflow execution is phase 2',
  'GET /api/v1/workflows/{workflowId}/runs/{runId}/history': 'workflow execution is phase 2',
  'GET /api/v1/workflows/{workflowId}/runs/{runId}/steps': 'workflow execution is phase 2',
  'GET /api/v1/workflows/{workflowId}/runs/{runId}/stack-trace': 'workflow execution is phase 2',
  'POST /api/v1/workflows/{workflowId}/runs/{runId}/cancel': 'workflow execution is phase 2',
  'POST /api/v1/workflows/{workflowId}/runs/{runId}/terminate': 'workflow execution is phase 2',
  'POST /api/v1/workflows/{workflowId}/runs/{runId}/retry': 'workflow execution is phase 2',
  'POST /api/v1/workflows/{workflowId}/runs/{runId}/resume': 'workflow execution is phase 2',
};

/**
 * Routes the MOCK serves that the contract does not have. Not auto-detected (see
 * the LIMIT note above) — kept here and in the handler comments so nobody mistakes
 * them for real API.
 */
const DEVKIT_ONLY: Record<string, string> = {
  'POST /api/v1/nodes/{slug}/{version}/config:validate': 'devkit invention backing the preview host /nodes page; the service validates on save instead',
  'GET /api/v1/health': "devkit alias for the service's /up",
};

// --------------------------------------------------------------------- fixtures

const loaded = resolveExports({
  NODES: [new PlaygroundNode()],
  CREDENTIALS: [new StaticCredential(), new OAuthCredential()],
  TEMPLATES: [template],
});
const store = new DevStore();
const server = createDevServer({
  getPackage: () => loaded,
  store,
  // The real registry lives in the service as PHP classes; these stand in so the
  // schema routes can be exercised. assets/schemas/ is still empty at run time —
  // see its README.
  schemas: { 'node/v0-draft': { $id: 'node/v0-draft' }, 'workflow/v0-draft': { $id: 'workflow/v0-draft' } },
});

let base = '';

/**
 * Path parameter values pointing at seeded fixture records.
 *
 * Keyed by `<path-prefix>:<param>` where a bare name would be ambiguous — `{slug}`
 * means a node under /nodes, a credential type under /credential-types and a
 * template under /templates, and `{id}` is a credential uuid in one place and a
 * workflow integer in another. `PARAM_FALLBACK` covers the rest.
 */
const PARAMS_BY_PREFIX: Record<string, Record<string, string>> = {
  '/api/v1/nodes': { slug: 'devkit:playground', version: '1.0.0' },
  '/api/v1/credential-types': { slug: 'devkit:basic' },
  '/api/v1/templates': { slug: 'devkit:starter' },
  '/api/v1/schemas': { domain: 'node', version: 'v0-draft' },
};

const PARAM_FALLBACK: Record<string, string> = {
  key: 'CONTRACT_SECRET',
  handle: 'trig-contract',
  // Only reached by endpoints on INTENTIONALLY_NOT_MOCKED, where the assertion is
  // that the mock has no route at all — so any syntactically valid value does.
  revision: '1',
  runId: 'run-contract',
};

/** Filled in `beforeAll` from the records actually created. */
const seeded: Record<string, string> = {};

beforeAll(async () => {
  await new Promise<void>(done => server.listen(0, done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

/**
 * Re-seeds before EVERY case, because the suite exercises the contract's DELETE
 * operations too — without this, `DELETE /credentials/{id}` runs before
 * `POST /credentials/{id}/test` and the later case 404s on a record the earlier one
 * removed. Seeding is in-memory, so this is cheap.
 */
beforeEach(async () => {
  const secret = await call('POST', '/api/v1/secrets', { key: PARAM_FALLBACK.key, value: 'v' });
  expect(secret.status).toBe(201);

  const credential = await call('POST', '/api/v1/credentials', {
    credential_type_slug: 'devkit:basic',
    name: 'Contract credential',
    config: { host: 'mail.test', password: 'hunter2' },
  });
  expect(credential.status).toBe(201);
  seeded.credentialId = String((credential.body as { id: string }).id);

  // A 3-legged OAuth credential, so the authorize-url and callback routes can
  // reach their success path instead of 422-ing on a static type.
  const oauth = await call('POST', '/api/v1/credentials', {
    credential_type_slug: 'devkit:oauth',
    name: 'Contract OAuth credential',
    config: { clientId: 'cid', clientSecret: 'secret' },
  });
  expect(oauth.status).toBe(201);
  seeded.oauthCredentialId = String((oauth.body as { id: string }).id);

  const workflow = await call('POST', '/api/v1/workflows', {
    name: 'Contract workflow',
    blob_definition_version: 'v0-draft',
    blob: { nodes: [], edges: [] },
    active: true,
    execution_mode: 'async_only',
  });
  expect(workflow.status).toBe(201);
  seeded.workflowId = String((workflow.body as { id: number }).id);

  const trigger = await call('POST', `/api/v1/workflows/${seeded.workflowId}/triggers`, { type: 'manual' });
  expect(trigger.status).toBe(201);
  seeded.triggerId = String((trigger.body as { id: string }).id);
});

afterAll(async () => {
  await new Promise<void>(done => server.close(() => done()));
});

// ---------------------------------------------------------------------- helpers

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

function paramValue(specPath: string, name: string): string {
  if (name === 'id') {
    // `{id}` is a workflow under /workflows and a credential everywhere else.
    if (specPath.startsWith('/api/v1/workflows')) return seeded.workflowId!;
    // The OAuth routes need the OAuth credential, not the static one.
    return specPath.includes('/oauth/') ? seeded.oauthCredentialId! : seeded.credentialId!;
  }
  if (name === 'workflowId') return seeded.workflowId!;
  if (name === 'triggerId') return seeded.triggerId!;

  const prefix = Object.keys(PARAMS_BY_PREFIX).find(p => specPath.startsWith(p));
  const scoped = prefix ? PARAMS_BY_PREFIX[prefix]![name] : undefined;
  const value = scoped ?? PARAM_FALLBACK[name];
  if (value === undefined) {
    throw new Error(`No fixture value for path parameter {${name}} in ${specPath} — add one to PARAMS_BY_PREFIX or PARAM_FALLBACK.`);
  }
  return value;
}

/** Fills `{param}` placeholders, plus the query string a few endpoints require. */
function concreteUrl(specPath: string): string {
  const path = specPath.replace(/\{(\w+)\}/g, (_m, name: string) => encodeURIComponent(paramValue(specPath, name)));
  // The OAuth callback takes its code/state from the query string, not the path;
  // without them the route correctly 422s before doing anything.
  if (specPath.endsWith('/credentials/oauth/callback')) {
    return `${path}?code=dev-code&state=${encodeURIComponent(seeded.oauthCredentialId!)}`;
  }
  return path;
}

/** A minimal body good enough to get past required-field validation. */
function sampleBody(method: string, specPath: string): unknown {
  if (method === 'GET' || method === 'DELETE') return undefined;
  if (specPath.endsWith('/secrets')) return { key: 'ANOTHER_SECRET', value: 'v' };
  if (specPath.endsWith('/credentials')) {
    return { credential_type_slug: 'devkit:basic', name: 'c', config: { host: 'h' } };
  }
  if (specPath.endsWith('/credentials/test')) return { credential_type_slug: 'devkit:basic', config: { host: 'h' } };
  if (specPath.endsWith('/secrets/{key}')) return { value: 'v2' };
  if (specPath.endsWith('/credentials/{id}')) return { name: 'renamed' };
  if (specPath.endsWith('/triggers') || specPath.endsWith('/triggers/{triggerId}')) return { type: 'manual' };
  if (specPath.endsWith('/workflows') || specPath.endsWith('/workflows/{id}')) {
    return {
      name: 'w',
      blob_definition_version: 'v0-draft',
      blob: {},
      active: true,
      execution_mode: 'async_only',
    };
  }
  if (specPath.endsWith('config:resolve')) return { target: '*', config: {} };
  if (specPath.endsWith('config:validate')) return { config: {} };
  if (specPath.endsWith('execute:test')) return { config: {}, inputs: {} };
  return {};
}

/**
 * Every 2xx the spec declares for an operation. More than one is normal —
 * `POST /secrets` declares 200 (updated an existing key) and 201 (created one) —
 * so any of them counts as correct.
 */
function declaredSuccessStatuses(op: Operation): number[] {
  return Object.keys(op.responses ?? {})
    .filter(c => /^2\d\d$/.test(c))
    .map(Number)
    .sort((a, b) => a - b);
}

function typeMatches(schemaType: string | string[] | undefined, value: unknown): boolean {
  if (schemaType === undefined) return true;
  const types = Array.isArray(schemaType) ? schemaType : [schemaType];
  return types.some(t => {
    switch (t) {
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      case 'string':
        return typeof value === 'string';
      case 'integer':
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'null':
        return value === null;
      default:
        return true;
    }
  });
}

/**
 * Property paths whose contents are the node author's, not the contract's.
 *
 * Scribe infers a schema from the `@response` example, so a free-form JSON payload
 * comes out with the example's keys pinned as if they were required — e.g.
 * `execute:test`'s `outputs` gains `{ customer: { id } }` from an example about a
 * customer node. Descending into these would assert somebody else's example data.
 */
const FREE_FORM_PATHS = new Set([
  'outputs', // execute:test — whatever the node returns
  'blob', // workflow graph
  'manifest', // node manifest, validated by the schema endpoints instead
  'config', // trigger/credential config, per type
  'public_config', // masked credential config, per type
  'claims', // token claims
  'definition', // template blob
  'schema', // the vendored JSON schema itself
]);

/**
 * Type mismatches the SPEC gets wrong, not the mock — with the reason. Scribe
 * derives types from one example, so a field that is a localized-string object in
 * reality is declared `string` because the example happened to show one language.
 *
 * These are reported upstream rather than "fixed" in the mock: making the mock send
 * a bare string would break the UI's `resolveLocalized()` and throw away locale
 * data the node author supplied.
 */
const SPEC_TYPE_TOO_NARROW: Record<string, string> = {
  name: 'LocalizedString in the SDK; the spec example shows a single language',
  description: 'LocalizedString',
  shortDescription: 'LocalizedString',
  icon: 'LocalizedString',
  label: 'LocalizedString',
  id: 'the mock issues uuid/string ids; seeds document stable string ids (README)',
  credential_id: 'same as `id` — the mock keys credentials by uuid, not integer',
};

/**
 * Properties the contract declares but that are legitimately absent from a given
 * response, with the reason. Kept separate from SPEC_TYPE_TOO_NARROW because these
 * are not spec bugs — the contract itself documents them as conditional.
 */
const CONDITIONALLY_PRESENT: Record<string, string> = {
  inbound_secret: 'per the contract: "Present ONLY right after a public webhook endpoint is provisioned" (ADR-0066). The mock provisions no webhooks, so a manual trigger has none.',
};

/**
 * Asserts every property the spec DECLARES is present with a matching type.
 *
 * Deliberately not Ajv: Scribe infers these schemas from `@response` examples, so
 * they carry no `required` and allow additional properties. `ajv.validate` would
 * happily accept `{ data: [] }` against `{ keys: string[] }` — exactly the drift
 * this is here to catch. Absence of a declared property is the signal.
 */
function missingDeclaredProps(schema: JsonSchema | undefined, value: unknown, path = ''): string[] {
  if (!schema?.properties || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }
  const problems: string[] = [];
  for (const [name, sub] of Object.entries(schema.properties)) {
    const here = path ? `${path}.${name}` : name;
    const actual = (value as Record<string, unknown>)[name];
    if (actual === undefined) {
      if (!(name in CONDITIONALLY_PRESENT)) {
        problems.push(`missing \`${here}\``);
      }
      continue;
    }
    if (!typeMatches(sub.type, actual) && !(name in SPEC_TYPE_TOO_NARROW)) {
      problems.push(`\`${here}\` should be ${JSON.stringify(sub.type)}, got ${Array.isArray(actual) ? 'array' : typeof actual}`);
      continue;
    }
    if (FREE_FORM_PATHS.has(name)) {
      continue;
    }
    // One level into arrays is enough to catch renamed item fields.
    if (sub.type === 'array' && Array.isArray(actual) && actual.length > 0) {
      problems.push(...missingDeclaredProps(sub.items, actual[0], `${here}[0]`));
    } else if (sub.type === 'object') {
      problems.push(...missingDeclaredProps(sub, actual, here));
    }
  }
  return problems;
}

/** Every (method, path) the spec declares. */
const operations = Object.entries(spec.paths).flatMap(([specPath, ops]) =>
  HTTP_METHODS.filter(m => ops[m]).map(m => ({
    key: `${m.toUpperCase()} ${specPath}`,
    method: m.toUpperCase(),
    specPath,
    op: ops[m]!,
  })),
);

// ------------------------------------------------------------------------ tests

describe('vendored contract snapshot', () => {
  it('is a usable OpenAPI 3.1 document', () => {
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(operations.length).toBeGreaterThan(40);
  });

  it('agrees with the API_VERSION the mock reports', () => {
    // The mock cannot read the snapshot at run time (it does not ship), so this is
    // what keeps the constant in src/http.ts honest.
    expect(API_VERSION).toBe(spec.info.version);
  });

  it('sends X-Api-Version on responses', async () => {
    const res = await call('GET', '/api/v1/me');
    expect(res.headers.get('x-api-version')).toBe(API_VERSION);
  });

  it('has no allowlist entry for a path the spec dropped', () => {
    const known = new Set(operations.map(o => o.key));
    const stale = [...Object.keys(INTENTIONALLY_NOT_MOCKED), ...Object.keys(DEVKIT_ONLY)].filter(key => !known.has(key) && !(key in DEVKIT_ONLY));
    expect(stale, 'allowlist entries for endpoints the contract no longer has').toEqual([]);
  });
});

describe('every contract endpoint is either mocked or explicitly excluded', () => {
  for (const { key, method, specPath, op } of operations) {
    const excuse = INTENTIONALLY_NOT_MOCKED[key];

    it(`${key}${excuse ? ' — not mocked on purpose' : ''}`, async () => {
      const res = await call(method, concreteUrl(specPath), sampleBody(method, specPath));
      const routerMiss = res.status === 404 && typeof (res.body as { message?: string } | null)?.message === 'string' && /^No route for/.test((res.body as { message: string }).message);

      if (excuse) {
        expect(routerMiss, `${key} is on INTENTIONALLY_NOT_MOCKED ("${excuse}") but the mock answers it — remove the entry`).toBe(true);
        return;
      }

      expect(routerMiss, `${key} is in the contract but the mock has no route for it`).toBe(false);

      const allowed = declaredSuccessStatuses(op);
      expect(allowed, `${key} should answer one of ${allowed.join('/')} per the contract, got ${res.status} ${JSON.stringify(res.body)?.slice(0, 200)}`).toContain(res.status);

      const schema = op.responses?.[String(res.status)]?.content?.['application/json']?.schema;
      const problems = missingDeclaredProps(schema, res.body);
      expect(problems, `${key} response does not match the contract: ${problems.join('; ')}`).toEqual([]);
    });
  }
});
