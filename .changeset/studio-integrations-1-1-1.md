---
'@revenexx/integrations-node-devkit': minor
---

The preview host moves to `@revenexx/studio-integrations` 1.1.1

The pin was 0.6.0, four releases and one major behind. The major (1.0.0) is about the
workflow editor — one Save in the header, every dialog left by Cancel or Done — which the
preview does not show, and it left `NodeInspector` alone: `update` is still emitted only
when the draft is `dirty`, `close` still always, and `refusedFields` is still there. So the
node preview's arrangement from 0.5.1 — the key stamped onto `selection` that makes `dirty`
permanently true, which is what tells a Save from a Cancel — holds unchanged. The upstream
`save` event that would retire it still does not exist.

What the node preview gains is 1.0.0's reading of a manifest's `inputs`: the panel of
available data now opens with what the node itself takes — data type, whether an upstream
connection is required, and the publisher's sentence about it — and an output port's and
field's descriptions appear on the Output tab and on the handle's tooltip. The studio had
been asking the catalogue under a key the service does not use and dropping all of it. The
mock passes the manifest through verbatim, so a node package that describes its ports gets
this with no devkit change.

`@revenexx/studio-shared` moves to ^0.3.0 with it, which is what 1.1.1 requires, and that
brings two dependencies the host did not need before. 0.3.0 adds the Talkback realtime
seam, and its `talkback.js` reaches for `@revenexx/talkback-js` through a dynamic import
that Rolldown must still resolve — so `nuxt build` fails outright without the package, even
though the composable is inert while `talkbackHost` is empty, which in the preview it always
is. `@revenexx/talkback-js` and its own peer `centrifuge` are therefore direct dependencies
of the host: present so the bundler can resolve them, never connected to.

**Where the preview is now thinner than production.** studio 1.1.0 stopped assembling the
tenant's runs, counts and schedules in the browser and reads the platform's own lists
instead — `GET /runs`, `/runs/summary`, `/runs/latest-per-workflow`, `/schedules` and
`/dead-letters/summary`. The mock serves none of them, so the Integrations dashboard's
figures and the Schedules page report a refused read rather than the zeroes they used to
show. That is the phase-1 boundary the workflow editor is already behind, and it is not new
scope — but it is newly visible, and the guard that should have said so was asleep: the
vendored contract snapshot predates all five endpoints, so `tests/contract.test.ts` passes
while the mock lacks them. Refreshing it is its own change — it also surfaces a renamed
trigger path parameter and a widened `secrets` response — and is not done here.
