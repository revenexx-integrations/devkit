import { randomUUID } from 'node:crypto';

/**
 * In-memory data store backing the mock Integrations API. Holds the tenant-
 * scoped resources a developer creates in the preview (credentials, secrets,
 * workflows, triggers). Serializable so a session can be persisted to and
 * rehydrated from `.revenexx-dev/state.json`.
 */

export const DEV_TENANT_ID = 'dev-tenant';

export interface CredentialRecord {
  id: string;
  tenantId: string;
  credentialTypeSlug: string;
  name: string;
  status: string;
  /** Full user-entered config, including secret fields (never sent to the UI verbatim). */
  config: Record<string, unknown>;
  /** System-managed long-lived secrets (e.g. an OAuth refresh token). */
  durableCreds: Record<string, unknown> | null;
  /** Outcome of the last `POST /credentials/{id}/test`, which the contract reports. */
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecretRecord {
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Field names follow the service's contract: the graph is `blob`, tagged with the
 * `blob_definition_version` it was written against. The mock used to call it
 * `definition`, which meant a workflow saved from the real UI silently lost its
 * graph — the UI sends `blob`, so `body.definition` was always undefined.
 */
export interface WorkflowRecord {
  id: number;
  name: string;
  description: string | null;
  blob: Record<string, unknown>;
  blobDefinitionVersion: string;
  active: boolean;
  executionMode: string;
  /** Bumped on every update, like the service's revision counter. */
  revision: number;
  buildStatus: string;
  createdAt: string;
  updatedAt: string;
}

/** The only `blob_definition_version` the contract currently allows. */
export const BLOB_DEFINITION_VERSION = 'v0-draft';

/** `execution_mode` values the contract allows; the first is the default. */
export const EXECUTION_MODES = ['async_only', 'sync_only', 'caller_decides'] as const;

export interface TriggerRecord {
  id: string;
  workflowId: number;
  type: string;
  name: string | null;
  config: Record<string, unknown>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DevStoreSnapshot {
  schemaVersion: number;
  credentials: CredentialRecord[];
  secrets: SecretRecord[];
  workflows: WorkflowRecord[];
  triggers: TriggerRecord[];
  nextWorkflowId: number;
}

/**
 * Bumped to 2 when workflows moved from `definition` to the contract's `blob` /
 * `blob_definition_version` / `active` / `execution_mode`. `loadState` discards an
 * overlay whose version does not match, which is the migration: seeds are the
 * source of truth, the overlay is disposable session state.
 */
export const STORE_SCHEMA_VERSION = 2;

function now(): string {
  return new Date().toISOString();
}

export class DevStore {
  private credentials = new Map<string, CredentialRecord>();
  private secrets = new Map<string, SecretRecord>();
  private workflows = new Map<number, WorkflowRecord>();
  private triggers = new Map<string, TriggerRecord>();
  private nextWorkflowId = 1;

  /**
   * @param onChange fired after any mutation so a caller (the CLI) can persist
   *   the session to `.revenexx-dev/state.json`.
   */
  constructor(private onChange?: () => void) {}

  /** (Re)wire the post-mutation callback — e.g. attach it only after seeding. */
  setOnMutation(onChange: (() => void) | undefined): void {
    this.onChange = onChange;
  }

  private touch(): void {
    this.onChange?.();
  }

  // ------------------------------------------------------------- credentials

  listCredentials(typeSlug?: string): CredentialRecord[] {
    const all = [...this.credentials.values()];
    return typeSlug ? all.filter(c => c.credentialTypeSlug === typeSlug) : all;
  }

  getCredential(id: string): CredentialRecord | undefined {
    return this.credentials.get(id);
  }

  createCredential(input: {
    credentialTypeSlug: string;
    name: string;
    config: Record<string, unknown>;
    status?: string;
    /** Stable id — pass to keep a seeded credential's id fixed across restarts. */
    id?: string;
    durableCreds?: Record<string, unknown> | null;
  }): CredentialRecord {
    const ts = now();
    const record: CredentialRecord = {
      id: input.id ?? randomUUID(),
      tenantId: DEV_TENANT_ID,
      credentialTypeSlug: input.credentialTypeSlug,
      name: input.name,
      status: input.status ?? 'active',
      config: input.config,
      durableCreds: input.durableCreds ?? null,
      lastTestAt: null,
      lastTestOk: null,
      lastTestMessage: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.credentials.set(record.id, record);
    this.touch();
    return record;
  }

  updateCredential(id: string, patch: Partial<Pick<CredentialRecord, 'name' | 'config' | 'status' | 'durableCreds'>>): CredentialRecord | undefined {
    const record = this.credentials.get(id);
    if (!record) {
      return undefined;
    }
    if (patch.name !== undefined) {
      record.name = patch.name;
    }
    if (patch.config !== undefined) {
      record.config = patch.config;
    }
    if (patch.status !== undefined) {
      record.status = patch.status;
    }
    if (patch.durableCreds !== undefined) {
      record.durableCreds = patch.durableCreds;
    }
    record.updatedAt = now();
    this.touch();
    return record;
  }

  /**
   * Records the outcome of a credential test. The service persists this on the
   * record and reports it back from `POST /credentials/{id}/test`.
   */
  recordCredentialTest(id: string, result: { ok: boolean; message?: string | null }): CredentialRecord | undefined {
    const record = this.credentials.get(id);
    if (!record) {
      return undefined;
    }
    record.lastTestAt = now();
    record.lastTestOk = result.ok;
    record.lastTestMessage = result.message ?? null;
    this.touch();
    return record;
  }

  deleteCredential(id: string): boolean {
    const deleted = this.credentials.delete(id);
    if (deleted) {
      this.touch();
    }
    return deleted;
  }

  // ----------------------------------------------------------------- secrets

  listSecrets(): SecretRecord[] {
    return [...this.secrets.values()];
  }

  getSecret(key: string): SecretRecord | undefined {
    return this.secrets.get(key);
  }

  setSecret(key: string, value: string): SecretRecord {
    const existing = this.secrets.get(key);
    const ts = now();
    const record: SecretRecord = {
      key,
      value,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };
    this.secrets.set(key, record);
    this.touch();
    return record;
  }

  deleteSecret(key: string): boolean {
    const deleted = this.secrets.delete(key);
    if (deleted) {
      this.touch();
    }
    return deleted;
  }

  // --------------------------------------------------------------- workflows

  listWorkflows(): WorkflowRecord[] {
    return [...this.workflows.values()];
  }

  getWorkflow(id: number): WorkflowRecord | undefined {
    return this.workflows.get(id);
  }

  createWorkflow(input: {
    name: string;
    blob: Record<string, unknown>;
    blobDefinitionVersion?: string;
    description?: string | null;
    active?: boolean;
    executionMode?: string;
  }): WorkflowRecord {
    const ts = now();
    const record: WorkflowRecord = {
      id: this.nextWorkflowId++,
      name: input.name,
      description: input.description ?? null,
      blob: input.blob,
      blobDefinitionVersion: input.blobDefinitionVersion ?? BLOB_DEFINITION_VERSION,
      active: input.active ?? true,
      executionMode: input.executionMode ?? EXECUTION_MODES[0],
      revision: 1,
      buildStatus: 'ready',
      createdAt: ts,
      updatedAt: ts,
    };
    this.workflows.set(record.id, record);
    this.touch();
    return record;
  }

  updateWorkflow(id: number, patch: Partial<Pick<WorkflowRecord, 'name' | 'description' | 'blob' | 'blobDefinitionVersion' | 'active' | 'executionMode' | 'buildStatus'>>): WorkflowRecord | undefined {
    const record = this.workflows.get(id);
    if (!record) {
      return undefined;
    }
    // Drop undefined so a partial PUT does not blank fields the caller omitted.
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    Object.assign(record, defined, { revision: record.revision + 1, updatedAt: now() });
    this.touch();
    return record;
  }

  deleteWorkflow(id: number): boolean {
    for (const trigger of this.triggers.values()) {
      if (trigger.workflowId === id) {
        this.triggers.delete(trigger.id);
      }
    }
    const deleted = this.workflows.delete(id);
    if (deleted) {
      this.touch();
    }
    return deleted;
  }

  // ---------------------------------------------------------------- triggers

  listTriggers(workflowId: number): TriggerRecord[] {
    return [...this.triggers.values()].filter(t => t.workflowId === workflowId);
  }

  getTrigger(id: string): TriggerRecord | undefined {
    return this.triggers.get(id);
  }

  createTrigger(input: {
    workflowId: number;
    type: string;
    name?: string | null;
    config?: Record<string, unknown>;
    active?: boolean;
    id?: string;
  }): TriggerRecord {
    const ts = now();
    const record: TriggerRecord = {
      id: input.id ?? randomUUID(),
      workflowId: input.workflowId,
      type: input.type,
      name: input.name ?? null,
      config: input.config ?? {},
      active: input.active ?? true,
      createdAt: ts,
      updatedAt: ts,
    };
    this.triggers.set(record.id, record);
    this.touch();
    return record;
  }

  replaceTrigger(id: string, input: { type: string; name?: string | null; config?: Record<string, unknown>; active?: boolean }): TriggerRecord | undefined {
    const record = this.triggers.get(id);
    if (!record) {
      return undefined;
    }
    record.type = input.type;
    record.name = input.name ?? null;
    record.config = input.config ?? {};
    record.active = input.active ?? true;
    record.updatedAt = now();
    this.touch();
    return record;
  }

  deleteTrigger(id: string): boolean {
    const deleted = this.triggers.delete(id);
    if (deleted) {
      this.touch();
    }
    return deleted;
  }

  // ------------------------------------------------------------- persistence

  toSnapshot(): DevStoreSnapshot {
    return {
      schemaVersion: STORE_SCHEMA_VERSION,
      credentials: [...this.credentials.values()],
      secrets: [...this.secrets.values()],
      workflows: [...this.workflows.values()],
      triggers: [...this.triggers.values()],
      nextWorkflowId: this.nextWorkflowId,
    };
  }

  loadSnapshot(snapshot: DevStoreSnapshot): void {
    this.credentials = new Map(snapshot.credentials.map(c => [c.id, c]));
    this.secrets = new Map(snapshot.secrets.map(s => [s.key, s]));
    this.workflows = new Map(snapshot.workflows.map(w => [w.id, w]));
    this.triggers = new Map(snapshot.triggers.map(t => [t.id, t]));
    this.nextWorkflowId = snapshot.nextWorkflowId ?? Math.max(0, ...snapshot.workflows.map(w => w.id)) + 1;
  }

  /**
   * Overlays a snapshot on top of the current contents (upsert by id/key), used
   * to layer the persisted `.revenexx-dev/state.json` session over the freshly
   * applied committed seeds. State entries win over seed entries with the same
   * id/key; seed-only entries are preserved.
   */
  mergeSnapshot(snapshot: DevStoreSnapshot): void {
    for (const c of snapshot.credentials) {
      this.credentials.set(c.id, c);
    }
    for (const s of snapshot.secrets) {
      this.secrets.set(s.key, s);
    }
    for (const w of snapshot.workflows) {
      this.workflows.set(w.id, w);
    }
    for (const t of snapshot.triggers) {
      this.triggers.set(t.id, t);
    }
    this.nextWorkflowId = Math.max(this.nextWorkflowId, snapshot.nextWorkflowId ?? 0, ...snapshot.workflows.map(w => w.id + 1));
  }
}
