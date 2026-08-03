import type { ICredentialDescription, INodeDescription, ITemplateDescription } from '@revenexx/integrations-node-sdk';
import { MANIFEST_VERSION } from '@revenexx/integrations-node-sdk';
import type { CredentialRecord, SecretRecord, TriggerRecord, WorkflowRecord } from './store.js';

/**
 * Maps internal records + manifest descriptions to the exact JSON shapes the
 * production Laravel `/api/v1` surface returns, so the Cockpit UI consumes the
 * mock API without any awareness that it is mocked.
 */

export function hasDynamicOptions(desc: INodeDescription): boolean {
  return (desc.config ?? []).some(f => f.dynamic === true);
}

export function hasDynamicSchema(desc: INodeDescription): boolean {
  return (desc.config ?? []).some(f => f.type === 'dynamic-schema');
}

export function hasDynamicOutputs(desc: INodeDescription): boolean {
  return (desc.outputs ?? []).some(o => o.resolveOutputs === true);
}

export function nodeToApi(desc: INodeDescription): Record<string, unknown> {
  const [namespace] = desc.slug.split(':');
  return {
    name: desc.name,
    namespace: namespace ?? null,
    slug: desc.slug,
    version: desc.version,
    manifest_version: MANIFEST_VERSION,
    manifest: desc,
    has_dynamic_options: hasDynamicOptions(desc),
    has_dynamic_schema: hasDynamicSchema(desc),
    has_dynamic_outputs: hasDynamicOutputs(desc),
    created_at: null,
    updated_at: null,
  };
}

export function credentialTypeToApi(desc: ICredentialDescription): Record<string, unknown> {
  return {
    slug: desc.slug,
    version: desc.version,
    name: desc.name,
    description: desc.description ?? null,
    icon: desc.icon ?? null,
    auth_kind: desc.authKind,
    fields: desc.fields,
  };
}

/** Projects a credential instance to its masked public API shape (no secrets). */
export function credentialInstanceToApi(record: CredentialRecord, type: ICredentialDescription | undefined): Record<string, unknown> {
  const secretKeys = new Set((type?.fields ?? []).filter(f => f.type === 'secret').map(f => f.key));
  const knownKeys = new Set((type?.fields ?? []).map(f => f.key));
  const publicConfig: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record.config)) {
    // Only surface known, non-secret fields; drop everything else defensively.
    if (knownKeys.has(key) && !secretKeys.has(key)) {
      publicConfig[key] = value;
    }
  }
  return {
    id: record.id,
    tenant_id: record.tenantId,
    credential_type_slug: record.credentialTypeSlug,
    name: record.name,
    status: record.status,
    public_config: publicConfig,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function secretToApi(record: SecretRecord): Record<string, unknown> {
  return {
    key: record.key,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function workflowToApi(record: WorkflowRecord): Record<string, unknown> {
  return {
    id: record.id,
    name: record.name,
    definition: record.definition,
    build_status: record.buildStatus,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function triggerToApi(record: TriggerRecord): Record<string, unknown> {
  return {
    handle: record.id,
    id: record.id,
    workflow_id: record.workflowId,
    type: record.type,
    name: record.name,
    config: record.config,
    active: record.active,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function templateSummaryToApi(t: ITemplateDescription): Record<string, unknown> {
  return {
    slug: t.slug,
    version: t.version,
    category: t.category,
    level: t.level,
    name: t.name,
    shortDescription: t.shortDescription ?? null,
    description: t.description ?? null,
    icon: t.icon ?? null,
    industries: t.industries ?? [],
    vendors: t.vendors ?? [],
    triggerTypes: (t.triggers ?? []).map(tr => tr.type),
  };
}

export function templateFullToApi(t: ITemplateDescription): Record<string, unknown> {
  return {
    ...templateSummaryToApi(t),
    blobVersion: t.blobVersion,
    definition: t.definition,
    triggers: t.triggers ?? [],
  };
}
