import { describe, expect, it } from 'vitest';
import { allowPrivateTargets } from '../src/ssrf.js';

describe('allowPrivateTargets', () => {
  it('sets RVNXX_SSRF_ALLOW_PRIVATE when it is unset', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(allowPrivateTargets(env)).toBe(true);
    expect(env.RVNXX_SSRF_ALLOW_PRIVATE).toBe('1');
  });

  it('leaves a value the developer set alone, including 0', () => {
    const env: NodeJS.ProcessEnv = { RVNXX_SSRF_ALLOW_PRIVATE: '0' };
    expect(allowPrivateTargets(env)).toBe(false);
    expect(env.RVNXX_SSRF_ALLOW_PRIVATE).toBe('0');
  });
});
