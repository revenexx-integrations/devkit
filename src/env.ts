import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `.env` loading for the CLI.
 *
 * Seeds reference secrets as `${VAR}` and {@link interpolateEnv} resolves those
 * from `process.env`, so without this the documented workflow — commit the
 * reference, keep the value in `.env` — only worked if the developer exported
 * the variables by hand.
 *
 * Loading happens before option parsing, because the CLI reads `PORT` for its
 * default port; a `.env` that sets `PORT` would otherwise be read too late.
 *
 * `process.loadEnvFile` deliberately does not overwrite variables that are
 * already set, so a shell-provided value always beats the file:
 *
 *   REVENEXX_DEV_API_KEY=… npm run preview
 *
 * The flag is `--env`, *not* `--env-file`: Node reserves `--env-file` and
 * `--env-file-if-exists` and acts on them wherever they appear, including after
 * the script path. `node cli.js --env-file missing` therefore dies inside Node
 * with exit code 9 before this module is ever reached, so the devkit cannot own
 * that name. {@link nodeOwnedEnvFlag} spots the mistake and explains it.
 */

/** Minimum Node version shipping `process.loadEnvFile`. */
export const ENV_FILE_MIN_NODE = '20.12';

/** Flags Node itself consumes, positionally, and which the devkit must not reuse. */
const NODE_OWNED_FLAGS = ['--env-file', '--env-file-if-exists'];

export interface EnvFileChoice {
  /** Absolute path to load, or `null` when `--no-env` disabled loading. */
  path: string | null;
  /** True when the file was named with `--env` rather than defaulted to. */
  explicit: boolean;
}

/**
 * Returns the Node-owned env flag present in `argv`, if any. Node has already
 * acted on it by the time the CLI runs — this exists only so the CLI can say so
 * instead of leaving the user wondering why `--env-file` behaved oddly.
 */
export function nodeOwnedEnvFlag(argv: string[]): string | null {
  return NODE_OWNED_FLAGS.find(flag => argv.includes(flag) || argv.some(arg => arg.startsWith(`${flag}=`))) ?? null;
}

/** Decides which env file to load. Pure — touches neither disk nor `process.env`. */
export function resolveEnvFile(argv: string[], cwd: string = process.cwd()): EnvFileChoice {
  if (argv.includes('--no-env')) {
    return { path: null, explicit: false };
  }
  const flag = argv.indexOf('--env');
  if (flag === -1) {
    return { path: resolve(cwd, '.env'), explicit: false };
  }
  const value = argv[flag + 1];
  if (!value || value.startsWith('-')) {
    throw new Error('--env requires a path.');
  }
  return { path: resolve(cwd, value), explicit: true };
}

export interface LoadEnvFileOptions {
  cwd?: string;
  warn?: (message: string) => void;
}

/**
 * Loads the env file chosen by {@link resolveEnvFile} into `process.env` and
 * returns its path, or `null` when nothing was loaded.
 *
 * A missing *default* `.env` is fine — most packages do not have one. A file
 * asked for by name and missing is an error: ignoring it would hide a typo and
 * resurface much later as a puzzling `Seed references ${X}` failure.
 */
export function loadEnvFile(argv: string[], options: LoadEnvFileOptions = {}): string | null {
  const { cwd = process.cwd(), warn = (message: string) => console.warn(message) } = options;

  const nodeFlag = nodeOwnedEnvFlag(argv);
  if (nodeFlag) {
    warn(`Note: ${nodeFlag} is a Node flag and Node has already applied it. The devkit's own flag is --env <path>.`);
  }

  const { path, explicit } = resolveEnvFile(argv, cwd);
  if (!path) {
    return null;
  }
  if (!existsSync(path)) {
    if (explicit) {
      throw new Error(`--env: ${path} does not exist.`);
    }
    return null;
  }
  // npm's `engines` field is advisory, so an old runtime reaches this far.
  if (typeof process.loadEnvFile !== 'function') {
    warn(`Ignoring ${path}: env-file support needs Node >= ${ENV_FILE_MIN_NODE} (running ${process.version}).`);
    return null;
  }

  process.loadEnvFile(path);
  return path;
}
