import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hostExists, hostIsComplete, hostNeedsInstall, markHostInstalled, materializeHost, resolveHostDir, shippedHostDir } from '../src/preview/host.js';

/**
 * The preview host is the one part of the devkit that only ever runs on a
 * developer's machine, so nothing in CI exercises it by accident — these tests are
 * the only thing standing between a bad copy step and a `preview` that is broken
 * for every consumer.
 */

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'devkit-host-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * A stand-in for the shipped `preview-host/`, placed at `where`. Callers put it
 * under a path containing `node_modules` to reproduce the installed layout.
 */
function fixtureHost(where: string): string {
  mkdirSync(join(where, 'pages'), { recursive: true });
  mkdirSync(join(where, 'node_modules', 'left-over'), { recursive: true });
  writeFileSync(join(where, 'package.json'), JSON.stringify({ name: 'h', dependencies: { nuxt: '^4.0.0' } }));
  writeFileSync(join(where, 'nuxt.config.ts'), 'export default {}');
  writeFileSync(join(where, 'app.vue'), '<template><div /></template>');
  writeFileSync(join(where, 'pages', 'nodes.vue'), '<template><div /></template>');
  writeFileSync(join(where, 'node_modules', 'left-over', 'index.js'), 'module.exports = 1');
  return where;
}

function materialize(sourceDir: string, targetDir: string, extra: { force?: boolean; managed?: boolean } = {}) {
  return materializeHost({
    sourceDir,
    targetDir,
    integrationsApiUrl: 'http://localhost:3555/api/v1',
    ...extra,
  });
}

describe('materializeHost', () => {
  /**
   * The regression that matters most: in a real install the shipped host sits at
   * `…/node_modules/@revenexx/integrations-node-devkit/preview-host`. A copy filter
   * that tests the ABSOLUTE path rejects the source root itself, and `cpSync` then
   * copies nothing — without throwing. `preview` reported "Preview host ready",
   * ran `npm install` in an empty directory and died on a missing package.json.
   */
  it('copies the host even when the devkit itself lives under node_modules', () => {
    const source = fixtureHost(join(tmp, 'repo/node_modules/@revenexx/integrations-node-devkit/preview-host'));
    const target = join(tmp, 'cache/0.3.0');

    materialize(source, target, { managed: true });

    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(existsSync(join(target, 'nuxt.config.ts'))).toBe(true);
    expect(existsSync(join(target, 'app.vue'))).toBe(true);
    expect(existsSync(join(target, 'pages/nodes.vue'))).toBe(true);
  });

  it('leaves a node_modules inside the host behind', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'out');

    materialize(source, target, { managed: true });

    expect(existsSync(join(target, 'app.vue'))).toBe(true);
    expect(existsSync(join(target, 'node_modules'))).toBe(false);
  });

  it('writes a .env carrying the mock API url', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'out');

    materializeHost({ sourceDir: source, targetDir: target, integrationsApiUrl: 'http://localhost:4000/api/v1', managed: true });

    const env = readFileSync(join(target, '.env'), 'utf-8');
    expect(env).toContain('NUXT_PUBLIC_INTEGRATIONS_API=http://localhost:4000/api/v1');
    expect(env).toContain('NUXT_PUBLIC_DEV_TOKEN=dev');
  });

  it('refreshes the managed .env when the port changed, and reports the copy was reused', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'out');

    expect(materialize(source, target, { managed: true }).copied).toBe(true);
    const second = materializeHost({ sourceDir: source, targetDir: target, integrationsApiUrl: 'http://localhost:9999/api/v1', managed: true });

    expect(second.copied).toBe(false);
    expect(readFileSync(join(target, '.env'), 'utf-8')).toContain('http://localhost:9999/api/v1');
  });

  it('keeps a hand-edited .env in an unmanaged copy', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'my-preview');

    materialize(source, target, { managed: false });
    writeFileSync(join(target, '.env'), 'NUXT_PUBLIC_INTEGRATIONS_API=http://my-own-host/api/v1\n', 'utf-8');
    materialize(source, target, { managed: false });

    expect(readFileSync(join(target, '.env'), 'utf-8')).toBe('NUXT_PUBLIC_INTEGRATIONS_API=http://my-own-host/api/v1\n');
  });

  /**
   * `hostExists` cannot tell a finished copy from the first two files of an
   * interrupted one. For the managed cache that half-host must be redone; for a
   * `--dir` copy it must not, because re-copying would overwrite the user's edits.
   */
  it('redoes an interrupted copy in the managed cache but not in a --dir copy', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));

    for (const [managed, expected] of [
      [true, true],
      [false, false],
    ] as const) {
      const target = join(tmp, `out-${String(managed)}`);
      materialize(source, target, { managed });
      // Simulate the interruption: defining files present, the rest missing.
      rmSync(join(target, '.devkit-copy-complete'), { force: true });
      rmSync(join(target, 'app.vue'), { force: true });

      materialize(source, target, { managed });
      expect(existsSync(join(target, 'app.vue')), `managed=${managed}`).toBe(expected);
    }
  });

  it('re-copies on force', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'out');

    materialize(source, target, { managed: true });
    rmSync(join(target, 'app.vue'), { force: true });

    expect(materialize(source, target, { managed: true, force: true }).copied).toBe(true);
    expect(existsSync(join(target, 'app.vue'))).toBe(true);
  });
});

describe('hostExists / hostIsComplete', () => {
  it('separates "looks like a host" from "we finished copying it"', () => {
    const target = join(tmp, 'out');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'package.json'), '{}');
    writeFileSync(join(target, 'nuxt.config.ts'), '');

    expect(hostExists(target)).toBe(true);
    expect(hostIsComplete(target)).toBe(false);

    materialize(fixtureHost(join(tmp, 'src/preview-host')), target, { managed: true });
    expect(hostIsComplete(target)).toBe(true);
  });
});

describe('hostNeedsInstall', () => {
  function installedHost(deps: Record<string, string>): string {
    const dir = join(tmp, 'host');
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'h', dependencies: deps }));
    return dir;
  }

  it('is true before anything is installed', () => {
    expect(hostNeedsInstall(installedHost({ nuxt: '^4.0.0' }))).toBe(true);
  });

  it('is false once the current manifest has been installed', () => {
    const dir = installedHost({ nuxt: '^4.0.0' });
    markHostInstalled(dir);
    expect(hostNeedsInstall(dir)).toBe(false);
  });

  /**
   * The bug this marker exists for: `--force` rewrote package.json with new pins,
   * an `existsSync(node_modules)` check reported "installed", and Nuxt booted
   * against the old tree.
   */
  it('is true again when the pins changed', () => {
    const dir = installedHost({ nuxt: '^4.0.0' });
    markHostInstalled(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'h', dependencies: { nuxt: '^5.0.0' } }));
    expect(hostNeedsInstall(dir)).toBe(true);
  });

  it('is true when node_modules was removed even though the marker survived', () => {
    const dir = installedHost({ nuxt: '^4.0.0' });
    markHostInstalled(dir);
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
    expect(hostNeedsInstall(dir)).toBe(true);
  });

  it('ignores changes outside the dependency blocks', () => {
    const dir = installedHost({ nuxt: '^4.0.0' });
    markHostInstalled(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'renamed', scripts: { dev: 'x' }, dependencies: { nuxt: '^4.0.0' } }));
    expect(hostNeedsInstall(dir)).toBe(false);
  });
});

describe('resolveHostDir', () => {
  const original = process.env.XDG_CACHE_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = original;
  });

  it('keys the directory by devkit version under XDG_CACHE_HOME', () => {
    process.env.XDG_CACHE_HOME = '/xdg';
    expect(resolveHostDir({ version: '0.3.0' })).toBe('/xdg/revenexx/devkit-preview/0.3.0');
  });

  it('falls back to ~/.cache', () => {
    delete process.env.XDG_CACHE_HOME;
    expect(resolveHostDir({ version: '0.3.0' })).toMatch(/\.cache\/revenexx\/devkit-preview\/0\.3\.0$/);
  });

  it('lets an explicit cacheRoot win', () => {
    process.env.XDG_CACHE_HOME = '/xdg';
    expect(resolveHostDir({ version: '1.2.3', cacheRoot: '/elsewhere' })).toBe('/elsewhere/revenexx/devkit-preview/1.2.3');
  });
});

describe('shippedHostDir', () => {
  /**
   * Guards the packaging assumption: `preview-host/` must sit where the walk-up
   * from this module can reach it, and must be listed in package.json `files` or
   * the published package has no host to copy.
   */
  it('finds the real preview-host shipped in this package', () => {
    const dir = shippedHostDir();
    expect(existsSync(join(dir, 'nuxt.config.ts'))).toBe(true);
    expect(existsSync(join(dir, 'package.json'))).toBe(true);
    expect(existsSync(join(dir, 'pages', 'nodes.vue'))).toBe(true);
  });
});
