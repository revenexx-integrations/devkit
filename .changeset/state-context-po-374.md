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

The local preview's `execute:test` is wired to the dev store too, so a node that
correlates ids behaves on its second call like a second run. That is a
deliberate divergence from production, where author-time execution is read-only
— see the fidelity caveats in the README.

Requires `@revenexx/integrations-node-sdk` >= 0.19.0, which is where
`INodeContext.state` is declared.
