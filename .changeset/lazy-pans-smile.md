---
'@revenexx/integrations-node-devkit': minor
---

The node preview says why a config is refused instead of closing on it

Opening a node in the preview, pressing Save without filling anything in, and watching the
lightbox vanish in silence was the fastest way to reach the mock's validation — and it never
got there. Two separate faults, both on the way back from the inspector.

Studio's `NodeInspector.save()` emits `update` only when the draft is *dirty*, then always
emits `close`. The page kept the dialog open by flipping a flag inside the `update` handler,
so an untouched form — exactly the "is this field required?" case — handed it nothing but a
`close` and was discarded unvalidated. From the page the two are indistinguishable: Cancel
looks the same. Since a preview has nothing to persist, both footer buttons now mean *check
this config*: a `close` from the inspector validates and keeps the dialog open, and leaving
is the dialog's own ✕, Esc or backdrop — which the dialog now shows a close button for, and
a strip at the top of the lightbox states outright.

The per-field highlight was promised by a prop that did not exist. `refusedFields` landed in
`@revenexx/studio-integrations` 0.6.0 while the host pinned 0.5.1, so the binding fell
through as an inert attribute and "N Feld(er) prüfen (rot markiert)" marked nothing. The
host moves to 0.6.0, and the verdict strip also lists each refused key with its message —
a field can sit behind a collapsed optional section or off-screen, where a colour alone is
not an explanation.
