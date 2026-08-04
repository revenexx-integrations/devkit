<!--
  Landing page styled after services/integrations/studio-ui's pages/index.vue —
  same studio design tokens (bg-card, text-mono, bg-primary, muted) so `/` looks
  like the real dev host. No token gate: the devkit bakes a fixed dev token.
  Workflows is deliberately absent from the quick links (phase 1).
-->
<template>
  <div class="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-6 px-6 py-12">
    <div>
      <p class="text-mono text-muted-foreground">Integrations · node devkit</p>
      <h1 class="mt-1 text-2xl font-medium">Integration Studio — Preview</h1>
      <p class="mt-2 text-sm text-muted-foreground">
        Lokaler Host für <code>@revenexx/studio-integrations</code> gegen die Mock-API
        deines Node-Pakets. Authentifizierung ist ein festes Dev-Token — nichts einzugeben.
      </p>
    </div>

    <div class="rounded-lg border border-black/[0.06] bg-card p-5 text-sm shadow-sm">
      <p class="text-mono text-muted-foreground">Session</p>
      <dl class="mt-2 grid grid-cols-[7rem_1fr] gap-y-1">
        <dt class="text-muted-foreground">Mock API</dt>
        <dd class="truncate font-mono text-xs leading-5">{{ api }}</dd>
        <dt class="text-muted-foreground">Tenant</dt>
        <dd class="font-mono text-xs leading-5">{{ tenant }}</dd>
      </dl>
    </div>

    <div class="rounded-lg border border-black/[0.06] bg-card p-5 shadow-sm">
      <p class="text-mono text-muted-foreground">Einstieg</p>
      <div class="mt-3 flex flex-col gap-4">
        <NuxtLink
          to="/nodes"
          class="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Lokale Nodes öffnen — Preview + Validierung
        </NuxtLink>
        <div class="flex flex-wrap gap-x-4 gap-y-1.5">
          <NuxtLink
            v-for="link in quickLinks"
            :key="link.to"
            :to="link.to"
            class="text-sm text-primary hover:underline"
          >
            {{ link.label }}
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const rc = useRuntimeConfig().public
const api = rc.integrationsApi
const tenant = (rc.devTenant as string) || 'dev-tenant'

const quickLinks = [
  { to: '/integrations', label: 'Overview' },
  { to: '/integrations/credentials', label: 'Credentials' },
  { to: '/integrations/secrets', label: 'Secrets' },
  { to: '/nodes', label: 'Local nodes' },
]
</script>
