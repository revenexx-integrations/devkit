<!--
  Shell mirrors services/integrations/studio-ui's app.vue (the official minimal
  host for @revenexx/studio-integrations): the studio pages size themselves
  against a definite height (h-svh), the brand background is #f3f1fa, and the
  module's pages call toast.* (vue-sonner) so a global <Toaster> mount is
  required. NuxtLoadingIndicator covers the on-demand route compile in dev.
-->
<script setup lang="ts">
import { Toaster } from '@revenexx/studio'

useHead({ title: 'Integration Studio — devkit preview' })
</script>

<template>
  <div class="flex h-svh flex-col overflow-hidden bg-[#f3f1fa] text-foreground">
    <NuxtLoadingIndicator color="var(--color-primary, #620DFF)" :height="3" />
    <div class="min-h-0 flex-1 pt-3">
      <NuxtPage />
    </div>
    <Toaster rich-colors position="bottom-right" :duration="3500" close-button />
  </div>
</template>
