import { describe, expect, it } from 'vitest';
import { createMockContext } from '../src/testing/index.js';

describe('createMockContext', () => {
  it('returns seeded secrets and records the call', async () => {
    const ctx = createMockContext({ secrets: { apiKey: 's3cret' } });

    await expect(ctx.secrets.get('apiKey')).resolves.toBe('s3cret');
    expect(ctx.secrets.get).toHaveBeenCalledWith('apiKey');
  });

  it('falls back to a deterministic stub for unknown secret keys', async () => {
    const ctx = createMockContext();
    await expect(ctx.secrets.get('unknown')).resolves.toBe('secret-value-for-unknown');
  });

  it('returns seeded resolved credentials by instance id', async () => {
    const ctx = createMockContext({ credentials: { 'smtp-1': { host: 'mail', port: 587 } } });
    await expect(ctx.credentials.get('smtp-1')).resolves.toEqual({ host: 'mail', port: 587 });
  });

  it('rejects when secretsError / credentialsError are set', async () => {
    const boom = new Error('boom');
    const ctx = createMockContext({ secretsError: boom, credentialsError: boom });
    await expect(ctx.secrets.get('x')).rejects.toBe(boom);
    await expect(ctx.credentials.get('x')).rejects.toBe(boom);
  });

  it('seeds mappings that read back from both sides', async () => {
    const ctx = createMockContext({
      state: { mappings: { article: { 'pim:12345': 'erp:A-8891' } } },
    });

    await expect(ctx.state.mapping.get('article', 'pim:12345')).resolves.toBe('erp:A-8891');
    await expect(ctx.state.mapping.get('article', 'erp:A-8891', 'right')).resolves.toBe('pim:12345');
    await expect(ctx.state.mapping.get('article', 'pim:99999')).resolves.toBeNull();
  });

  it('remembers what the node wrote, so create-then-update can be tested in one run', async () => {
    const ctx = createMockContext();

    await ctx.state.mapping.put('article', 'pim:1', 'erp:A-1');

    await expect(ctx.state.mapping.get('article', 'pim:1')).resolves.toBe('erp:A-1');
    expect(ctx.state.mapping.put).toHaveBeenCalledWith('article', 'pim:1', 'erp:A-1');
  });

  it('grants a claim once and refuses it afterwards', async () => {
    const ctx = createMockContext();

    await expect(ctx.state.claim('orders', 'evt_1')).resolves.toBe(true);
    await expect(ctx.state.claim('orders', 'evt_1')).resolves.toBe(false);
    await expect(ctx.state.claim('orders', 'evt_2')).resolves.toBe(true);
  });

  it('treats a seeded claim as already held', async () => {
    const ctx = createMockContext({ state: { claims: { orders: ['evt_1'] } } });

    await expect(ctx.state.claim('orders', 'evt_1')).resolves.toBe(false);
  });

  it('refuses to re-point either side of a correlation, and takes the same pair again', async () => {
    const ctx = createMockContext({ state: { mappings: { article: { 'pim:1': 'erp:A-1' } } } });

    await expect(ctx.state.mapping.put('article', 'pim:1', 'erp:A-2')).rejects.toThrow(/already correlated with 'erp:A-1'/);
    await expect(ctx.state.mapping.put('article', 'pim:2', 'erp:A-1')).rejects.toThrow(/already correlated with 'pim:1'/);

    // Not a re-point: a node that puts unconditionally on every run stays green.
    await expect(ctx.state.mapping.put('article', 'pim:1', 'erp:A-1')).resolves.toBeUndefined();
  });

  it('refuses a claim window the store would not accept', async () => {
    const ctx = createMockContext();

    await expect(ctx.state.claim('orders', 'evt_1', { ttlSeconds: 0 })).rejects.toThrow(/between 1 and 31536000/);
    await expect(ctx.state.claim('orders', 'evt_1', { ttlSeconds: 31_536_001 })).rejects.toThrow(/between 1 and 31536000/);
    await expect(ctx.state.claim('orders', 'evt_1', { ttlSeconds: 60 })).resolves.toBe(true);
  });

  it('reads the committed cursor while the run that staged one is still going', async () => {
    const ctx = createMockContext({
      state: { cursors: { 'crm.customers': { '': { updatedAfter: '2026-08-01T00:00:00Z' } } } },
    });

    await expect(ctx.state.cursor.get('crm.customers')).resolves.toEqual({
      updatedAfter: '2026-08-01T00:00:00Z',
    });

    await ctx.state.cursor.set('crm.customers', { updatedAfter: '2026-08-26T10:00:00Z' });

    // Staged, not adopted: a run does not see its own watermark, and a run that
    // never completes leaves the previous one in place for the next.
    await expect(ctx.state.cursor.get('crm.customers')).resolves.toEqual({
      updatedAfter: '2026-08-01T00:00:00Z',
    });

    ctx.completeRun();

    await expect(ctx.state.cursor.get('crm.customers')).resolves.toEqual({
      updatedAfter: '2026-08-26T10:00:00Z',
    });
  });

  it('keeps partitions apart once a staged cursor is adopted', async () => {
    const ctx = createMockContext({
      state: { cursors: { 'crm.customers': { '': { updatedAfter: '2026-08-01T00:00:00Z' } } } },
    });

    await ctx.state.cursor.set('crm.customers', { updatedAfter: '2026-08-26T10:00:00Z' }, 'shop-de');
    ctx.completeRun();

    await expect(ctx.state.cursor.get('crm.customers', 'shop-de')).resolves.toEqual({
      updatedAfter: '2026-08-26T10:00:00Z',
    });
    await expect(ctx.state.cursor.get('crm.customers')).resolves.toEqual({
      updatedAfter: '2026-08-01T00:00:00Z',
    });
  });

  it('compares digests against what was seeded, and adopts a staged one on completion', async () => {
    const ctx = createMockContext({ state: { digests: { 'article.hash': { 'article:1': 'sha-abc' } } } });

    await expect(ctx.state.digest.unchanged('article.hash', 'article:1', 'sha-abc')).resolves.toBe(true);
    await expect(ctx.state.digest.unchanged('article.hash', 'article:1', 'sha-def')).resolves.toBe(false);

    await ctx.state.digest.set('article.hash', 'article:1', 'sha-def');
    // A digest counts only once the write it describes actually went through.
    await expect(ctx.state.digest.unchanged('article.hash', 'article:1', 'sha-def')).resolves.toBe(false);

    ctx.completeRun();
    await expect(ctx.state.digest.unchanged('article.hash', 'article:1', 'sha-def')).resolves.toBe(true);
  });

  it('rejects every state call when stateError is set', async () => {
    const boom = new Error('namespace is not in scope');
    const ctx = createMockContext({ stateError: boom });

    await expect(ctx.state.mapping.get('article', 'pim:1')).rejects.toBe(boom);
    await expect(ctx.state.claim('orders', 'evt_1')).rejects.toBe(boom);
    await expect(ctx.state.cursor.set('crm.customers', {})).rejects.toBe(boom);
  });

  it('honours an injected AbortSignal', () => {
    const controller = new AbortController();
    const ctx = createMockContext({ signal: controller.signal });
    expect(ctx.signal).toBe(controller.signal);
  });
});
