import type { Server } from 'node:http';
import { createServer } from 'node:net';
import { CliError } from './errors.js';

/**
 * Port allocation for the mock API and the Nuxt dev server.
 *
 * Two rules shape this module:
 *
 *   - **Bind, do not probe.** Asking "is this port free?" and then binding it is a
 *     race against every other process on the machine. The mock therefore binds for
 *     real and moves on only after an actual `EADDRINUSE`. (The Nuxt port cannot
 *     work that way — a child process binds it — so `findFreePort` does probe, and
 *     listhen's own fallback is the backstop for the window in between.)
 *   - **A named port is a promise, not a preference.** `--port 4000` or `PORT=4000`
 *     means 4000; if it is taken, that is an error, not an invitation to pick 4001.
 *     Only the default may wander, because nothing outside devkit depends on it.
 */

/** How many consecutive ports to try before giving up. */
const DEFAULT_LIMIT = 20;

export interface ListenOptions {
  port: number;
  /** True when the port was named explicitly (`--port` / `$PORT`): never relocate. */
  strict: boolean;
  limit?: number;
}

/**
 * Binds `server`, walking up from `options.port` on `EADDRINUSE`. Resolves with the
 * port actually bound — callers must use that value rather than the one they asked
 * for, since every URL they print or hand to a child process depends on it.
 */
export async function listenWithFallback(server: Server, options: ListenOptions): Promise<number> {
  const limit = options.strict ? 1 : (options.limit ?? DEFAULT_LIMIT);
  const first = options.port;
  for (let port = first; port < first + limit; port += 1) {
    const bound = await bind(server, port);
    if (bound !== null) {
      return bound;
    }
  }
  throw options.strict
    ? new CliError(`Port ${first} is already in use. Stop whatever is holding it, or pass a different --port.`)
    : new CliError(`No free port between ${first} and ${first + limit - 1}. Pass --port <n> to choose one explicitly.`);
}

/** Resolves with the bound port, or null when the port is taken. */
function bind(server: Server, port: number): Promise<number | null> {
  return new Promise((resolvePort, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      if (err.code === 'EADDRINUSE') {
        resolvePort(null);
        return;
      }
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const address = server.address();
      resolvePort(typeof address === 'object' && address !== null ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

/**
 * First free port at or above `base`, found by binding a throwaway listener.
 *
 * For ports someone else will bind — the Nuxt dev server runs as a child process.
 * The gap between this check and that bind is a real (if narrow) race; Nuxt's own
 * listhen fallback covers it, which is why devkit no longer prints the UI URL
 * itself and lets Nuxt announce the port it truly got.
 */
export async function findFreePort(base: number, limit = DEFAULT_LIMIT): Promise<number> {
  for (let port = base; port < base + limit; port += 1) {
    if (await isFree(port)) {
      return port;
    }
  }
  throw new CliError(`No free port between ${base} and ${base + limit - 1} for the preview UI.`);
}

function isFree(port: number): Promise<boolean> {
  return new Promise(resolveFree => {
    const probe = createServer();
    probe.once('error', () => resolveFree(false));
    probe.once('listening', () => probe.close(() => resolveFree(true)));
    probe.listen(port);
  });
}

/** Parses a `--port` value, rejecting what would otherwise reach `listen()` as NaN. */
export function parsePort(value: string | undefined, flag: string): number {
  if (value === undefined || value.startsWith('-')) {
    throw new CliError(`${flag} needs a port number, e.g. \`${flag} 4000\`.`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`${flag} expects an integer between 1 and 65535, got \`${value}\`.`);
  }
  return port;
}
