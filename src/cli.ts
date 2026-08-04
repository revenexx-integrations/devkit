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
 *   --entry <path>   package entry (default: src/index.ts, else dist/index.js)
 *   --seed <dir>     committed seeds dir (default: dev/seeds)
 *   --state <file>   session overlay file (default: .revenexx-dev/state.json)
 *   --no-persist     do not write the session overlay (in-memory only)
 *   --port <n>       listen port (default: $PORT or 3555)
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
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env.js';
import { DEVKIT_VERSION } from './index.js';
import { type LoadedPackage, loadPackageFromEntry } from './loader.js';
import { applySeeds, loadSeedsFromDir, loadState, saveState } from './persistence.js';
import { clearHostInstallMarker, hostNeedsInstall, markHostInstalled, materializeHost, resolveHostDir } from './preview/host.js';
import { createRequestListener } from './server.js';
import { DevStore } from './store.js';

interface CliOptions {
  entry: string;
  seedDir: string;
  stateFile: string;
  persist: boolean;
  port: number;
  uiDir: string | null;
  serveUi: boolean;
  open: boolean;
  /** Explicit host directory from `--dir`; null means use the managed cache. */
  previewDir: string | null;
  /** Re-copy the host even when the target looks complete. */
  force: boolean;
}

function parseArgs(argv: string[]): { command: string | null; options: CliOptions } {
  const cwd = process.cwd();
  const opts: CliOptions = {
    entry: '',
    seedDir: resolve(cwd, 'dev/seeds'),
    stateFile: resolve(cwd, '.revenexx-dev/state.json'),
    persist: true,
    port: Number.parseInt(process.env.PORT ?? '3555', 10),
    uiDir: null,
    serveUi: true,
    open: false,
    previewDir: null,
    force: false,
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
        opts.port = Number.parseInt(argv[++i] ?? '3555', 10);
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
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }
  if (!opts.entry) {
    const src = resolve(cwd, 'src/index.ts');
    opts.entry = existsSync(src) ? src : resolve(cwd, 'dist/index.js');
  }
  return { command, options: opts };
}

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

  await new Promise<void>(r => server.listen(options.port, r));

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
  const urlBase = `http://localhost:${options.port}`;
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
      if (file && /\.[cm]?tsx?$|\.js$/.test(file.toString())) {
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

/** Materializes (if needed), installs, and runs the Nuxt preview host + the mock together. */
async function preview(options: CliOptions): Promise<void> {
  const apiUrl = `http://localhost:${options.port}/api/v1`;
  const managed = options.previewDir === null;
  const targetDir = options.previewDir ?? resolveHostDir({ version: DEVKIT_VERSION });

  noteLegacyPreviewDir();
  const { dir } = materializeHost({
    targetDir,
    integrationsApiUrl: apiUrl,
    force: options.force,
    log: msg => console.log(msg),
  });
  if (managed) {
    console.log(`  Host (devkit ${DEVKIT_VERSION}, shared across repos)  ${dir}`);
  }

  if (options.force) {
    // --force means the pins may have changed; make sure the install is redone
    // rather than trusting a node_modules/ that predates the new manifest.
    clearHostInstallMarker(dir);
  }
  if (hostNeedsInstall(dir)) {
    console.log('Installing preview-host dependencies (this pulls Nuxt + the studio packages and may take a while)…');
    await runNpmInstall(dir);
    markHostInstalled(dir);
  }

  const mock = await startMock({ ...options, serveUi: false });
  console.log(`\n  Mock Integrations API  ${apiUrl}`);
  console.log('  Preview UI             http://localhost:3000/integrations (Nuxt starting…)\n');

  const { spawn } = await import('node:child_process');
  const child = spawn('npm', ['run', 'dev'], {
    cwd: dir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NUXT_PUBLIC_INTEGRATIONS_API: apiUrl,
      NUXT_PUBLIC_DEV_TOKEN: process.env.NUXT_PUBLIC_DEV_TOKEN ?? 'dev',
      NUXT_PUBLIC_DEV_TENANT: process.env.NUXT_PUBLIC_DEV_TENANT ?? 'dev-tenant',
    },
  });

  const shutdown = () => {
    child.kill('SIGTERM');
    mock.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', code => {
    mock.dispose();
    process.exit(code ?? 0);
  });
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
  console.error(err);
  process.exit(1);
});
