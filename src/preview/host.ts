import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Nuxt preview host ships as real files in the devkit package (`preview-host/`)
 * and is copied into a version-keyed directory at run time. It is deliberately NOT
 * placed inside the consuming repo:
 *
 *   - A per-repo copy is never refreshed (the old scaffold only checked whether
 *     two filenames existed), so a devkit upgrade silently left a broken host
 *     behind — unfixable for external node-package authors.
 *   - Every repo paid for its own ~500 MB dependency tree of the same packages.
 *   - Keying the directory by devkit version makes staleness structurally
 *     impossible: a new devkit version means a new directory.
 *
 * The copy is therefore a disposable artifact, not something to edit. Authors who
 * want to hack on the host take an explicit unmanaged copy with
 * `integrations-devkit init-preview --dir ./my-preview`.
 */

/** Marker written after a *successful* dependency install. */
const INSTALL_MARKER = '.devkit-install-complete';

/**
 * Marker written after the file copy finished. Without it, "is the host here?"
 * would again be "do two filenames exist" — the same check whose weakness this
 * module exists to fix, only for the copy instead of the install: `cpSync` is not
 * atomic, so an interrupted copy can leave `package.json` and `nuxt.config.ts`
 * behind while the rest is missing, and that half-host would be treated as intact
 * forever.
 */
const COPY_MARKER = '.devkit-copy-complete';

/** Files generated into the target rather than shipped, since they carry runtime values. */
const HOST_GITIGNORE = `node_modules/
.nuxt/
.nuxt-*/
.output/
.data/
.env
${COPY_MARKER}
${INSTALL_MARKER}
`;

export interface HostDirOptions {
  /** Devkit version; keys the cache directory. */
  version: string;
  /** Overrides the whole cache location (mainly for tests). */
  cacheRoot?: string;
}

/**
 * Cache location for the managed host: `<cache>/revenexx/devkit-preview/<version>`.
 * Honours `XDG_CACHE_HOME`, falling back to `~/.cache`.
 */
export function resolveHostDir(options: HostDirOptions): string {
  const root = options.cacheRoot ?? process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
  return join(root, 'revenexx', 'devkit-preview', options.version);
}

/**
 * Absolute path of the `preview-host/` directory shipped inside this package.
 *
 * Walks up from this module rather than assuming a fixed depth, because the
 * module sits at `dist/cli.js` in the published package but at
 * `src/preview/host.ts` when running from source (tsx, vitest).
 */
export function shippedHostDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 5; up += 1) {
    const candidate = join(dir, 'preview-host');
    if (existsSync(join(candidate, 'nuxt.config.ts'))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Preview host not found: no preview-host/nuxt.config.ts above this module. Reinstall @revenexx/integrations-node-devkit.');
}

export interface MaterializeHostOptions {
  /** Where to put the host. */
  targetDir: string;
  /** Overrides the shipped host to copy from (mainly for tests). */
  sourceDir?: string;
  /** Mock API base URL written into the generated `.env`. */
  integrationsApiUrl: string;
  /** Dev token/tenant written into the generated `.env`. */
  devToken?: string;
  devTenant?: string;
  /** Re-copy even when the target already looks complete. */
  force?: boolean;
  /**
   * True for the version-keyed cache directory devkit owns, false for a `--dir`
   * copy that belongs to the user. Decides two things: whether an incomplete copy
   * may be redone (safe when devkit owns the directory, destructive when the user
   * does), and whether the generated `.env` / `.gitignore` are rewritten on every
   * run or left alone once they exist.
   */
  managed?: boolean;
  log?: (msg: string) => void;
}

export interface MaterializeHostResult {
  dir: string;
  /** True when files were (re-)copied; false when an intact copy was reused. */
  copied: boolean;
}

/**
 * Copies the shipped host into `targetDir` and writes the generated files.
 *
 * The copy is wholesale rather than per-file. For the managed cache that is free —
 * nothing in it is worth preserving — so an incomplete copy is simply redone. A
 * `--dir` copy belongs to the user, so there "the defining files are present" has
 * to be enough: re-copying over someone's edits to repair a hypothetical
 * interrupted copy would cost more than it saves.
 *
 * `node_modules/` and the install marker survive a re-copy so an unchanged
 * dependency set is not reinstalled for nothing — `hostNeedsInstall` compares the
 * manifest, so changed pins still reinstall.
 */
export function materializeHost(options: MaterializeHostOptions): MaterializeHostResult {
  const log = options.log ?? (() => {});
  const source = options.sourceDir ?? shippedHostDir();
  const dir = resolve(options.targetDir);
  const managed = options.managed ?? false;
  const intact = managed ? hostIsComplete(dir) : hostExists(dir);
  const alreadyIntact = intact && !options.force;

  if (!alreadyIntact) {
    mkdirSync(dir, { recursive: true });
    // Never copy a node_modules/ that lives INSIDE the host (present when someone
    // is working on preview-host/ itself) — it is the expensive part and is
    // validated separately via the install marker.
    //
    // The filter must judge the path RELATIVE to the source. Testing the absolute
    // path breaks the moment devkit is installed as a dependency, because the
    // source is then `…/node_modules/@revenexx/integrations-node-devkit/preview-host`
    // and the filter rejects the source root itself — cpSync then copies nothing
    // at all, silently.
    rmSync(join(dir, COPY_MARKER), { force: true });
    cpSync(source, dir, { recursive: true, filter: src => !isInsideNodeModules(source, src) });
    writeFileSync(join(dir, COPY_MARKER), `${new Date().toISOString()}\n`, 'utf-8');
    writeFileSync(join(dir, '.gitignore'), HOST_GITIGNORE, 'utf-8');
    log(`Preview host ready in ${dir}`);
  }

  // Managed: always refresh, because the API URL depends on --port and the
  // directory is devkit's to maintain. Unmanaged: write it only when it is
  // missing — that copy is the user's, and `preview` passes the same values to
  // the Nuxt child process anyway, so a hand-edited `.env` stays theirs.
  const envPath = join(dir, '.env');
  if (managed || !existsSync(envPath)) {
    writeFileSync(envPath, envFile(options), 'utf-8');
  }

  return { dir, copied: !alreadyIntact };
}

/** True when `src` sits under a `node_modules/` *within* the copied tree. */
function isInsideNodeModules(source: string, src: string): boolean {
  const rel = relative(source, src);
  return rel !== '' && rel.split(sep).includes('node_modules');
}

function envFile(options: MaterializeHostOptions): string {
  return `# Generated by integrations-devkit — overrides the Nuxt runtimeConfig.public.* values.
# The \`preview\` command also passes these to the Nuxt child process; this file is
# what makes a manual \`npm run dev\` in this directory work.
NUXT_PUBLIC_INTEGRATIONS_API=${options.integrationsApiUrl}
NUXT_PUBLIC_DEV_TOKEN=${options.devToken ?? 'dev'}
NUXT_PUBLIC_DEV_TENANT=${options.devTenant ?? 'dev-tenant'}
`;
}

/**
 * Per-consumer Nuxt build directory inside the shared host.
 *
 * The dependency tree is worth sharing; the compiled app is not. Two repos running
 * `preview` concurrently would otherwise build into the same `.nuxt/` and serve
 * each other's app. Keyed by a hash of the consumer's directory so it is stable
 * across runs — the build cache still pays off — and distinct per repo.
 */
export function hostBuildDir(hostDir: string, consumerDir: string): string {
  const key = createHash('sha256').update(consumerDir).digest('hex').slice(0, 12);
  return join(hostDir, `.nuxt-${key}`);
}

/** True when `dir` holds something that looks like a host (its two defining files). */
export function hostExists(dir: string): boolean {
  return existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'nuxt.config.ts'));
}

/**
 * True when `dir` holds a host this devkit finished copying. Stricter than
 * {@link hostExists}, which cannot tell a complete host from the first two files
 * of an interrupted one.
 */
export function hostIsComplete(dir: string): boolean {
  return hostExists(dir) && existsSync(join(dir, COPY_MARKER));
}

/**
 * True when dependencies must be installed.
 *
 * Deliberately not just `existsSync(node_modules)`: that was the root of a real
 * bug — `--force` rewrote `package.json` with new pins, the `node_modules/` check
 * then reported "installed", `npm install` was skipped, and Nuxt booted against
 * the old dependency tree. The marker records the manifest the install actually
 * succeeded for, so changed pins and interrupted installs both reinstall.
 */
export function hostNeedsInstall(dir: string): boolean {
  const marker = join(dir, INSTALL_MARKER);
  if (!existsSync(join(dir, 'node_modules')) || !existsSync(marker)) {
    return true;
  }
  try {
    return readFileSync(marker, 'utf-8').trim() !== manifestFingerprint(dir);
  } catch {
    return true;
  }
}

/** Records a successful install for the host's current manifest. */
export function markHostInstalled(dir: string): void {
  writeFileSync(join(dir, INSTALL_MARKER), `${manifestFingerprint(dir)}\n`, 'utf-8');
}

/** Clears the install marker so the next run reinstalls. */
export function clearHostInstallMarker(dir: string): void {
  rmSync(join(dir, INSTALL_MARKER), { force: true });
}

/**
 * The dependency sets the install must match. Only the dependency blocks matter —
 * editing a script or the description should not trigger a 500 MB reinstall.
 */
function manifestFingerprint(dir: string): string {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return JSON.stringify({ dependencies: pkg.dependencies ?? {}, devDependencies: pkg.devDependencies ?? {} });
}
