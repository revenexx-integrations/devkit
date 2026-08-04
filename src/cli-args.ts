import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CliError } from './errors.js';
import { parsePort } from './ports.js';

/**
 * Argument parsing, kept apart from `cli.ts` so it can be tested.
 *
 * `cli.ts` runs `main()` on import, so anything reachable only from there is
 * unreachable from a test. This function is pure — it throws {@link CliError}
 * instead of calling `process.exit`, and reads the environment but never writes it.
 */

export interface CliOptions {
  entry: string;
  seedDir: string;
  stateFile: string;
  persist: boolean;
  port: number;
  /**
   * True when the port was named by the user (`--port` or `$PORT`). An explicit
   * port is honoured or reported as a conflict; only the default may relocate.
   */
  portExplicit: boolean;
  uiDir: string | null;
  serveUi: boolean;
  open: boolean;
  /** Explicit host directory from `--dir`; null means use the managed cache. */
  previewDir: string | null;
  /** Re-copy the host even when the target looks complete. */
  force: boolean;
  /** Allow a second preview alongside one that is already running. */
  parallel: boolean;
}

export const DEFAULT_PORT = 3555;

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): { command: string | null; options: CliOptions } {
  const cwd = process.cwd();
  const opts: CliOptions = {
    entry: '',
    seedDir: resolve(cwd, 'dev/seeds'),
    stateFile: resolve(cwd, '.revenexx-dev/state.json'),
    persist: true,
    port: env.PORT === undefined ? DEFAULT_PORT : parsePort(env.PORT, '$PORT'),
    portExplicit: env.PORT !== undefined,
    uiDir: null,
    serveUi: true,
    open: false,
    previewDir: null,
    force: false,
    parallel: false,
  };
  let command: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case 'reset':
        command = 'reset';
        break;
      case 'init-preview':
        command = 'init-preview';
        break;
      case 'preview':
        command = 'preview';
        break;
      case '--dir':
        opts.previewDir = resolve(cwd, argv[++i] ?? '');
        break;
      case '--force':
        opts.force = true;
        break;
      case '--parallel':
        opts.parallel = true;
        break;
      case '--entry':
        opts.entry = resolve(cwd, argv[++i] ?? '');
        break;
      case '--seed':
        opts.seedDir = resolve(cwd, argv[++i] ?? '');
        break;
      case '--state':
        opts.stateFile = resolve(cwd, argv[++i] ?? '');
        break;
      case '--no-persist':
        opts.persist = false;
        break;
      case '--port':
        // A missing or non-numeric value used to fall back to the default or reach
        // `listen(NaN)`; both hid a typo the user would rather be told about.
        opts.port = parsePort(argv[++i], '--port');
        opts.portExplicit = true;
        break;
      case '--ui':
        opts.uiDir = resolve(cwd, argv[++i] ?? '');
        break;
      case '--no-ui':
        opts.serveUi = false;
        break;
      case '--open':
        opts.open = true;
        break;
      // Both are consumed by loadEnvFile() before parsing; listed here so they
      // do not fall through to the unknown-option branch. A repeated `--env`
      // resolves to the last one, so each occurrence skips its own value.
      case '--env':
        i++;
        break;
      case '--no-env':
        break;
      case '--version':
      case '-v':
        command = 'version';
        break;
      default:
        // Node acts on `--env-file[-if-exists]` itself but still forwards it
        // here, so accept and skip it rather than rejecting the user's input.
        // loadEnvFile() has already pointed them at `--env`.
        if (arg?.startsWith('--env-file')) {
          if (!arg.includes('=')) {
            i++;
          }
          break;
        }
        if (arg?.startsWith('-')) {
          throw new CliError(`Unknown option: ${arg}`);
        }
    }
  }
  if (!opts.entry) {
    const src = resolve(cwd, 'src/index.ts');
    opts.entry = existsSync(src) ? src : resolve(cwd, 'dist/index.js');
  }
  return { command, options: opts };
}
