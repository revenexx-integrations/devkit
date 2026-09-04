---
"@revenexx/integrations-node-devkit": minor
---

The preview host moves to `@revenexx/studio-integrations` 1.3.0

Two minors on from the 1.1.1 pin, and this is the release the devkit has been
half of since 0.7.0: `showIf` and `state-ref` shipped here as validator
behaviour (PO-410, PO-374) against an editor that did not yet draw either. Both
halves now exist, so what the preview shows and what `config:validate` refuses
are the same rule rather than two guesses about it.

**What a node author sees that they did not before.** A setting carrying a
`showIf` condition is drawn only while the condition holds, and is not counted
among the optional ones either — the mock skips that setting on validate for the
same reason, so a hidden setting is never demanded. A `state-ref` setting is a
picker over the namespaces of its `stateRole` instead of the raw JSON box a field
type the editor did not know fell back to; typing `"article"` as a JSON string is
no longer the way in. A setting declared `multiline` gets a text area with room
for what it asked for. And a node exported in more than one version can be moved
between them from inside the dialog, with what the move costs — what travels,
what is dropped, what arrives needing an answer — listed before it happens.

**The node page owns the state namespaces, because there is no workflow to.**
The inspector stages a namespace declared inside the picker and, on Save, hands
it up (`declare-state`) for the editor to write into the workflow blob. Nothing
here holds a blob, so without an owner the namespace an author had just declared
would disappear from the picker the moment they saved it, and again on every
reopen. The page keeps the list for the session: it starts empty, a declaration
kept by Save joins it, a reload starts over. The mock still does not check a
namespace against any declaration — that is the engine's half, and it has no
local equivalent.

**`GET /nodes` now answers newest version first per slug**, with the slugs
themselves left in the order the package exports them. This is the bump's one
real bug rather than a nicety: from 1.3.0 the studio's catalogue reads "a newer
version of this node exists" as *position in the array* rather than by parsing a
semver, matching a registry that answers each slug's versions semver-descending.
The mock answered in export order — the order a human writes versions in, oldest
first — so a package exporting 1.0.0 before 2.0.0 would have had the inspector
announce the older version as the upgrade and stay silent about the real one.
`GET /nodes/{slug}/versions` has always sorted; the listing the catalogue is
actually built from now sorts the same way, and `tests/server.test.ts` holds the
two together. The contract test cannot catch this class of drift at all — OpenAPI
declares shapes, not order — which is now written into
`docs/architecture.md`.

**The Save/Cancel arrangement on the node page is unchanged and still needed.**
`NodeInspector` emits `update` only when its draft differs from `selection`, then
always emits `close`, so the stamped `ALWAYS_DIRTY` key is still what tells a Save
from a Cancel. 1.3.0 widens `dirty` to count a staged state declaration as well,
but the `update` emit itself is still gated on the draft compare, so nothing about
the workaround moves. The upstream `save` event that would retire it still does
not exist.

**Nothing else in the host moves.** 1.3.0 declares the same dependencies and the
same peers as 1.1.1, so the `@revenexx/studio` ^0.2.2, `@revenexx/studio-shared`
^0.3.0 and `@solar-icons/nuxt` ^1.2.1 pins stand as they are.

The rest of the two releases lands outside what the preview shows: the
tenant-wide Runs page paging and sorting on the platform (which needs `?sort=` on
`GET /v1/runs`, PO-371), build states that become true on their own, deleting a
workflow from its editor, the loading announcements. The Workflows surface is
hidden and `…/runs/*` is deliberately unmocked, so the mock is untouched there.
One trace does reach it: a test run from the editor now names the workflow it
belongs to, so `POST …/execute:test` may carry `workflow_id`. The preview has no
workflow to name and never sends one, and the mock reads `config`, `inputs` and
`timeout_ms` and ignores the rest.
