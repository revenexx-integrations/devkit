import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

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
 * Exactly one file is ever loaded: `.env` by default, or the one named by
 * `--env`, which *replaces* the default rather than layering on top of it.
 * "Use this env file" is what the flag reads like, so leaving `.env` in play
 * would be the surprise. `--no-env` loads none.
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
 *
 * `--env` takes a path rather than Laravel's bare environment name, because it
 * mirrors Node's flag and because a path can point outside the package. A value
 * that looks like it was meant as a name still gets a pointed error — see
 * {@link missingFileMessage}.
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
  /** The `--env` value exactly as typed, kept for {@link missingFileMessage}. */
  raw?: string;
}

/**
 * Returns the Node-owned env flag present in `argv`, if any. Node has already
 * acted on it by the time the CLI runs — this exists only so the CLI can say so
 * instead of leaving the user wondering why `--env-file` behaved oddly.
 */
export function nodeOwnedEnvFlag(argv: string[]): string | null {
  return NODE_OWNED_FLAGS.find(flag => argv.includes(flag) || argv.some(arg => arg.startsWith(`${flag}=`))) ?? null;
}

/**
 * Decides which env file to load. Pure — touches neither disk nor `process.env`.
 *
 * A repeated `--env` resolves to the last one, matching every other option in
 * the CLI, whose parse loop simply overwrites. Every occurrence is still
 * validated, so a malformed earlier one is reported rather than skipped.
 */
export function resolveEnvFile(argv: string[], cwd: string = process.cwd()): EnvFileChoice {
  if (argv.includes('--no-env')) {
    return { path: null, explicit: false };
  }

  let named: EnvFileChoice | null = null;
  for (let i = 0; i < argv.length; i++) {
    // Strict equality: `--env-file` belongs to Node, and `--env-file=x` must
    // not be mistaken for a value-carrying `--env`.
    if (argv[i] !== '--env') {
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith('-')) {
      throw new Error('--env requires a path.');
    }
    named = { path: resolve(cwd, value), explicit: true, raw: value };
  }

  return named ?? { path: resolve(cwd, '.env'), explicit: false };
}

/**
 * Explains a named-but-missing env file. When the value looks like a Laravel
 * environment name and the matching `.env.<name>` is right there, say so — the
 * bare "does not exist" would leave the user re-reading the flag's docs.
 */
function missingFileMessage(choice: EnvFileChoice, cwd: string): string {
  const raw = choice.raw;
  if (raw && raw === basename(raw) && existsSync(resolve(cwd, `.env.${raw}`))) {
    return `--env: ${choice.path} does not exist. Did you mean --env .env.${raw}? The flag takes a path, not an environment name.`;
  }
  return `--env: ${choice.path} does not exist.`;
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
 * resurface much later as a puzzling `Seed references ${X}` failure. There is no
 * fallback to `.env` in that case, since naming a file replaces the default.
 */
export function loadEnvFile(argv: string[], options: LoadEnvFileOptions = {}): string | null {
  const { cwd = process.cwd(), warn = (message: string) => console.warn(message) } = options;

  const nodeFlag = nodeOwnedEnvFlag(argv);
  if (nodeFlag) {
    warn(`Note: ${nodeFlag} is a Node flag and Node has already applied it. The devkit's own flag is --env <path>.`);
  }

  const choice = resolveEnvFile(argv, cwd);
  if (!choice.path) {
    return null;
  }
  if (!existsSync(choice.path)) {
    if (choice.explicit) {
      throw new Error(missingFileMessage(choice, cwd));
    }
    return null;
  }
  // npm's `engines` field is advisory, so an old runtime reaches this far.
  if (typeof process.loadEnvFile !== 'function') {
    warn(`Ignoring ${choice.path}: env-file support needs Node >= ${ENV_FILE_MIN_NODE} (running ${process.version}).`);
    return null;
  }

  process.loadEnvFile(choice.path);
  return choice.path;
}
