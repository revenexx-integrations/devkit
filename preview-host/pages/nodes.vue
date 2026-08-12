<!--
  Custom devkit page: lists the package's local nodes and, on click, opens the
  REAL editor edit-view by REUSE — the exact studio <Dialog> lightbox from
  WorkflowEditor.vue wrapping <IntegrationsNodeInspector>. The inspector is only
  the dialog CONTENT (its root is a plain flex column); the studio Dialog owns
  the modal chrome, overlay and sizing. Config fields and dynamic resolving run
  against the mock.

  On Save the dialog is kept OPEN and the verdict shown: a success strip, or
  per-field errors fed back through the inspector's `refusedFields` prop so the
  wrong fields highlight in place, plus an explicit list (a refused field can be
  scrolled out of view).

  Closing is the DIALOG's job here — the X, Esc or the backdrop. The inspector's
  own footer buttons both mean "check this config"; see `onInspectorClose`.
-->
<template>
  <div class="ndx-page">
    <div class="ndx-inner">
      <header class="ndx-head">
        <h1>Lokale Nodes</h1>
        <p>Mock-API: <code>{{ apiUrl }}</code></p>
        <p v-if="loadError" class="ndx-err">{{ loadError }}</p>
      </header>

      <p v-if="loading">Lade Nodes…</p>
      <p v-else-if="nodes.length === 0">Keine Nodes gefunden. Exportiert dein Paket <code>NODES</code>?</p>

      <ul v-else class="ndx-grid">
        <li v-for="n in nodes" :key="`${n.slug}@${n.version}`" class="ndx-card" @click="openNode(n)">
          <div class="ndx-card-title">{{ label(n) }}</div>
          <div class="ndx-card-slug">{{ n.slug }} · v{{ n.version }}</div>
          <div class="ndx-badges">
            <span v-if="n.has_dynamic_options" class="ndx-badge">dynamic options</span>
            <span v-if="n.has_dynamic_schema" class="ndx-badge">dynamic schema</span>
            <span v-if="n.has_dynamic_outputs" class="ndx-badge">dynamic outputs</span>
          </div>
        </li>
      </ul>
    </div>

    <!-- REUSE of the exact editor lightbox: mirrors WorkflowEditor.vue's
         <Dialog><DialogContent><NodeInspector/> block, including the sizing
         classes, so the preview looks identical to the canvas. -->
    <Dialog :open="!!selection" @update:open="(v) => { if (!v) closeDialog() }">
      <DialogContent
        class="flex h-[min(680px,86vh)] w-[min(1100px,94vw)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-none"
      >
        <!-- The inspector's own footer/header buttons all emit the same `close`,
             which this page turns into "validate" (see onInspectorClose) — so say
             so, and say where the real close is. -->
        <div class="ndx-strip ndx-strip-info">
          Devkit-Preview: <strong>Save</strong> und <strong>Cancel</strong> prüfen die Config gegen den Mock,
          ohne zu schließen. Schließen: <strong>✕ oben rechts</strong> oder <strong>Esc</strong>.
        </div>
        <div v-if="result === 'ok'" class="ndx-strip ndx-strip-ok">✓ Payload gültig — alles gut.</div>
        <div v-else-if="result === 'err'" class="ndx-strip ndx-strip-err">
          <div>✗ Payload ungültig — {{ errorCount }} Feld(er) prüfen (rot markiert):</div>
          <ul class="ndx-errs">
            <li v-for="(msg, key) in refused" :key="key"><code>{{ key }}</code> — {{ msg }}</li>
          </ul>
        </div>
        <div v-else-if="formError" class="ndx-strip ndx-strip-err">{{ formError }}</div>
        <IntegrationsNodeInspector
          v-if="selection"
          :selection="selection"
          :secret-keys="secretKeys"
          :refused-fields="refused"
          @update="onSubmit"
          @close="onInspectorClose"
        />
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Dialog, DialogContent } from '@revenexx/studio'

interface ApiNode {
  name: string | Record<string, string>
  slug: string
  version: string
  manifest?: { name?: string | Record<string, string> }
  has_dynamic_options?: boolean
  has_dynamic_schema?: boolean
  has_dynamic_outputs?: boolean
}

const apiUrl = useRuntimeConfig().public.integrationsApi
const client = useIntegrationsApi()
// load() fills the reactive catalog the inspector reads via findManifest();
// resolveLocalized() turns a LocalizedString into the active-locale string.
const { load, resolveLocalized } = useIntegrationsNodes()

const nodes = ref<ApiNode[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

const selection = ref<any>(null)
const secretKeys = ref<string[]>([])
const refused = ref<Record<string, string>>({})
const result = ref<string | null>(null)
const formError = ref<string | null>(null)
// Set synchronously in onSubmit so the `close` the inspector emits right after an
// `update` (Save with changes) does not validate the same config a second time.
const validating = ref(false)

const errorCount = computed(() => Object.keys(refused.value).length)

function label(n: ApiNode): string {
  return resolveLocalized(n.manifest?.name ?? n.name) || n.slug
}

/**
 * `GET /secrets` returns `{ keys: string[] }` per the service's OpenAPI contract.
 * The `{ data: [...] }` branch is the envelope the mock sent before it was
 * aligned to the spec, and is kept so an older devkit state file still works.
 */
function secretKeysFrom(res: unknown): string[] {
  const obj = res as { keys?: string[], data?: Array<{ key?: string }> } | null
  if (Array.isArray(obj?.keys)) return obj.keys.filter(Boolean)
  if (Array.isArray(obj?.data)) return obj.data.map(s => s?.key).filter((k): k is string => !!k)
  return []
}

onMounted(async () => {
  await load()
  try {
    const res = await client.get<any>('/nodes')
    nodes.value = (Array.isArray(res) ? res : res?.data ?? []) as ApiNode[]
  }
  catch (e: any) {
    loadError.value = e?.message ?? 'Nodes konnten nicht geladen werden.'
  }
  finally {
    loading.value = false
  }
  try {
    secretKeys.value = secretKeysFrom(await client.get<any>('/secrets'))
  }
  catch {
    // secrets are optional for the preview
  }
})

function openNode(n: ApiNode) {
  refused.value = {}
  result.value = null
  formError.value = null
  // Synthetic WorkflowNode selection (distinguished by nodeSlug); the inspector
  // resolves its manifest from the catalog load() populated above.
  selection.value = { id: 'preview', nodeSlug: n.slug, nodeVersion: n.version, name: label(n), config: {} }
}

async function onSubmit(draft: any) {
  validating.value = true
  refused.value = {}
  result.value = null
  formError.value = null
  // Adopt the draft as the page's selection (a copy — the inspector keeps its own
  // object). That resets the inspector's `dirty`, so every FURTHER Save emits only
  // `close` and is validated by onInspectorClose against exactly what is on screen.
  selection.value = JSON.parse(JSON.stringify(draft))
  try {
    const slug = encodeURIComponent(draft.nodeSlug)
    const version = encodeURIComponent(draft.nodeVersion || 'latest')
    // NOTE: `config:validate` is a devkit-only endpoint — it does NOT exist in
    // the real integrations API (see DEVKIT_ONLY in tests/contract.test.ts).
    // Do not treat its behaviour as contract.
    const res = await client.post<any>(
      `/nodes/${slug}/${version}/config:validate`,
      { config: draft.config ?? {} },
    )
    if (res.valid) {
      result.value = 'ok'
    }
    else {
      refused.value = Object.fromEntries(
        Object.entries(res.errors ?? {}).map(([k, msgs]) => [k, (msgs as string[]).join(' ')]),
      )
      result.value = 'err'
    }
  }
  catch (e: any) {
    formError.value = e?.message ?? 'Validierung fehlgeschlagen.'
  }
  finally {
    validating.value = false
  }
}

/**
 * The inspector's footer emits `close` on BOTH Save and Cancel, and studio's
 * `save()` gates its `update` emit on `dirty` — so a Save on an untouched form
 * (exactly the "required field is still empty" case) hands us nothing but a
 * `close`, and the two are indistinguishable from here.
 *
 * There is nothing to persist in this preview, so both footer buttons mean the
 * same thing: check this config. A `close` therefore validates and KEEPS THE
 * DIALOG OPEN; leaving is the dialog's own X / Esc / backdrop.
 *
 * `validating` guards the Save-with-changes path, where `update` fired first
 * (synchronously, before this `close`) and its validation is already in flight.
 */
function onInspectorClose() {
  if (validating.value || !selection.value) return
  void onSubmit(selection.value)
}

/** Real close — the dialog's X, Esc or backdrop. Discards the draft. */
function closeDialog() {
  selection.value = null
  refused.value = {}
  result.value = null
  formError.value = null
}
</script>

<style scoped>
/* The app shell (app.vue) is h-svh + overflow-hidden, so this page must own its
   own vertical scroll — otherwise the node list is clipped and can't scroll. */
.ndx-page { height: 100%; overflow-y: auto; }
.ndx-inner { max-width: 60rem; margin: 0 auto; padding: 2rem; font-family: sans-serif; }
.ndx-head h1 { font-size: 1.5rem; font-weight: 600; }
.ndx-err { color: #b91c1c; }
.ndx-grid { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 1rem; margin-top: 1.5rem; }
.ndx-card { border: 1px solid #d1d5db; border-radius: 0.5rem; padding: 1rem; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.ndx-card:hover { border-color: #6366f1; box-shadow: 0 1px 6px rgba(0,0,0,.08); }
.ndx-card-title { font-weight: 600; }
.ndx-card-slug { color: #6b7280; font-size: .85rem; margin-top: .25rem; }
.ndx-badges { margin-top: .5rem; display: flex; flex-wrap: wrap; gap: .35rem; }
.ndx-badge { font-size: .7rem; background: #eef2ff; color: #4338ca; border-radius: .25rem; padding: .1rem .4rem; }

/* Verdict strip shown at the top of the reused dialog content (does not close). */
.ndx-strip { flex: 0 0 auto; padding: .5rem 1rem; font-size: .85rem; font-weight: 600; }
.ndx-strip-info { background: #f3f4f6; color: #4b5563; font-weight: 400; }
.ndx-strip-ok { background: #dcfce7; color: #166534; }
.ndx-strip-err { background: #fee2e2; color: #991b1b; }
.ndx-errs { margin: .35rem 0 0; padding-left: 1.1rem; font-weight: 400; }
.ndx-errs code { font-weight: 600; }
</style>
