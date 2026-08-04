import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hostBuildDir,
  hostDotenvName,
  hostExists,
  hostIsComplete,
  hostNeedsInstall,
  hostViteCacheDir,
  markHostInstalled,
  materializeHost,
  resolveHostDir,
  shippedHostDir,
  withInstallLock,
} from '../src/preview/host.js';

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

  /**
   * The managed dotenv file is per repo, and that is not tidiness: Nuxt watches its
   * dotenv file and respawns when it changes, so one shared `.env` — rewritten every
   * run because it carries the mock port — restarted every other preview using this
   * directory. The dedupe is mtime-based, so identical content did not help.
   */
  it('writes the managed dotenv under the name it was given, leaving .env alone', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'out');

    materializeHost({ sourceDir: source, targetDir: target, integrationsApiUrl: 'http://localhost:3556/api/v1', dotenvName: '.env.abc123', managed: true });

    expect(readFileSync(join(target, '.env.abc123'), 'utf-8')).toContain('NUXT_PUBLIC_INTEGRATIONS_API=http://localhost:3556/api/v1');
    expect(existsSync(join(target, '.env'))).toBe(false);
  });

  it('tells the reader of a per-repo dotenv how to run the host by hand', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'out');

    materializeHost({ sourceDir: source, targetDir: target, integrationsApiUrl: 'http://x/api/v1', dotenvName: '.env.abc123', managed: true });

    expect(readFileSync(join(target, '.env.abc123'), 'utf-8')).toContain('npm run dev -- --dotenv .env.abc123');
  });

  it("does not disturb another repo's dotenv file in the shared directory", () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'out');

    materializeHost({ sourceDir: source, targetDir: target, integrationsApiUrl: 'http://localhost:3555/api/v1', dotenvName: '.env.aaa', managed: true });
    const untouched = readFileSync(join(target, '.env.aaa'), 'utf-8');
    materializeHost({ sourceDir: source, targetDir: target, integrationsApiUrl: 'http://localhost:3556/api/v1', dotenvName: '.env.bbb', managed: true });

    expect(readFileSync(join(target, '.env.aaa'), 'utf-8')).toBe(untouched);
    expect(readFileSync(join(target, '.env.bbb'), 'utf-8')).toContain(':3556');
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

  /**
   * Version-keying the cache directory makes a stale host impossible between
   * releases, but says nothing while the version stands still — so a change to
   * `preview-host/` used to be invisible to everyone already holding a copy,
   * including this repo's own developers testing that very change.
   */
  it('re-copies the managed host when the shipped source changed', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'out');

    materialize(source, target, { managed: true });
    writeFileSync(join(source, 'nuxt.config.ts'), 'export default { vite: {} }');

    expect(materialize(source, target, { managed: true }).copied).toBe(true);
    expect(readFileSync(join(target, 'nuxt.config.ts'), 'utf-8')).toBe('export default { vite: {} }');
  });

  it('reuses the copy when the source is unchanged', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'out');

    materialize(source, target, { managed: true });
    expect(materialize(source, target, { managed: true }).copied).toBe(false);
  });

  /**
   * The install is keyed separately (on the manifest), so picking up a changed host
   * file must not cost a 500 MB reinstall.
   */
  it('keeps node_modules and the install marker across a source-change re-copy', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'out');

    materialize(source, target, { managed: true });
    mkdirSync(join(target, 'node_modules'), { recursive: true });
    markHostInstalled(target);
    writeFileSync(join(source, 'app.vue'), '<template><span /></template>');

    materialize(source, target, { managed: true });
    expect(hostNeedsInstall(target)).toBe(false);
  });

  /** A user's `--dir` copy is theirs; a devkit upgrade must not overwrite their edits. */
  it('does not re-copy over an unmanaged copy when the source changed', () => {
    const source = fixtureHost(join(tmp, 'src/preview-host'));
    const target = join(tmp, 'my-preview');

    materialize(source, target, { managed: false });
    writeFileSync(join(target, 'app.vue'), '<template><em>mine</em></template>');
    writeFileSync(join(source, 'nuxt.config.ts'), 'export default { changed: true }');

    expect(materialize(source, target, { managed: false }).copied).toBe(false);
    expect(readFileSync(join(target, 'app.vue'), 'utf-8')).toContain('mine');
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

/**
 * One host directory serves every node package on the machine, so everything that
 * must not be shared has to be keyed by the consumer. The Vite cache is the one that
 * was missing, and its absence was worse than sharing: Vite's configHash covers the
 * `#build` alias — the per-repo build dir — so two repos each judged the other's
 * cache stale and deleted it while it was being served from.
 */
describe('per-repo paths inside the shared host', () => {
  it.each([
    ['build dir', hostBuildDir],
    ['vite cache dir', hostViteCacheDir],
  ])('gives each consumer its own %s', (_label, fn) => {
    expect(fn('/host', '/repos/a')).not.toBe(fn('/host', '/repos/b'));
  });

  it.each([
    ['build dir', hostBuildDir],
    ['vite cache dir', hostViteCacheDir],
  ])('keeps the %s stable across runs, so the cache pays off', (_label, fn) => {
    expect(fn('/host', '/repos/a')).toBe(fn('/host', '/repos/a'));
  });

  it('keeps the two apart from each other', () => {
    expect(hostBuildDir('/host', '/repos/a')).not.toBe(hostViteCacheDir('/host', '/repos/a'));
  });

  it('places both inside the host directory, matching the generated .gitignore', () => {
    expect(hostBuildDir('/host', '/repos/a')).toMatch(/^\/host\/\.nuxt-[0-9a-f]{12}$/);
    expect(hostViteCacheDir('/host', '/repos/a')).toMatch(/^\/host\/\.vite-[0-9a-f]{12}$/);
  });

  it('names the dotenv file per consumer as well', () => {
    expect(hostDotenvName('/repos/a')).toMatch(/^\.env\.[0-9a-f]{12}$/);
    expect(hostDotenvName('/repos/a')).not.toBe(hostDotenvName('/repos/b'));
  });

  it('derives all three from the same consumer key', () => {
    const key = hostDotenvName('/repos/a').replace('.env.', '');
    expect(hostBuildDir('/host', '/repos/a')).toContain(key);
    expect(hostViteCacheDir('/host', '/repos/a')).toContain(key);
  });
});

/**
 * Two repos previewing for the first time after a devkit upgrade both decide they
 * need to install, into the same directory. Without a lock that is a race whose
 * prize is a half-written dependency tree.
 */
describe('withInstallLock', () => {
  const lock = () => join(tmp, '.devkit-install.lock');

  it('runs the install and releases the lock', async () => {
    let ran = false;
    const result = await withInstallLock(tmp, async () => {
      expect(existsSync(lock())).toBe(true);
      ran = true;
      return 'done';
    });

    expect([ran, result]).toEqual([true, 'done']);
    expect(existsSync(lock())).toBe(false);
  });

  it('releases the lock even when the install fails', async () => {
    await expect(withInstallLock(tmp, async () => Promise.reject(new Error('npm exploded')))).rejects.toThrow('npm exploded');
    expect(existsSync(lock())).toBe(false);
  });

  /**
   * After queuing behind another process, the install we were waiting for has
   * usually already done the work — re-checking is what turns the wait into a win
   * rather than a duplicate 500 MB download.
   */
  it('skips the install when the wait made it unnecessary', async () => {
    let ran = false;
    const result = await withInstallLock(
      tmp,
      async () => {
        ran = true;
      },
      { needsInstall: () => false },
    );

    expect([ran, result]).toEqual([false, null]);
    expect(existsSync(lock())).toBe(false);
  });

  /**
   * A lock left behind by a killed process must not make the cache directory
   * permanently uninstallable.
   */
  it('takes over a lock whose holder is gone', async () => {
    writeFileSync(lock(), '999001\n2026-08-04T10:00:00.000Z\n');

    await expect(withInstallLock(tmp, async () => 'installed', { isAlive: () => false })).resolves.toBe('installed');
    expect(existsSync(lock())).toBe(false);
  });

  it('waits for a live holder and gives up with an actionable message', async () => {
    writeFileSync(lock(), `${process.pid}\n2026-08-04T10:00:00.000Z\n`);
    const logged: string[] = [];

    await expect(
      withInstallLock(tmp, async () => 'installed', {
        isAlive: () => true,
        timeoutMs: 0,
        pollMs: 1,
        log: msg => logged.push(msg),
      }),
    ).rejects.toThrow(new RegExp(`delete ${lock().replace(/[.]/g, '\\.')}`));

    expect(logged.join('\n')).toContain(`PID ${process.pid}`);
    // The holder's lock is left in place — it is not ours to remove.
    expect(existsSync(lock())).toBe(true);
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
