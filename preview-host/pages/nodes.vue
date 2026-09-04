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
  scrolled out of view). Cancel, the header ✕, Esc and the backdrop all close.

  That split relies on Save always emitting `update` before `close`, which the
  inspector only does while it considers itself dirty — see `keepInspectorDirty`.
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
        :show-close-button="false"
        class="flex h-[min(680px,86vh)] w-[min(1100px,94vw)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-none"
      >
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
          ref="inspector"
          :selection="selection"
          :secret-keys="secretKeys"
          :state-namespaces="stateNamespaces"
          :refused-fields="refused"
          @update="onSubmit"
          @declare-state="onDeclareState"
          @close="requestClose"
        />
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

type StateRole = 'mapping' | 'cursor' | 'dedupe' | 'digest'
type StateVisibility = 'private' | 'shared'
interface DeclaredNamespace { namespace: string, role: StateRole, visibility?: StateVisibility }

/**
 * The state namespaces a `state-ref` setting may pick from (PO-374).
 *
 * In the product these live in the workflow blob's `state` block and the editor
 * owns them — which is why the inspector only ANNOUNCES a declaration made from
 * inside the picker (`declare-state`) instead of keeping it. There is no
 * workflow here, so this page is the owner: the list starts empty, and grows by
 * exactly the declarations a Save keeps.
 *
 * Holding them matters even though nothing is persisted. The inspector stages a
 * declaration in its own draft until Save, then hands it over and forgets it —
 * so without an owner the namespace an author just declared would vanish from
 * the picker the moment they saved, and again on every reopen. It lives for the
 * session; a reload starts over, as nothing on this page is written anywhere.
 */
const stateNamespaces = ref<DeclaredNamespace[]>([])

/** Save kept a namespace declared inside a picker. Ignore a name already held. */
function onDeclareState(namespace: string, role: StateRole, visibility: StateVisibility) {
  if (stateNamespaces.value.some(n => n.namespace === namespace)) return
  stateNamespaces.value = [...stateNamespaces.value, { namespace, role, visibility }]
}

const selection = ref<any>(null)
const secretKeys = ref<string[]>([])
const refused = ref<Record<string, string>>({})
const result = ref<string | null>(null)
const formError = ref<string | null>(null)
// Set synchronously in onSubmit so the `close` the inspector emits right after an
// `update` (i.e. Save) does NOT close the dialog — we keep it open for the verdict.
const validating = ref(false)

/**
 * Key stamped onto `selection` to hold the inspector permanently "dirty".
 *
 * `NodeInspector.save()` emits `update` only when its draft differs from
 * `selection` (a JSON string compare), then always emits `close`. On an untouched
 * form — exactly the "is this field required?" case — Save therefore emits nothing
 * but `close`, which is byte-for-byte what Cancel emits, and the page cannot tell
 * them apart: it either closes on both (the old bug) or on neither (Cancel stops
 * working). Making the comparison permanently unequal restores the distinction —
 * Save always emits `update` first, so a bare `close` can only be Cancel, the
 * header ✕, Esc or the backdrop.
 *
 * The inspector clones its draft from `selection` in setup and renders from that
 * clone alone, so the key is stamped on afterwards (once the component ref exists),
 * never appears in the form, and never reaches a validated payload. Its one visible
 * trace is a permanent "Unsaved changes" in the footer — which in a preview that
 * persists nothing is not even wrong.
 *
 * The proper fix belongs upstream: a `save` event on the inspector that fires
 * regardless of `dirty`. Until studio-integrations has one, this stays.
 */
const ALWAYS_DIRTY = '__devkitPreviewProbe'

const inspector = ref<unknown>(null)
watch(inspector, (instance) => {
  if (instance && selection.value && !(ALWAYS_DIRTY in selection.value)) {
    selection.value = { ...selection.value, [ALWAYS_DIRTY]: true }
  }
})

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
  // `selection` is deliberately NOT updated from the draft: it carries the
  // ALWAYS_DIRTY key, and adopting the draft would drop it and silence the next
  // Save. The draft arrives here on every Save anyway, so there is nothing to sync.
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
 * The inspector emits `close` on Save, on Cancel and on its header ✕. Save is the
 * only one that emits `update` first — synchronously, and ALWAYS, because
 * ALWAYS_DIRTY keeps it dirty — so `validating` is already set by the time this
 * runs and marks the close as Save's. Hold it, and the dialog stays open for the
 * verdict. Anything else is a genuine close.
 */
function requestClose() {
  if (validating.value) return
  closeDialog()
}

/** Esc, the backdrop, Cancel, the header ✕ — discards the draft. */
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
.ndx-strip-ok { background: #dcfce7; color: #166534; }
.ndx-strip-err { background: #fee2e2; color: #991b1b; }
.ndx-errs { margin: .35rem 0 0; padding-left: 1.1rem; font-weight: 400; }
.ndx-errs code { font-weight: 600; }
</style>
