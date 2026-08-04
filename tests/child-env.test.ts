import { describe, expect, it } from 'vitest';
import { previewChildEnv } from '../src/preview/child-env.js';

/**
 * The Nuxt child's environment is where two repos are kept apart. Every assertion
 * here corresponds to a failure that was invisible from the outside: a silently
 * relocated UI port, and two dev servers deleting each other's dependency cache.
 */

function env(base: NodeJS.ProcessEnv = {}) {
  return previewChildEnv({
    base,
    apiUrl: 'http://localhost:3556/api/v1',
    uiPort: 3001,
    buildDir: '/cache/0.3.0/.nuxt-abc123',
    viteCacheDir: '/cache/0.3.0/.vite-abc123',
  });
}

describe('previewChildEnv', () => {
  it('points the UI at the mock port that was actually bound', () => {
    expect(env().NUXT_PUBLIC_INTEGRATIONS_API).toBe('http://localhost:3556/api/v1');
  });

  /**
   * The regression that made paralleling impossible: Vite's cache dir hangs off
   * rootDir — the SHARED host — while its configHash covers the per-repo `#build`
   * alias. Without an explicit per-repo cacheDir, each dev server judged the other's
   * cache stale and `rm -rf`'d it mid-request.
   */
  it('gives the repo its own vite cache and build dir', () => {
    expect(env().DEVKIT_VITE_CACHE_DIR).toBe('/cache/0.3.0/.vite-abc123');
    expect(env().DEVKIT_NUXT_BUILD_DIR).toBe('/cache/0.3.0/.nuxt-abc123');
  });

  it('names the UI port instead of leaving Nuxt to pick one devkit cannot know', () => {
    expect(env().NUXT_PORT).toBe('3001');
  });

  /**
   * `PORT` is the mock's variable, but listhen reads it too — so `PORT=4000
   * preview` used to have both claim 4000, after which Nuxt relocated silently and
   * every URL devkit printed was wrong.
   */
  it('keeps the mock port out of the child environment entirely', () => {
    expect(env({ PORT: '4000' })).not.toHaveProperty('PORT');
    expect(env({ PORT: '4000' }).NUXT_PORT).toBe('3001');
  });

  it('passes the rest of the environment through', () => {
    expect(env({ HOME: '/home/dev', PATH: '/usr/bin' })).toMatchObject({ HOME: '/home/dev', PATH: '/usr/bin' });
  });

  it('defaults the dev token and tenant but lets the environment override them', () => {
    expect(env()).toMatchObject({ NUXT_PUBLIC_DEV_TOKEN: 'dev', NUXT_PUBLIC_DEV_TENANT: 'dev-tenant' });
    expect(env({ NUXT_PUBLIC_DEV_TENANT: 'acme' }).NUXT_PUBLIC_DEV_TENANT).toBe('acme');
  });
});
