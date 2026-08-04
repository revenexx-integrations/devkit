import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type IsAlive, pidIsAlive } from './pid.js';

/**
 * Which previews are running out of a given host directory.
 *
 * One host directory is shared by every node package on the machine, so devkit has
 * to be able to answer "is someone else already using it?" — both to refuse a
 * second preview unless it was asked for, and to refuse a `--force` reinstall that
 * would swap `node_modules` out from under a running dev server.
 *
 * Stored as one file per pid rather than a single JSON document: two previews
 * starting at once would otherwise read-modify-write over each other, and the
 * failure mode of a lost registration is exactly the collision this prevents.
 */

const REGISTRY_DIR = 'previews';

export interface PreviewEntry {
  pid: number;
  /** The node package being previewed — what the user needs in order to recognise it. */
  cwd: string;
  mockPort: number;
  /**
   * The port the Nuxt child was told to use. Nuxt relocates on its own if it lost
   * the race for it, so this is the intended port, not a guaranteed one.
   */
  uiPort: number;
  startedAt: string;
}

/**
 * Live entries, with dead ones deleted as a side effect.
 *
 * Cleaning up on read is deliberate: a preview killed with SIGKILL never gets to
 * deregister, and a registry that only grows would refuse every future preview.
 */
export function readLivePreviews(hostDir: string, isAlive: IsAlive = pidIsAlive): PreviewEntry[] {
  const dir = join(hostDir, REGISTRY_DIR);
  if (!existsSync(dir)) {
    return [];
  }
  const live: PreviewEntry[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const path = join(dir, file);
    const entry = readEntry(path);
    if (entry && isAlive(entry.pid)) {
      live.push(entry);
    } else {
      // Unreadable or dead — either way it can never become valid again.
      rmSync(path, { force: true });
    }
  }
  return live.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function readEntry(path: string): PreviewEntry | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as PreviewEntry;
    return Number.isInteger(parsed?.pid) ? parsed : null;
  } catch {
    return null;
  }
}

export function registerPreview(hostDir: string, entry: PreviewEntry): void {
  const dir = join(hostDir, REGISTRY_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${entry.pid}.json`), `${JSON.stringify(entry, null, 2)}\n`, 'utf-8');
}

export function unregisterPreview(hostDir: string, pid: number = process.pid): void {
  rmSync(join(hostDir, REGISTRY_DIR, `${pid}.json`), { force: true });
}

/** One line per running preview, for the refusal message and the startup banner. */
export function describePreview(entry: PreviewEntry): string {
  return `${basename(entry.cwd)} (PID ${entry.pid}, mock :${entry.mockPort}, UI :${entry.uiPort}) — ${entry.cwd}`;
}

export interface ConflictOptions {
  /** The repo about to be previewed. */
  cwd: string;
  /** Whether `--parallel` was given. */
  parallel: boolean;
  /** Whether this run would reinstall the shared dependency tree. */
  force?: boolean;
  hostDir: string;
}

/**
 * Why this preview must not start, or null if it may.
 *
 * A pure function so the decision is testable — `preview` itself only turns the
 * message into a {@link CliError}. Three cases, in order of severity:
 */
export function previewConflict(running: PreviewEntry[], options: ConflictOptions): string | null {
  // Same repo twice: the build dir, Vite cache and dotenv file are all keyed by cwd,
  // so a second run would compile into the first one's build and serve its app. That
  // is the failure --parallel exists to make safe, so --parallel cannot license it.
  const sameRepo = running.find(entry => entry.cwd === options.cwd);
  if (sameRepo) {
    return [
      `A preview of this very package is already running: ${describePreview(sameRepo)}`,
      '',
      "Two previews of one package share a build directory and would serve each other's",
      'output, so this is refused even with --parallel. Stop that one first.',
    ].join('\n');
  }

  if (options.force && running.length > 0) {
    return `--force reinstalls the host's dependencies, which would pull node_modules out from under the preview still running in ${running[0]?.cwd}. Stop it first.`;
  }

  if (running.length > 0 && !options.parallel) {
    return [
      `A preview is already running out of ${options.hostDir}:`,
      ...running.map(entry => `  ${describePreview(entry)}`),
      '',
      'Stop it (Ctrl-C in its terminal), or run this one alongside it with --parallel.',
    ].join('\n');
  }

  return null;
}
