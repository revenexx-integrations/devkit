export interface PreviewChildEnvOptions {
  /** Usually `process.env`. */
  base: NodeJS.ProcessEnv;
  /** Mock API base URL, including the port actually bound. */
  apiUrl: string;
  /** Per-repo Nuxt build directory (`hostBuildDir`). */
  buildDir: string;
  /** Per-repo Vite dependency cache (`hostViteCacheDir`). */
  viteCacheDir: string;
  /** Port the Nuxt dev server should listen on. */
  uiPort: number;
}

/**
 * Environment for the `nuxt dev` child process.
 *
 * A pure function because the three things it gets right are all invisible at a
 * glance, and each of them was a bug:
 *
 *   - **`PORT` is deleted.** It is the mock's variable, but Nuxt's listhen reads it
 *     too, so `PORT=4000 integrations-devkit preview` used to have the mock *and*
 *     the UI both claim 4000. Nuxt then relocated silently and every URL devkit
 *     printed was wrong. `NUXT_PORT` outranks `PORT` anyway; deleting it as well
 *     keeps the mock's port out of the child's namespace entirely.
 *   - **`DEVKIT_VITE_CACHE_DIR` is set.** Without it Vite's dependency cache lands
 *     in the *shared* host's `node_modules/.cache/vite`, and since Vite's config
 *     hash includes the `#build` alias — i.e. the per-repo build dir — two repos
 *     each consider the other's cache stale and `rm -rf` it while it is being
 *     served from. Per-repo build dirs alone actively caused that.
 *   - **`NUXT_PORT` is set explicitly**, so devkit knows the UI port instead of
 *     guessing 3000 and hoping listhen agreed.
 */
export function previewChildEnv(options: PreviewChildEnvOptions): NodeJS.ProcessEnv {
  const env = { ...options.base };
  delete env.PORT;
  return {
    ...env,
    NUXT_PUBLIC_INTEGRATIONS_API: options.apiUrl,
    NUXT_PUBLIC_DEV_TOKEN: options.base.NUXT_PUBLIC_DEV_TOKEN ?? 'dev',
    NUXT_PUBLIC_DEV_TENANT: options.base.NUXT_PUBLIC_DEV_TENANT ?? 'dev-tenant',
    NUXT_PORT: String(options.uiPort),
    DEVKIT_NUXT_BUILD_DIR: options.buildDir,
    DEVKIT_VITE_CACHE_DIR: options.viteCacheDir,
  };
}
