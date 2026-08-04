import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnvFile, nodeOwnedEnvFlag, resolveEnvFile } from '../src/index.js';

/** Vars the tests write into the real `process.env`; removed again afterwards. */
const TOUCHED = ['DEVKIT_TEST_A', 'DEVKIT_TEST_B', 'DEVKIT_TEST_SHELL'];

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'devkit-env-'));
  dirs.push(dir);
  return dir;
}

/** Creates a directory holding the given env files, keyed by filename. */
function envDir(files: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents);
  }
  return dir;
}

afterEach(() => {
  for (const key of TOUCHED) {
    delete process.env[key];
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveEnvFile', () => {
  it('defaults to .env in the working directory', () => {
    expect(resolveEnvFile([], '/pkg')).toEqual({ path: resolve('/pkg', '.env'), explicit: false });
  });

  it('replaces the default .env with the file named by --env', () => {
    expect(resolveEnvFile(['--env', 'config/dev.env'], '/pkg')).toEqual({
      path: resolve('/pkg', 'config/dev.env'),
      explicit: true,
      raw: 'config/dev.env',
    });
  });

  it('takes the last --env when the flag is repeated, as the other options do', () => {
    expect(resolveEnvFile(['--env', 'one.env', '--env', 'two.env'], '/pkg')).toEqual({
      path: resolve('/pkg', 'two.env'),
      explicit: true,
      raw: 'two.env',
    });
  });

  it('disables loading for --no-env, which wins over --env', () => {
    expect(resolveEnvFile(['--no-env'], '/pkg').path).toBeNull();
    expect(resolveEnvFile(['--env', 'a.env', '--no-env'], '/pkg').path).toBeNull();
  });

  it('rejects --env without a path, rather than swallowing the next flag', () => {
    expect(() => resolveEnvFile(['--env'], '/pkg')).toThrow(/requires a path/);
    expect(() => resolveEnvFile(['--env', '--no-ui'], '/pkg')).toThrow(/requires a path/);
    // Also when the malformed occurrence is not the last one.
    expect(() => resolveEnvFile(['--env', '--env', 'ok.env'], '/pkg')).toThrow(/requires a path/);
  });

  it("ignores Node's own --env-file, which must not be mistaken for --env", () => {
    // Node consumes --env-file itself; treating it as ours would load the wrong
    // file and mask the fact that Node already acted on it.
    expect(resolveEnvFile(['--env-file', 'theirs.env'], '/pkg')).toEqual({
      path: resolve('/pkg', '.env'),
      explicit: false,
    });
  });
});

describe('nodeOwnedEnvFlag', () => {
  it('detects the flags Node reserves, in both spaced and = form', () => {
    expect(nodeOwnedEnvFlag(['--env-file', 'a.env'])).toBe('--env-file');
    expect(nodeOwnedEnvFlag(['--env-file=a.env'])).toBe('--env-file');
    expect(nodeOwnedEnvFlag(['--env-file-if-exists', 'a.env'])).toBe('--env-file-if-exists');
  });

  it("does not fire for the devkit's own flags", () => {
    expect(nodeOwnedEnvFlag(['--env', 'a.env'])).toBeNull();
    expect(nodeOwnedEnvFlag(['--no-env'])).toBeNull();
    expect(nodeOwnedEnvFlag([])).toBeNull();
  });
});

describe('loadEnvFile', () => {
  it('loads variables from the default .env and returns its path', () => {
    const dir = envDir({ '.env': 'DEVKIT_TEST_A=from_file\nDEVKIT_TEST_B=second\n' });

    expect(loadEnvFile([], { cwd: dir })).toBe(join(dir, '.env'));
    expect(process.env.DEVKIT_TEST_A).toBe('from_file');
    expect(process.env.DEVKIT_TEST_B).toBe('second');
  });

  it('leaves an already-set variable alone, so the shell beats the file', () => {
    process.env.DEVKIT_TEST_SHELL = 'from_shell';
    const dir = envDir({ '.env': 'DEVKIT_TEST_SHELL=from_file\nDEVKIT_TEST_A=from_file\n' });

    loadEnvFile([], { cwd: dir });

    expect(process.env.DEVKIT_TEST_SHELL).toBe('from_shell');
    // …while a variable the shell did not set still comes from the file.
    expect(process.env.DEVKIT_TEST_A).toBe('from_file');
  });

  it('loads only the file named by --env, leaving .env entirely unread', () => {
    const dir = envDir({
      '.env': 'DEVKIT_TEST_B=only_in_default\n',
      'custom.env': 'DEVKIT_TEST_A=named\n',
    });

    expect(loadEnvFile(['--env', 'custom.env'], { cwd: dir })).toBe(join(dir, 'custom.env'));
    expect(process.env.DEVKIT_TEST_A).toBe('named');
    // --env replaces the default outright — it does not layer on top of it.
    expect(process.env.DEVKIT_TEST_B).toBeUndefined();
  });

  it('loads the last --env when the flag is repeated', () => {
    const dir = envDir({
      'one.env': 'DEVKIT_TEST_A=one\n',
      'two.env': 'DEVKIT_TEST_B=two\n',
    });

    expect(loadEnvFile(['--env', 'one.env', '--env', 'two.env'], { cwd: dir })).toBe(join(dir, 'two.env'));
    expect(process.env.DEVKIT_TEST_B).toBe('two');
    expect(process.env.DEVKIT_TEST_A).toBeUndefined();
  });

  it('warns that Node already handled --env-file, and still loads the default .env', () => {
    const dir = envDir({ '.env': 'DEVKIT_TEST_A=from_default\n' });
    const warn = vi.fn();

    expect(loadEnvFile(['--env-file', 'theirs.env'], { cwd: dir, warn })).toBe(join(dir, '.env'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('--env <path>'));
  });

  it('ignores a missing default .env — most packages have none', () => {
    expect(loadEnvFile([], { cwd: tempDir() })).toBeNull();
  });

  it('throws for a missing file that was asked for by name, so a typo is not silent', () => {
    expect(() => loadEnvFile(['--env', 'nope.env'], { cwd: tempDir() })).toThrow(/does not exist/);
  });

  it('points a bare --env <name> at .env.<name> when that file is the one that exists', () => {
    // Laravel spells this `--env=yolo`; here the flag takes a path, so say so
    // instead of failing with a bare "does not exist".
    const dir = envDir({ '.env.yolo': 'DEVKIT_TEST_A=yolo\n' });

    expect(() => loadEnvFile(['--env', 'yolo'], { cwd: dir })).toThrow(/--env \.env\.yolo/);
  });

  it('applies nothing when the named file is missing, even if a .env sits next to it', () => {
    const dir = envDir({ '.env': 'DEVKIT_TEST_A=base\n' });

    expect(() => loadEnvFile(['--env', 'gone.env'], { cwd: dir })).toThrow(/does not exist/);
    // The named file replaced .env, so no fallback to it — and nothing was applied.
    expect(process.env.DEVKIT_TEST_A).toBeUndefined();
  });

  it('loads nothing for --no-env even when a .env is present', () => {
    const dir = envDir({ '.env': 'DEVKIT_TEST_A=from_file\n' });

    expect(loadEnvFile(['--no-env'], { cwd: dir })).toBeNull();
    expect(process.env.DEVKIT_TEST_A).toBeUndefined();
  });

  it('warns instead of crashing when the runtime predates process.loadEnvFile', () => {
    const dir = envDir({ '.env': 'DEVKIT_TEST_A=from_file\n' });
    const warn = vi.fn();
    const original = process.loadEnvFile;
    // npm's `engines` field is advisory, so Node < 20.12 can reach this code.
    (process as { loadEnvFile?: unknown }).loadEnvFile = undefined;

    try {
      expect(loadEnvFile([], { cwd: dir, warn })).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('20.12'));
      expect(process.env.DEVKIT_TEST_A).toBeUndefined();
    } finally {
      process.loadEnvFile = original;
    }
  });
});
