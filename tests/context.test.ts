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

  it('honours an injected AbortSignal', () => {
    const controller = new AbortController();
    const ctx = createMockContext({ signal: controller.signal });
    expect(ctx.signal).toBe(controller.signal);
  });
});
