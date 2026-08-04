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
