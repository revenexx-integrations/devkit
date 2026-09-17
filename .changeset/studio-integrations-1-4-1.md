---
"@revenexx/integrations-node-devkit": minor
---

The preview host moves to `@revenexx/studio-integrations` 1.4.1

Three minors and a patch on from the 1.1.1 pin, and 1.3.0 is the release the
devkit has been half of since 0.7.0: `showIf` and `state-ref` shipped here as
validator behaviour (PO-410, PO-374) against an editor that did not yet draw
either. Both halves now exist, so what the preview shows and what
`config:validate` refuses are the same rule rather than two guesses about it.

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

**1.4.0 rearranges the dialog the preview exists to show.** Three of its
changesets land on the node configuration surface and on nothing else the host
mounts:

- The Parameters tab draws a node's settings in the **order the node declares
  them** (PO-463), where it used to draw every required setting first and fold
  every optional one away. Four or fewer are all shown; past the fourth a
  setting stands when it is required and folds when it is not. For a node author
  this moves the lever into their own manifest: a setting that is central to the
  node belongs near the top of `config`, whether or not the API would refuse it
  empty. Requiredness no longer stands in for importance.
- A setting inside a **repeating row** is drawn as what it declares (PO-436) —
  its options, its default, its description, its required marker, and its
  `showIf` resolved against that row — instead of as an empty text box whatever
  the manifest said. A new row now carries each sub-setting's declared default
  and omits one that has none, where it used to seed an empty string under every
  key, which is a value rather than an absence.
- An option declared with an **empty value** — "unchanged", "all kinds" — is
  selectable (PO-422). It used to be refused by the control underneath, which
  reserves the empty value for "nothing selected", and the refusal took the
  dialog's dismissal machinery with it.

**Which opens one gap the other way, and this bump documents rather than closes
it.** `validateNodeConfig` reads a node's settings one level deep: a field
declaring `items` or `properties` is checked for being an array or an object,
plus the `minLength`/`maxLength` on the field itself, and the sub-settings inside
it are neither demanded when required nor type-checked, with no per-row `showIf`.
That cost nothing while the form drew a nested setting as a text box; from 1.4.0
the dialog marks a nested setting required and the mock does not refuse it empty.
The inversion is now stated in the fidelity caveats and in `docs/testing.md`,
where the `showIf` rule it mirrors is written down.

**The Save/Cancel arrangement on the node page is unchanged and still needed.**
`NodeInspector` emits `update` only when its draft differs from `selection`, then
always emits `close`, so the stamped `ALWAYS_DIRTY` key is still what tells a Save
from a Cancel. 1.3.0 widens `dirty` to count a staged state declaration as well,
but `commit()` gates the `update` emit on the draft compare alone in 1.4.1 exactly
as in 1.3.0, so nothing about the workaround moves. The upstream `save` event that
would retire it still does not exist.

**Nothing else in the host moves.** 1.4.1 declares the same dependencies and the
same peers as 1.1.1, so the `@revenexx/studio` ^0.2.2, `@revenexx/studio-shared`
^0.3.0 and `@solar-icons/nuxt` ^1.2.1 pins stand as they are, and the host's tree
resolves with no peer conflict. `NodeInspector`'s props and events are
byte-identical between 1.3.0 and 1.4.1, so `preview-host/pages/nodes.vue` needs
nothing new.

The rest of the three releases lands outside what the preview shows: the
tenant-wide Runs page paging and sorting on the platform (which needs `?sort=` on
`GET /v1/runs`, PO-371), build states that become true on their own, deleting a
workflow from its editor, the loading announcements, template installation taking
the same step from both routes into it (PO-244), the run replay losing its
unreachable `single` mode (PO-350), and — the whole of 1.4.1 — a refused
credential save stating each reason once (PO-477). The Workflows surface is hidden
and `…/runs/*` is deliberately unmocked, so the mock is untouched there: the one
route the three releases change is `…/runs/{id}/steps?include_payloads=` (PO-421),
inside that unmocked prefix.

Two traces do reach the mock, and both already hold. A test run from the editor
now names the workflow it belongs to, so `POST …/execute:test` may carry
`workflow_id`; the preview has no workflow to name and never sends one, and the
mock reads `config`, `inputs` and `timeout_ms` and ignores the rest. And PO-394
gives the studio one answer to whether a response carries a `data` envelope,
replacing nine expressions that each decided for themselves — the rule being that
a collection is wrapped and a single record is bare. The shared `unwrapRecord`
still accepts either shape and only fails on an absent record, and the mock's
wrapped single records are what this repository's own contract snapshot declares
(`GET /credential-types/{slug}` among them), so nothing here needs to change. If
that leniency is ever tightened to match the table, the envelope is a shape — which
means the contract test would catch it, unlike the ordering above.
