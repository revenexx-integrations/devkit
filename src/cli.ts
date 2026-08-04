#!/usr/bin/env node
/**
 * `integrations-devkit` — local mock Integrations API + preview for a node package.
 *
 *   integrations-devkit                     # start the mock API (+ static UI via --ui)
 *   integrations-devkit preview             # run the Nuxt host together with the mock
 *   integrations-devkit init-preview --dir  # take an unmanaged copy of the host to hack on
 *   integrations-devkit reset               # delete the persisted session overlay
 *
 * The preview host is NOT placed in your repo. It is copied into a version-keyed
 * cache directory (see src/preview/host.ts), so every repo on this machine shares
 * one dependency install and a devkit upgrade can never leave a stale host behind.
 *
 * Options:
 *   --dir <path>     use this host dir instead of the managed cache (unmanaged)
 *   --force          re-copy the host even if the target looks complete
 *   --parallel       allow a second preview next to one already running
 *   --entry <path>   package entry (default: src/index.ts, else dist/index.js)
 *   --seed <dir>     committed seeds dir (default: dev/seeds)
 *   --state <file>   session overlay file (default: .revenexx-dev/state.json)
 *   --no-persist     do not write the session overlay (in-memory only)
 *   --port <n>       listen port (default: $PORT or 3555; the default relocates
 *                    when taken, an explicit one is reported as a conflict)
 *   --ui <dir>       static UI build dir to serve (default: resolve the UI package)
 *   --no-ui          run API-only, do not serve a UI
 *   --open           open the preview in a browser
 *   --env <path>     env file to load *instead of* .env (default: .env when present)
 *   --no-env         do not load any env file
 */

import { existsSync, readdirSync, readFileSync, watch } from 'node:fs';
import type http from 'node:http';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CliOptions, parseArgs } from './cli-args.js';
import { loadEnvFile } from './env.js';
import { CliError } from './errors.js';
import { DEVKIT_VERSION } from './index.js';
import { isReloadableSource, type LoadedPackage, loadPackageFromEntry } from './loader.js';
import { applySeeds, loadSeedsFromDir, loadState, saveState } from './persistence.js';
import { previewChildEnv } from './preview/child-env.js';
import { clearHostInstallMarker, hostBuildDir, hostDotenvName, hostNeedsInstall, hostViteCacheDir, markHostInstalled, materializeHost, resolveHostDir, withInstallLock } from './preview/host.js';
import { describePreview, previewConflict, readLivePreviews, registerPreview, unregisterPreview } from './preview/registry.js';
import { findFreePort, listenWithFallback } from './ports.js';
import { createRequestListener } from './server.js';
import { DevStore } from './store.js';

/** Loads any JSON schemas bundled in the package's `assets/schemas` dir. */
function loadSchemas(): Record<string, unknown> {
  const here = fileURLToPath(new URL('.', import.meta.url));
  // dist/cli.js → package root is one level up.
  const schemasDir = resolve(here, '..', 'assets', 'schemas');
  const schemas: Record<string, unknown> = {};
  if (!existsSync(schemasDir)) {
    return schemas;
  }
  for (const file of readdirSync(schemasDir)) {
    if (extname(file) !== '.json') {
      continue;
    }
    const parsed = JSON.parse(readFileSync(join(schemasDir, file), 'utf-8'));
    // File `node-v0-draft.json` → keys `node/v0-draft` and (latest) `node`.
    // Split on the first dash only: domain=`node`, version=`v0-draft`.
    const base = file.replace(/\.json$/, '');
    const dash = base.indexOf('-');
    if (dash > 0) {
      const domain = base.slice(0, dash);
      const version = base.slice(dash + 1);
      schemas[`${domain}/${version}`] = parsed;
      schemas[domain] = parsed;
    } else {
      schemas[base] = parsed;
    }
  }
  return schemas;
}

/**
 * Resolves a *static* UI build dir to serve. Only used for a prebuilt SPA
 * passed via `--ui`. The Cockpit UI (`@revenexx/studio-integrations`) is a Nuxt
 * *module*, not a static build — it is consumed by a Nuxt host app whose
 * `runtimeConfig.public.integrationsApi` points at this mock (see README).
 * Auto-resolution only kicks in for a package that ships a `dist/` with an
 * `index.html`; otherwise the devkit stays API-only.
 */
function resolveUiDir(explicit: string | null): string | null {
  if (explicit) {
    return existsSync(explicit) ? explicit : null;
  }
  const candidates = ['@revenexx/studio-integrations'];
  const req = createRequire(import.meta.url);
  for (const pkg of candidates) {
    try {
      const entry = req.resolve(`${pkg}/package.json`);
      const dist = resolve(entry, '..', 'dist');
      if (existsSync(join(dist, 'index.html'))) {
        return dist;
      }
    } catch {
      // not installed / not a static build — fall through to API-only
    }
  }
  return null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Serves a static SPA build, falling back to index.html for client routes. */
function serveStatic(uiDir: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  let filePath = resolve(uiDir, relative);
  if (!filePath.startsWith(uiDir) || !existsSync(filePath)) {
    filePath = join(uiDir, 'index.html');
  }
  if (!existsSync(filePath)) {
    res.writeHead(404).end('UI build not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

interface MockHandle {
  uiDir: string | null;
  /** The port actually bound, which is not necessarily the one that was asked for. */
  port: number;
  dispose(): void;
}

/** Boots the mock API (store + seeds + persistence + hot-reload). No signal handlers. */
async function startMock(options: CliOptions): Promise<MockHandle> {
  let loaded: LoadedPackage = await loadPackageFromEntry(options.entry);
  console.log(`Loaded ${loaded.nodes.length} node(s), ${loaded.credentials.length} credential(s), ${loaded.templates.length} template(s) from ${options.entry}`);

  const store = new DevStore();
  applySeeds(store, await loadSeedsFromDir(options.seedDir));
  if (options.persist) {
    const state = loadState(options.stateFile);
    if (state) {
      store.mergeSnapshot(state);
      console.log(`Restored session from ${options.stateFile}`);
    }
    // Attach persistence only now, so applying seeds doesn't rewrite the overlay.
    let timer: NodeJS.Timeout | undefined;
    store.setOnMutation(() => {
      clearTimeout(timer);
      timer = setTimeout(() => saveState(options.stateFile, store.toSnapshot()), 150);
    });
  }

  const schemas = loadSchemas();
  const apiListener = createRequestListener({ getPackage: () => loaded, store, schemas });

  const uiDir = options.serveUi ? resolveUiDir(options.uiDir) : null;
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/') || pathname === '/health') {
      apiListener(req, res);
    } else if (uiDir) {
      serveStatic(uiDir, req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          message: 'API-only. Point your Nuxt host (studio-integrations) integrationsApi at this URL, or pass --ui <static-build-dir>. CORS is open.',
        }),
      );
    }
  });

  const port = await listenWithFallback(server, { port: options.port, strict: options.portExplicit });
  if (port !== options.port) {
    console.log(`Port ${options.port} was taken — the mock is on ${port} instead.`);
  }

  const stopWatch = watchAndReload(options.entry, async () => {
    try {
      loaded = await loadPackageFromEntry(options.entry);
      console.log(`↻ Reloaded package (${loaded.nodes.length} nodes, ${loaded.credentials.length} credentials).`);
    } catch (err) {
      console.error(`Reload failed: ${(err as Error).message}`);
    }
  });

  return {
    uiDir,
    port,
    dispose() {
      if (options.persist) {
        saveState(options.stateFile, store.toSnapshot());
      }
      stopWatch?.();
      server.close();
    },
  };
}

/** Interactive mock server (API + optional static UI). */
async function run(options: CliOptions): Promise<void> {
  const mock = await startMock(options);
  const urlBase = `http://localhost:${mock.port}`;
  console.log(`\n  Mock Integrations API  ${urlBase}/api/v1`);
  console.log(mock.uiDir ? `  Preview UI             ${urlBase}` : `  Preview UI             API-only — set your Nuxt host's integrationsApi to ${urlBase}/api/v1`);
  console.log('\n  Watching for changes. Ctrl-C to stop.\n');

  if (options.open && mock.uiDir) {
    void openBrowser(urlBase);
  }

  const shutdown = () => {
    mock.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** Watches the entry's directory tree and fires `onChange` (debounced). Returns a stop fn. */
function watchAndReload(entry: string, onChange: () => void): (() => void) | undefined {
  const dir = resolve(entry, '..');
  let timer: NodeJS.Timeout | undefined;
  try {
    const watcher = watch(dir, { recursive: true }, (_event, file) => {
      if (file && isReloadableSource(file.toString())) {
        clearTimeout(timer);
        timer = setTimeout(onChange, 200);
      }
    });
    return () => watcher.close();
  } catch {
    // Recursive watch unsupported on this platform — skip hot-reload.
    console.warn('Hot-reload unavailable on this platform; restart to pick up changes.');
    return undefined;
  }
}

/** Runs `npm install` in `dir`, inheriting stdio. */
async function runNpmInstall(dir: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('npm', ['install'], { cwd: dir, stdio: 'inherit' });
    child.on('exit', code => (code === 0 ? resolvePromise() : reject(new Error(`npm install exited with code ${code}`))));
    child.on('error', reject);
  });
}

/**
 * Warns about a `.revenexx-dev/preview` left over from before the host moved into
 * the shared cache. Not deleted automatically — it is the user's directory, and it
 * may hold edits they want to keep.
 */
function noteLegacyPreviewDir(): void {
  const legacy = resolve(process.cwd(), '.revenexx-dev/preview');
  if (existsSync(legacy)) {
    console.log(`Note: ${legacy} is no longer used — the preview host now lives in a shared cache. You can delete it to reclaim the space.`);
  }
}

/** Default port for the Nuxt dev server, matching Nuxt's own. */
const UI_PORT = 3000;

/** Materializes (if needed), installs, and runs the Nuxt preview host + the mock together. */
async function preview(options: CliOptions): Promise<void> {
  const cwd = process.cwd();
  const managed = options.previewDir === null;
  const hostDir = resolve(options.previewDir ?? resolveHostDir({ version: DEVKIT_VERSION }));

  // Before anything is bound or copied: a second preview is usually a forgotten
  // one from an earlier session, not a deliberate one.
  const running = readLivePreviews(hostDir);
  const conflict = previewConflict(running, { cwd, hostDir, parallel: options.parallel, force: options.force });
  if (conflict) {
    throw new CliError(conflict);
  }

  noteLegacyPreviewDir();

  // Bind the mock BEFORE copying and installing. A port clash or an entry that
  // does not load then costs seconds, instead of surfacing after a multi-minute
  // `npm install` with a Nuxt child already on the way.
  const mock = await startMock({ ...options, serveUi: false });
  const apiUrl = `http://localhost:${mock.port}/api/v1`;

  try {
    const { dir } = materializeHost({
      targetDir: hostDir,
      integrationsApiUrl: apiUrl,
      dotenvName: managed ? hostDotenvName(cwd) : undefined,
      force: options.force,
      managed,
      log: msg => console.log(msg),
    });

    if (options.force) {
      // `hostNeedsInstall` already reinstalls when the pins changed, so this is not
      // that case — it is the escape hatch --force is documented to be: an install
      // that reported success but left an unusable tree has no other way out short
      // of deleting the directory.
      clearHostInstallMarker(dir);
    }
    if (hostNeedsInstall(dir)) {
      await withInstallLock(
        dir,
        async () => {
          console.log('Installing preview-host dependencies (this pulls Nuxt + the studio packages and may take a while)…');
          await runNpmInstall(dir);
          markHostInstalled(dir);
        },
        { needsInstall: () => hostNeedsInstall(dir), log: msg => console.log(msg) },
      );
    }

    // Honour an explicit NUXT_PORT; otherwise take the first free port. Nuxt's own
    // listhen fallback still covers the gap between this check and its bind, which
    // is why the URL below is Nuxt's to print, not ours.
    const uiPort = process.env.NUXT_PORT ? Number(process.env.NUXT_PORT) : await findFreePort(UI_PORT);

    console.log(`\n  Previewing             ${basename(cwd)}  (${cwd})`);
    console.log(`  Mock Integrations API  ${apiUrl}`);
    if (managed) {
      console.log(`  Host (devkit ${DEVKIT_VERSION}, shared across repos)  ${dir}`);
    }
    console.log(`  Preview UI             starting on port ${uiPort} — Nuxt prints the URL it got, below.`);
    for (const entry of running) {
      console.log(`  Also running           ${describePreview(entry)}`);
    }
    console.log('');

    const { spawn } = await import('node:child_process');
    // The managed host reads a per-repo dotenv file, so it has to be named. An
    // unmanaged copy keeps plain `.env`, which Nuxt picks up on its own.
    const args = managed ? ['run', 'dev', '--', '--dotenv', hostDotenvName(cwd)] : ['run', 'dev'];
    const child = spawn('npm', args, {
      cwd: dir,
      stdio: 'inherit',
      env: previewChildEnv({
        base: process.env,
        apiUrl,
        uiPort,
        buildDir: hostBuildDir(dir, cwd),
        viteCacheDir: hostViteCacheDir(dir, cwd),
      }),
    });

    registerPreview(dir, { pid: process.pid, cwd, mockPort: mock.port, uiPort, startedAt: new Date().toISOString() });
    const cleanUp = () => {
      unregisterPreview(dir);
      mock.dispose();
    };

    const shutdown = () => {
      child.kill('SIGTERM');
      cleanUp();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    child.on('exit', code => {
      cleanUp();
      process.exit(code ?? 0);
    });
  } catch (err) {
    // The mock is already listening at this point; leaving it bound would make the
    // next attempt look like a port conflict.
    mock.dispose();
    throw err;
  }
}

async function openBrowser(url: string): Promise<void> {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const { spawn } = await import('node:child_process');
  spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Before parseArgs: it reads `PORT`, and seeds interpolate `${VAR}` from the
  // environment once the mock starts.
  const envFile = loadEnvFile(argv);
  const { command, options } = parseArgs(argv);
  if (command === 'version') {
    console.log(DEVKIT_VERSION);
    return;
  }
  if (envFile) {
    console.log(`Loaded env from ${envFile}`);
  }
  if (command === 'reset') {
    const { rmSync } = await import('node:fs');
    rmSync(options.stateFile, { force: true });
    console.log(`Removed ${options.stateFile}`);
    return;
  }
  if (command === 'init-preview') {
    // The managed host is a disposable artifact `preview` handles on its own, so
    // this command only makes sense for taking a copy you intend to change.
    if (options.previewDir === null) {
      console.error('init-preview needs an explicit target: `integrations-devkit init-preview --dir ./my-preview`.');
      console.error('It exists to give you an UNMANAGED copy of the preview host to modify. For the normal preview, just run `integrations-devkit preview` —');
      console.error('that materializes the host into a shared cache and keeps it in step with the devkit version.');
      process.exit(1);
    }
    const { dir } = materializeHost({
      targetDir: options.previewDir,
      integrationsApiUrl: `http://localhost:${options.port}/api/v1`,
      force: options.force,
      log: msg => console.log(msg),
    });
    console.log('\nThis copy is yours and will NOT be updated by devkit upgrades.');
    console.log(`Run it with: \`cd ${dir} && npm install && npm run dev\` (plus \`integrations-devkit --no-ui\` for the mock),`);
    console.log(`or \`integrations-devkit preview --dir ${dir}\` to have both started for you.`);
    return;
  }
  if (command === 'preview') {
    await preview(options);
    return;
  }
  await run(options);
}

main().catch(err => {
  // A CliError is a message for the user, not a defect: print the message alone.
  // Anything else keeps its stack, which is the only useful thing about it.
  console.error(err instanceof CliError ? err.message : err);
  process.exit(1);
});
