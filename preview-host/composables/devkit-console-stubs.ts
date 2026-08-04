/**
 * Auto-imported no-op stubs for the full-cockpit "console" composables that some
 * studio-integrations components reach for — notably `CredentialRevenexxSource`,
 * the "Use revenexx managed source" picker rendered unconditionally in
 * `CredentialCreateDialog` for the `revenexx:sftp` / `smtp` / `api` slugs.
 *
 * The slimmed preview has no console gateways (tenants, markets, managed SFTP /
 * mail / API keys), so without these the picker throws "useConsoleTenants is not
 * defined" at setup. That crashes the whole subtree and takes its sibling manual
 * config fields (rendered with v-show) down with it — leaving the credential
 * dialog with NO input fields at all. These stubs let the picker mount empty
 * instead of crashing, so manual credential creation works.
 *
 * Mirrors `app/composables/consoleStubs.ts` in services/integrations/studio-ui.
 *
 * Caveat: `revenexx:api` managed sources still cannot be populated (no
 * gateways) — seed such credentials via `dev/seeds` instead. Standard types
 * (smtp/sftp/ftp/http-bearer/deepl) create fine.
 */
import { ref } from 'vue'

export function useConsoleTenants() {
  return { tenants: ref([]), onlyTenantSlug: ref(null), load: async () => {} }
}
export function useActiveMarket() {
  return {
    markets: ref([]),
    activeCode: ref(''),
    isGlobal: ref(true),
    GLOBAL_MARKET_CODE: '__global__',
    fetchMarkets: async () => {},
  }
}
export function useConsoleSftp() {
  return {
    accounts: ref([]),
    load: async () => {},
    revealPassword: async () => ({}),
    create: async () => ({}),
    refresh: async () => ({}),
  }
}
export function useMailAdmin() {
  return {
    listCredentials: async () => [],
    getCredential: async () => ({}),
    createCredential: async () => ({}),
  }
}
export function useConsoleApiKeys() {
  return { create: async () => ({ secret: '' }) }
}
