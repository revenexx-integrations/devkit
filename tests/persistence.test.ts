import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySeeds, DevStore, interpolateEnv, loadState, saveState } from '../src/index.js';

describe('interpolateEnv', () => {
  it('replaces ${VAR} references from the provided env', () => {
    const out = interpolateEnv({ a: 'x-${TOKEN}', nested: ['${TOKEN}'] }, { TOKEN: 'secret' });
    expect(out).toEqual({ a: 'x-secret', nested: ['secret'] });
  });

  it('throws for an unset referenced variable', () => {
    expect(() => interpolateEnv('${MISSING}', {})).toThrow(/MISSING/);
  });
});

describe('applySeeds', () => {
  it('seeds credentials and secrets with env interpolation and stable ids', () => {
    const store = new DevStore();
    applySeeds(
      store,
      {
        secrets: [{ key: 'api-key', value: '${API_KEY}' }],
        credentials: [{ id: 'cred-1', credentialTypeSlug: 'x:basic', name: 'Basic', config: { host: 'h', password: '${PW}' } }],
      },
      { API_KEY: 'k', PW: 'p' },
    );

    expect(store.getSecret('api-key')?.value).toBe('k');
    const cred = store.getCredential('cred-1');
    expect(cred?.config).toEqual({ host: 'h', password: 'p' });
  });
});

describe('state overlay', () => {
  it('saves, reloads and merges a snapshot over seeds; state wins by id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devkit-'));
    const file = join(dir, 'state.json');
    try {
      const store = new DevStore();
      applySeeds(store, { credentials: [{ id: 'cred-1', credentialTypeSlug: 'x:basic', name: 'Seed', config: {} }] });
      // Simulate an interactive edit + a new credential, then persist.
      store.updateCredential('cred-1', { name: 'Edited' });
      store.createCredential({ id: 'cred-2', credentialTypeSlug: 'x:basic', name: 'Session', config: {} });
      saveState(file, store.toSnapshot());

      // Fresh boot: seeds first (base), then overlay wins.
      const rebooted = new DevStore();
      applySeeds(rebooted, { credentials: [{ id: 'cred-1', credentialTypeSlug: 'x:basic', name: 'Seed', config: {} }] });
      const state = loadState(file);
      expect(state).not.toBeNull();
      rebooted.mergeSnapshot(state!);

      expect(rebooted.getCredential('cred-1')?.name).toBe('Edited');
      expect(rebooted.getCredential('cred-2')?.name).toBe('Session');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('discards a snapshot whose schemaVersion no longer matches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devkit-'));
    const file = join(dir, 'state.json');
    try {
      writeFileSync(file, JSON.stringify({ schemaVersion: 999, credentials: [], secrets: [], workflows: [], triggers: [], nextWorkflowId: 1 }));
      const warnings: string[] = [];
      expect(loadState(file, m => warnings.push(m))).toBeNull();
      expect(warnings[0]).toMatch(/schemaVersion/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
