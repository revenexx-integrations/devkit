import tailwindcss from '@tailwindcss/vite';

// Minimal preview host for local integration-node development.
//
// This file ships inside `@revenexx/integrations-node-devkit` and is copied into
// a version-keyed cache directory on every `integrations-devkit preview`. Do not
// edit the copy — it is replaced whenever the devkit version changes. To hack on
// the host, take an unmanaged copy with `integrations-devkit init-preview --dir
// ./my-preview`.
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  // One host directory is shared by every node package on this machine — that is
  // the point, it is what makes the ~500 MB dependency tree a one-time cost. The
  // BUILD however must not be shared: two repos running `preview` at the same time
  // would otherwise compile into the same `.nuxt/`, and the second one to start
  // would serve the first one's app. `preview` therefore points each repo at its
  // own build dir; a manual `npm run dev` in here keeps the default.
  ...(process.env.DEVKIT_NUXT_BUILD_DIR ? { buildDir: process.env.DEVKIT_NUXT_BUILD_DIR } : {}),
  // SPA: no SSR, so the studio's browser-only composables (localStorage etc.)
  // behave exactly as in the real cockpit, and boot is fast.
  ssr: false,
  // studio-shared 0.2.x ships as a Nuxt MODULE (not a layer) — it must be
  // registered in 'modules', before studio-integrations which builds on it.
  // @solar-icons/nuxt provides the #solar-icons alias the studio components import.
  modules: ['@revenexx/studio-shared', '@solar-icons/nuxt', '@revenexx/studio-integrations'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  runtimeConfig: {
    public: {
      // Overridden at runtime by NUXT_PUBLIC_* env, which the `preview` command
      // passes to the Nuxt child process; the generated `.env` carries the same
      // values so a manual `npm run dev` in the host directory also works.
      integrationsApi: '',
      devToken: '',
      devTenant: '',
    },
  },
});
