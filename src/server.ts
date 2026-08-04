import http from 'node:http';
import { DevApiError } from './errors.js';
import { readJson, sendError, sendJson, sendNoContent } from './http.js';
import type { LoadedPackage } from './loader.js';
import { credentialInstanceToApi, credentialTypeToApi, nodeToApi, secretToApi, templateFullToApi, templateSummaryToApi, triggerToApi, workflowToApi } from './projections.js';
import {
  buildOAuthAuthorizeUrl,
  exchangeOAuthCode,
  executeNodeTest,
  findCredential,
  findCredentialType,
  nodeVersions,
  resolveNodeConfig,
  testCredentialConfig,
  testCredentialInstance,
  validateNodeConfig,
} from './resolve.js';
import { DEV_TENANT_ID, type DevStore } from './store.js';

export interface DevServerDeps {
  /** Returns the currently-loaded package; a function so hot-reload can swap it. */
  getPackage(): LoadedPackage;
  store: DevStore;
  /** JSON schemas served at `/schemas/{domain}[/{version}]`, keyed by `domain` and `domain/version`. */
  schemas?: Record<string, unknown>;
}

const SEGMENT = (s: string | undefined): string => decodeURIComponent(s ?? '');

/** Builds the `(req, res)` request listener implementing the mock `/api/v1` surface. */
export function createRequestListener(deps: DevServerDeps): http.RequestListener {
  return (req, res) => {
    handle(req, res, deps).catch(err => sendError(res, err));
  };
}

export function createDevServer(deps: DevServerDeps): http.Server {
  return http.createServer(createRequestListener(deps));
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, deps: DevServerDeps): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = url.pathname;
  if (pathname.startsWith('/api/v1')) {
    pathname = pathname.slice('/api/v1'.length);
  }
  const seg = pathname.split('/').filter(Boolean).map(SEGMENT);
  const loaded = deps.getPackage();
  const store = deps.store;

  switch (seg[0]) {
    case undefined:
    case 'health':
    // The service's health route is `/up` (Laravel's default); `/health` is kept
    // because the devkit has always answered there.
    case 'up':
      return void sendJson(res, 200, { status: 'ok' });

    case 'me':
      // Shape per the contract: { user, context, claims }. The mock used to send a
      // flat { id, name, email, tenant_id }, which no real client could consume.
      return void sendJson(res, 200, {
        user: { id: 1, zitadel_id: 'dev-user', email: 'dev@revenexx.test', name: 'Dev User' },
        context: { tenant_id: DEV_TENANT_ID, active_plane: 'public', roles: ['admin', 'user'] },
        claims: { iss: 'https://id.revenexx.test', sub: 'dev-user', aud: ['devkit'] },
      });

    case 'schemas':
      return handleSchemas(res, deps, seg);

    case 'nodes':
      return handleNodes(req, res, method, loaded, store, seg);

    case 'credential-types':
      return handleCredentialTypes(res, loaded, seg);

    case 'credentials':
      return handleCredentials(req, res, method, loaded, store, seg, url);

    case 'secrets':
      return handleSecrets(req, res, method, store, seg);

    case 'templates':
      return handleTemplates(req, res, method, loaded, store, seg);

    case 'workflows':
      return handleWorkflows(req, res, method, store, seg);

    default:
      return void sendJson(res, 404, { message: `No route for /${seg.join('/')}` });
  }
}

// --------------------------------------------------------------------- schemas

/**
 * The two schema routes have DIFFERENT shapes in the contract, which the mock
 * previously collapsed into one (it served the raw schema at both paths):
 *
 *   GET /schemas/{domain}           -> { domain, versions: string[] }   (a listing)
 *   GET /schemas/{domain}/{version} -> { domain, version, schema: {…} } (wrapped)
 *
 * Keys in `deps.schemas` are `domain` and `domain/version`, from the
 * `<domain>-<version>.json` files in assets/schemas.
 */
function handleSchemas(res: http.ServerResponse, deps: DevServerDeps, seg: string[]): void {
  const domain = seg[1];
  const version = seg[2];
  if (!domain) {
    throw new DevApiError(404, 'Schema domain required.');
  }
  const schemas = deps.schemas ?? {};

  if (!version) {
    const versions = Object.keys(schemas)
      .filter(key => key.startsWith(`${domain}/`))
      .map(key => key.slice(domain.length + 1))
      .sort();
    if (versions.length === 0 && !schemas[domain]) {
      throw new DevApiError(404, `Unknown schema domain '${domain}'. Vendor it into assets/schemas.`);
    }
    return void sendJson(res, 200, { domain, versions });
  }

  const schema = schemas[`${domain}/${version}`] ?? (schemas[domain] as unknown);
  if (!schema) {
    throw new DevApiError(404, `Unknown schema version '${domain}/${version}'. Vendor it into assets/schemas.`);
  }
  sendJson(res, 200, { domain, version, schema });
}

// ----------------------------------------------------------------------- nodes

async function handleNodes(req: http.IncomingMessage, res: http.ServerResponse, method: string, loaded: LoadedPackage, store: DevStore, seg: string[]): Promise<void> {
  // GET /nodes
  if (seg.length === 1 && method === 'GET') {
    return void sendJson(res, 200, { data: loaded.manifest.nodes.map(n => nodeToApi(n, nodeApiContext(loaded))) });
  }
  const slug = seg[1];
  if (!slug) {
    throw new DevApiError(404, 'Node slug required.');
  }

  // GET /nodes/{slug}/versions
  if (seg[2] === 'versions' && method === 'GET') {
    const versions = nodeVersions(loaded, slug);
    if (versions.length === 0) {
      throw new DevApiError(404, `Node '${slug}' not found.`);
    }
    return void sendJson(res, 200, { data: versions });
  }

  const version = seg[2];
  if (!version) {
    throw new DevApiError(404, 'Node version required.');
  }

  // POST /nodes/{slug}/{version}/config:resolve
  if (seg[3] === 'config:resolve' && method === 'POST') {
    const body = await readJson<{ target?: string; config?: Record<string, unknown>; locale?: string }>(req);
    if (!body.target) {
      throw new DevApiError(422, 'Field `target` is required.', { target: ['The target field is required.'] });
    }
    const result = await resolveNodeConfig(loaded, store, {
      slug,
      version,
      target: body.target,
      config: body.config ?? {},
      locale: body.locale,
    });
    return void sendJson(res, 200, result);
  }

  // POST /nodes/{slug}/{version}/config:validate
  //
  // DEVKIT-ONLY: this endpoint does NOT exist in the real integrations API. It
  // backs the preview host's `/nodes` page (Save → verdict + refused fields).
  // Listed in DEVKIT_ONLY in tests/contract.test.ts; do not build node code that
  // depends on it existing in production.
  if (seg[3] === 'config:validate' && method === 'POST') {
    const body = await readJson<{ config?: Record<string, unknown>; locale?: string }>(req);
    const result = await validateNodeConfig(loaded, store, {
      slug,
      version,
      config: body.config ?? {},
      locale: body.locale,
    });
    // 200 even when invalid — the `{ valid, errors }` body carries the verdict.
    return void sendJson(res, 200, result);
  }

  // POST /nodes/{slug}/{version}/execute:test
  if (seg[3] === 'execute:test' && method === 'POST') {
    const body = await readJson<{ config?: Record<string, unknown>; inputs?: Record<string, unknown>; timeout_ms?: number }>(req);
    const result = await executeNodeTest(loaded, store, {
      slug,
      version,
      config: body.config ?? {},
      inputs: body.inputs ?? {},
      timeoutMs: body.timeout_ms,
    });
    return void sendJson(res, 200, result);
  }

  // GET /nodes/{slug}/{version}
  if (seg.length === 3 && method === 'GET') {
    return void sendJson(res, 200, nodeToApi(findManifestNode(loaded, slug, version), nodeApiContext(loaded)));
  }

  // DELETE /nodes/{slug}/{version}
  //
  // The mock has no node registry to delete from — nodes come from the package
  // entry on disk. The route exists so the shape of a real deletion (404 for an
  // unknown node, 204 for a known one) is what an author sees.
  if (seg.length === 3 && method === 'DELETE') {
    findManifestNode(loaded, slug, version);
    return void sendNoContent(res);
  }

  throw new DevApiError(404, `No route for nodes/${seg.slice(1).join('/')}`);
}

/** The package identity + load time `GET /nodes` reports alongside each node. */
function nodeApiContext(loaded: LoadedPackage) {
  return { packageInfo: loaded.packageInfo, loadedAt: loaded.loadedAt };
}

/**
 * Resolves a node's MANIFEST entry (what `GET /nodes` projects), or throws 404.
 * Distinct from resolve.ts's `findNode`, which returns the live INode instance.
 */
function findManifestNode(loaded: LoadedPackage, slug: string, version: string) {
  const node = loaded.manifest.nodes.find(n => n.slug === slug && (version === 'latest' || n.version === version));
  if (!node) {
    throw new DevApiError(404, `Node '${slug}@${version}' not found.`);
  }
  return node;
}

// ------------------------------------------------------------- credential-types

function handleCredentialTypes(res: http.ServerResponse, loaded: LoadedPackage, seg: string[]): void {
  if (seg.length === 1) {
    return void sendJson(res, 200, {
      data: (loaded.manifest.credentials ?? []).map(credentialTypeToApi),
    });
  }
  const slug = seg[1]!;
  const type = findCredentialType(loaded, slug); // throws 404
  sendJson(res, 200, { data: credentialTypeToApi(type) });
}

// ----------------------------------------------------------------- credentials

async function handleCredentials(req: http.IncomingMessage, res: http.ServerResponse, method: string, loaded: LoadedPackage, store: DevStore, seg: string[], url: URL): Promise<void> {
  const typeOf = (slug: string) => {
    try {
      return findCredentialType(loaded, slug);
    } catch {
      return undefined;
    }
  };

  // Collection-level routes.
  if (seg.length === 1) {
    if (method === 'GET') {
      const filter = url.searchParams.get('type') ?? undefined;
      const data = store.listCredentials(filter).map(c => credentialInstanceToApi(c, typeOf(c.credentialTypeSlug)));
      return void sendJson(res, 200, { data });
    }
    if (method === 'POST') {
      const body = await readJson<{ credential_type_slug?: string; name?: string; config?: Record<string, unknown> }>(req);
      if (!body.credential_type_slug || !body.name) {
        throw new DevApiError(422, 'Fields `credential_type_slug` and `name` are required.');
      }
      findCredential(loaded, body.credential_type_slug); // 404 if unknown type
      const record = store.createCredential({
        credentialTypeSlug: body.credential_type_slug,
        name: body.name,
        config: body.config ?? {},
      });
      return void sendJson(res, 201, credentialInstanceToApi(record, typeOf(record.credentialTypeSlug)));
    }
  }

  // POST /credentials/test  (inline, unsaved)
  if (seg[1] === 'test' && method === 'POST') {
    const body = await readJson<{ credential_type_slug?: string; config?: Record<string, unknown> }>(req);
    if (!body.credential_type_slug) {
      throw new DevApiError(422, 'Field `credential_type_slug` is required.');
    }
    const result = await testCredentialConfig(loaded, store, body.credential_type_slug, body.config ?? {});
    return void sendJson(res, 200, result);
  }

  // GET /credentials/oauth/callback
  if (seg[1] === 'oauth' && seg[2] === 'callback' && method === 'GET') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      throw new DevApiError(422, 'OAuth callback requires `code` and `state`.');
    }
    // The state carries the credential id in the dev flow (see authorize-url below).
    const credentialId = state;
    const redirectUri = `${url.origin}/api/v1/credentials/oauth/callback`;
    await exchangeOAuthCode(loaded, store, credentialId, { code, redirectUri });
    return void sendJson(res, 200, { status: 'connected', credential_id: credentialId });
  }

  const id = seg[1];
  if (!id) {
    throw new DevApiError(404, 'Credential id required.');
  }

  // POST /credentials/{id}/test
  if (seg[2] === 'test' && method === 'POST') {
    const result = await testCredentialInstance(loaded, store, id);
    // The contract reports the recorded outcome alongside the verdict — the
    // service persists it on the credential. (The inline variant,
    // POST /credentials/test, returns the bare `{ ok }` and records nothing,
    // because there is no record yet.)
    const record = store.recordCredentialTest(id, { ok: result.ok, message: result.message ?? null });
    return void sendJson(res, 200, {
      ok: result.ok,
      message: result.message ?? null,
      last_test_at: record?.lastTestAt ?? null,
      last_test_ok: record?.lastTestOk ?? result.ok,
    });
  }

  // POST /credentials/{id}/oauth/authorize-url
  if (seg[2] === 'oauth' && seg[3] === 'authorize-url' && method === 'POST') {
    const redirectUri = 'http://localhost/api/v1/credentials/oauth/callback';
    // Dev flow: carry the credential id in `state` so the callback can find it.
    const result = await buildOAuthAuthorizeUrl(loaded, store, id, { redirectUri, state: id });
    return void sendJson(res, 200, { authorize_url: result.authorizeUrl });
  }

  // Item-level routes.
  if (seg.length === 2) {
    const record = store.getCredential(id);
    if (method === 'GET') {
      if (!record) {
        throw new DevApiError(404, `Credential '${id}' not found.`);
      }
      return void sendJson(res, 200, credentialInstanceToApi(record, typeOf(record.credentialTypeSlug)));
    }
    if (method === 'PATCH') {
      if (!record) {
        throw new DevApiError(404, `Credential '${id}' not found.`);
      }
      const body = await readJson<{ name?: string; config?: Record<string, unknown> }>(req);
      const updated = store.updateCredential(id, { name: body.name, config: body.config });
      return void sendJson(res, 200, credentialInstanceToApi(updated!, typeOf(updated!.credentialTypeSlug)));
    }
    if (method === 'DELETE') {
      store.deleteCredential(id);
      return void sendNoContent(res);
    }
  }

  throw new DevApiError(404, `No route for credentials/${seg.slice(1).join('/')}`);
}

// --------------------------------------------------------------------- secrets

async function handleSecrets(req: http.IncomingMessage, res: http.ServerResponse, method: string, store: DevStore, seg: string[]): Promise<void> {
  if (seg.length === 1) {
    if (method === 'GET') {
      // The contract's top-level property is `keys: string[]` — a bare key list,
      // not records. The mock used to send `{ data: [{key, created_at, …}] }`,
      // which is why the UI carries a three-way envelope fallback.
      return void sendJson(res, 200, { keys: store.listSecrets().map(s => s.key) });
    }
    if (method === 'POST') {
      const body = await readJson<{ key?: string; value?: string }>(req);
      if (!body.key || body.value === undefined) {
        throw new DevApiError(422, 'Fields `key` and `value` are required.');
      }
      const record = store.setSecret(body.key, body.value);
      return void sendJson(res, 201, secretToApi(record));
    }
  }
  const key = seg[1];
  if (key) {
    if (method === 'PATCH') {
      const body = await readJson<{ value?: string }>(req);
      if (body.value === undefined) {
        throw new DevApiError(422, 'Field `value` is required.');
      }
      return void sendJson(res, 200, secretToApi(store.setSecret(key, body.value)));
    }
    if (method === 'DELETE') {
      store.deleteSecret(key);
      return void sendNoContent(res);
    }
  }
  throw new DevApiError(404, `No route for secrets/${seg.slice(1).join('/')}`);
}

// ------------------------------------------------------------------- templates

async function handleTemplates(req: http.IncomingMessage, res: http.ServerResponse, method: string, loaded: LoadedPackage, store: DevStore, seg: string[]): Promise<void> {
  const templates = loaded.manifest.templates ?? [];
  if (seg.length === 1 && method === 'GET') {
    return void sendJson(res, 200, { data: templates.map(templateSummaryToApi) });
  }
  const slug = seg[1];
  const template = templates.find(t => t.slug === slug);
  if (!template) {
    throw new DevApiError(404, `Template '${slug}' not found.`);
  }
  if (seg.length === 2 && method === 'GET') {
    // Wrapped in `data` per the contract; the mock used to return it bare.
    return void sendJson(res, 200, { data: templateFullToApi(template) });
  }
  if (seg[2] === 'requirements' && method === 'GET') {
    // The contract's key is `credentialTypes` (the mock said `credentials`).
    // Resolving what a template's blob actually references is not implemented —
    // an empty requirement set is honest, not a stand-in for real analysis.
    return void sendJson(res, 200, { data: { credentialTypes: [], secrets: [] } });
  }
  if (seg[2] === 'instantiate' && method === 'POST') {
    const body = await readJson<{ name?: string }>(req);
    // A template's `definition` IS a workflow blob authored against its
    // `blobVersion` (see ITemplateDescription), so it maps straight onto the
    // workflow's blob + blob_definition_version.
    const workflow = store.createWorkflow({
      name: body.name ?? String(template.name),
      blob: template.definition,
      blobDefinitionVersion: template.blobVersion,
    });
    for (const trigger of template.triggers ?? []) {
      store.createTrigger({
        workflowId: workflow.id,
        type: trigger.type,
        name: trigger.name ?? null,
        config: trigger.config ?? {},
        active: trigger.active ?? true,
        id: trigger.handle,
      });
    }
    return void sendJson(res, 201, workflowToApi(workflow));
  }
  throw new DevApiError(404, `No route for templates/${seg.slice(1).join('/')}`);
}

// ------------------------------------------------------------------- workflows

/**
 * Body of POST /workflows and PUT /workflows/{id}, in the contract's snake_case.
 * Note `blob` — NOT `definition`. The mock read `body.definition` until 0.2.2,
 * so every workflow saved from the real UI silently stored an empty graph.
 */
interface WorkflowWriteBody {
  name?: string;
  description?: string | null;
  blob?: Record<string, unknown>;
  blob_definition_version?: string;
  active?: boolean;
  execution_mode?: string;
}

async function handleWorkflows(req: http.IncomingMessage, res: http.ServerResponse, method: string, store: DevStore, seg: string[]): Promise<void> {
  if (seg.length === 1) {
    if (method === 'GET') {
      return void sendJson(res, 200, { data: store.listWorkflows().map(workflowToApi) });
    }
    if (method === 'POST') {
      const body = await readJson<WorkflowWriteBody>(req);
      const workflow = store.createWorkflow({
        name: body.name ?? 'Untitled workflow',
        blob: body.blob ?? {},
        blobDefinitionVersion: body.blob_definition_version,
        description: body.description,
        active: body.active,
        executionMode: body.execution_mode,
      });
      return void sendJson(res, 201, workflowToApi(workflow));
    }
  }

  // Collection sub-routes registered before {id}.
  if (seg[1] === 'used-credentials' && method === 'GET') {
    return void sendJson(res, 200, { data: [] });
  }
  if (seg[1] === 'used-credential-types' && method === 'GET') {
    return void sendJson(res, 200, { data: [] });
  }

  const id = Number.parseInt(seg[1] ?? '', 10);
  if (Number.isNaN(id)) {
    throw new DevApiError(404, `No route for workflows/${seg.slice(1).join('/')}`);
  }

  // Triggers
  if (seg[2] === 'triggers') {
    if (seg.length === 3 && method === 'GET') {
      return void sendJson(res, 200, { data: store.listTriggers(id).map(triggerToApi) });
    }
    if (seg.length === 3 && method === 'POST') {
      const body = await readJson<{ type?: string; name?: string; config?: Record<string, unknown>; active?: boolean }>(req);
      if (!body.type) {
        throw new DevApiError(422, 'Field `type` is required.');
      }
      const trigger = store.createTrigger({ workflowId: id, type: body.type, name: body.name, config: body.config, active: body.active });
      return void sendJson(res, 201, triggerToApi(trigger));
    }
    const triggerId = seg[3];
    if (triggerId && method === 'PUT') {
      const body = await readJson<{ type?: string; name?: string; config?: Record<string, unknown>; active?: boolean }>(req);
      if (!body.type) {
        throw new DevApiError(422, 'Field `type` is required.');
      }
      const trigger = store.replaceTrigger(triggerId, { type: body.type, name: body.name, config: body.config, active: body.active });
      if (!trigger) {
        throw new DevApiError(404, `Trigger '${triggerId}' not found.`);
      }
      return void sendJson(res, 200, triggerToApi(trigger));
    }
    if (triggerId && method === 'DELETE') {
      store.deleteTrigger(triggerId);
      return void sendNoContent(res);
    }
  }

  // Item-level workflow routes.
  if (seg.length === 2) {
    const record = store.getWorkflow(id);
    if (method === 'GET') {
      if (!record) {
        throw new DevApiError(404, `Workflow '${id}' not found.`);
      }
      return void sendJson(res, 200, workflowToApi(record));
    }
    if (method === 'PUT') {
      const body = await readJson<WorkflowWriteBody>(req);
      const updated = store.updateWorkflow(id, {
        name: body.name,
        blob: body.blob,
        blobDefinitionVersion: body.blob_definition_version,
        description: body.description,
        active: body.active,
        executionMode: body.execution_mode,
      });
      if (!updated) {
        throw new DevApiError(404, `Workflow '${id}' not found.`);
      }
      return void sendJson(res, 200, workflowToApi(updated));
    }
    if (method === 'DELETE') {
      store.deleteWorkflow(id);
      return void sendNoContent(res);
    }
  }

  if ((seg[2] === 'credentials' || seg[2] === 'credential-types') && method === 'GET') {
    return void sendJson(res, 200, { data: [] });
  }

  throw new DevApiError(404, `No route for workflows/${seg.slice(1).join('/')}`);
}
