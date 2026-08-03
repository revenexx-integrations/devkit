import { describe, expect, it } from 'vitest';
import { createAuthorContext } from '../src/testing/index.js';

describe('createAuthorContext', () => {
  it('exposes the partial config and locale', () => {
    const ctx = createAuthorContext({ category: 'orders' }, { locale: 'de' });
    expect(ctx.config).toEqual({ category: 'orders' });
    expect(ctx.locale).toBe('de');
  });

  it('resolves seeded secrets and credentials for dependent resolvers', async () => {
    const ctx = createAuthorContext({ credentials: 'bc-1' }, { credentials: { 'bc-1': { accessToken: 'tok' } }, secrets: { key: 'v' } });
    await expect(ctx.credentials.get('bc-1')).resolves.toEqual({ accessToken: 'tok' });
    await expect(ctx.secrets.get('key')).resolves.toBe('v');
  });

  it('defaults config to an empty object', () => {
    const ctx = createAuthorContext();
    expect(ctx.config).toEqual({});
  });
});
