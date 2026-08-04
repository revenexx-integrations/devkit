/**
 * Phase 1: workflow execution isn't available in the devkit preview, so the
 * Workflows editor pages are off-limits until phase 2. Any navigation to them
 * (deep links from the dashboard, direct URLs) bounces back to the Integrations
 * dashboard. The nav entry itself is hidden via assets/css/main.css.
 *
 * To re-enable in phase 2, delete this file and the two CSS rules.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/integrations/workflows' || to.path.startsWith('/integrations/workflows/')) {
    return navigateTo('/integrations')
  }
})
