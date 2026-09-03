---
"@revenexx/integrations-node-devkit": minor
---

Support `ctx.state`, the tenant state store nodes gained in PO-374.

`createMockContext` now builds a `state` mock, and it is **stateful**: what the
node writes, it reads back. A node's interesting behaviour is the second run —
the one that finds the mapping it created the first time — and a mock that
forgot would only ever exercise the create branch. Seed what earlier runs left
behind with `state: { mappings, cursors, claims, digests }`, force the engine's
refusal with `stateError`, and assert on the calls: every operation is a
`vi.fn()`.

It reads back *when the store would let it*. A mapping and a claim take effect
immediately; a cursor and a digest are staged and adopted only once the run
completes, so `cursor.get` answers what the last completed run left. The mock
context gains `completeRun()` for that ending — call it between two `execute`
calls to play the second run, leave it out to play the run that failed after
advancing its watermark. Re-pointing either side of an existing correlation is
refused, and a `ttlSeconds` outside 1…31536000 is refused rather than clamped:
the rules a node would otherwise meet for the first time in production.

The local preview's `execute:test` is wired to the dev store too, so a node that
correlates ids behaves on its second call like a second run, and a preview call
that fails leaves its staged cursors and digests behind. That the store is
writable at all is a deliberate divergence from production, where author-time
execution is read-only — see the fidelity caveats in the README.

`POST /nodes/{slug}/{version}/config:validate` now honours `showIf` and knows
`state-ref`, the two config-field additions that ride along in the same SDK
release (PO-410, PO-374). A setting whose condition does not hold is skipped
whole — not demanded when required, not type-checked either, because the editor
does not draw it — using the SDK's own `settingApplies` rather than a second
copy of the rule. A `state-ref` is checked as the namespace name it carries.

Requires `@revenexx/integrations-node-sdk` >= 1.0.0, which is where
`INodeContext.state` is declared. That SDK release is a major one precisely
because `state` is required — and this package is the reason it is felt
immediately: `MockContext` is `INodeContext & {…}`, so it cannot compile against
the new contract without supplying `state`.
