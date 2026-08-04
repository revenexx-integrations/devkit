import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pidIsAlive } from '../src/preview/pid.js';
import { describePreview, type PreviewEntry, previewConflict, readLivePreviews, registerPreview, unregisterPreview } from '../src/preview/registry.js';

/**
 * The registry is what makes a second `preview` a decision instead of an accident.
 * Its failure modes are asymmetric: forgetting a live preview lets two dev servers
 * share a host directory, while remembering a dead one locks the directory forever.
 */

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'devkit-registry-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function entry(overrides: Partial<PreviewEntry> = {}): PreviewEntry {
  return {
    pid: 4242,
    cwd: '/repos/mailer-node',
    mockPort: 3555,
    uiPort: 3000,
    startedAt: '2026-08-04T10:00:00.000Z',
    ...overrides,
  };
}

const alive = () => true;
const dead = () => false;

describe('readLivePreviews', () => {
  it('is empty for a host dir nothing has run out of', () => {
    expect(readLivePreviews(tmp, alive)).toEqual([]);
  });

  it('returns a registered preview while its process lives', () => {
    registerPreview(tmp, entry());
    expect(readLivePreviews(tmp, alive)).toEqual([entry()]);
  });

  /**
   * A preview killed with SIGKILL never deregisters. If dead entries survived, the
   * directory would refuse every future preview — so reading prunes them.
   */
  it('drops and deletes an entry whose process is gone', () => {
    registerPreview(tmp, entry({ pid: 999_001 }));

    expect(readLivePreviews(tmp, dead)).toEqual([]);
    expect(existsSync(join(tmp, 'previews', '999001.json'))).toBe(false);
  });

  it('discards an unparseable entry rather than throwing', () => {
    mkdirSync(join(tmp, 'previews'), { recursive: true });
    writeFileSync(join(tmp, 'previews', '5.json'), 'not json');

    expect(readLivePreviews(tmp, alive)).toEqual([]);
    expect(existsSync(join(tmp, 'previews', '5.json'))).toBe(false);
  });

  it('keeps the live ones when only some processes died', () => {
    registerPreview(tmp, entry({ pid: 11, cwd: '/repos/a', startedAt: '2026-08-04T10:00:00.000Z' }));
    registerPreview(tmp, entry({ pid: 22, cwd: '/repos/b', startedAt: '2026-08-04T11:00:00.000Z' }));

    const live = readLivePreviews(tmp, pid => pid === 22);
    expect(live.map(e => e.cwd)).toEqual(['/repos/b']);
  });

  it('orders by start time, so the oldest preview is named first', () => {
    registerPreview(tmp, entry({ pid: 22, cwd: '/repos/late', startedAt: '2026-08-04T12:00:00.000Z' }));
    registerPreview(tmp, entry({ pid: 11, cwd: '/repos/early', startedAt: '2026-08-04T09:00:00.000Z' }));

    expect(readLivePreviews(tmp, alive).map(e => e.cwd)).toEqual(['/repos/early', '/repos/late']);
  });

  it('ignores files that are not entries', () => {
    mkdirSync(join(tmp, 'previews'), { recursive: true });
    writeFileSync(join(tmp, 'previews', 'README.txt'), 'hi');
    registerPreview(tmp, entry());

    expect(readLivePreviews(tmp, alive)).toHaveLength(1);
    expect(existsSync(join(tmp, 'previews', 'README.txt'))).toBe(true);
  });
});

describe('unregisterPreview', () => {
  it('removes only the named pid', () => {
    registerPreview(tmp, entry({ pid: 11 }));
    registerPreview(tmp, entry({ pid: 22 }));

    unregisterPreview(tmp, 11);
    expect(readLivePreviews(tmp, alive).map(e => e.pid)).toEqual([22]);
  });

  it('is a no-op when there is nothing to remove', () => {
    expect(() => unregisterPreview(tmp, 12_345)).not.toThrow();
  });
});

describe('pidIsAlive', () => {
  it('recognises this very process', () => {
    expect(pidIsAlive(process.pid)).toBe(true);
  });

  it.each([0, -1, Number.NaN])('rejects %j as a pid', pid => {
    expect(pidIsAlive(pid)).toBe(false);
  });
});

describe('previewConflict', () => {
  const ask = (running: PreviewEntry[], overrides: { cwd?: string; parallel?: boolean; force?: boolean } = {}) =>
    previewConflict(running, { cwd: '/repos/other-node', hostDir: '/cache/0.4.0', parallel: false, ...overrides });

  it('lets the first preview through', () => {
    expect(ask([])).toBeNull();
  });

  it('refuses a second preview and names the one holding the directory', () => {
    const message = ask([entry()]);
    expect(message).toContain('already running out of /cache/0.4.0');
    expect(message).toContain('mailer-node');
    expect(message).toContain('--parallel');
  });

  it('allows a second preview of a different repo with --parallel', () => {
    expect(ask([entry()], { parallel: true })).toBeNull();
  });

  /**
   * Build dir, Vite cache and dotenv file are all keyed by cwd, so two previews of
   * one package would compile into the same build and serve each other's output —
   * exactly the failure --parallel exists to make safe. So --parallel cannot license
   * it.
   */
  it('refuses a second preview of the same repo even with --parallel', () => {
    const message = ask([entry({ cwd: '/repos/mailer-node' })], { cwd: '/repos/mailer-node', parallel: true });
    expect(message).toContain('this very package');
    expect(message).toContain('even with --parallel');
  });

  /** --force reinstalls node_modules, which the running preview is executing out of. */
  it('refuses --force while any preview runs, even with --parallel', () => {
    expect(ask([entry()], { force: true, parallel: true })).toContain('--force');
  });

  it('allows --force when nothing is running', () => {
    expect(ask([], { force: true })).toBeNull();
  });
});

describe('describePreview', () => {
  it('names the repo and both ports, since that is what the user has to act on', () => {
    const line = describePreview(entry());
    expect(line).toContain('mailer-node');
    expect(line).toContain('PID 4242');
    expect(line).toContain(':3555');
    expect(line).toContain(':3000');
  });
});
