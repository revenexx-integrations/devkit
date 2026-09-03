# Testing Harness

The harness is a separate entry point, `@revenexx/integrations-node-devkit/testing`. It
needs no running server and no network access.

`vitest` is an **optional peer dependency** — the harness uses `vi` spies, so install
vitest in your node package if it is not there already.

## What it provides

| Export | Use it for |
| --- | --- |
| `createMockContext` | An `INodeContext` for calling `node.execute`. |
| `createAuthorContext` | An author-time context for `loadOptions`, `resolveConfigSchema`, `resolveOutputs`. |
| `runCredentialResolve` | Driving a credential's `resolve`, including durable-credential rotation. |
| `stubFetch` | Replacing global `fetch` for the duration of a test. |
| `fakeTokenEndpoint` | A canned OAuth token endpoint to hand to `stubFetch`. |

## Example

```ts
import { describe, it, expect } from 'vitest';
import {
  createMockContext,
  createAuthorContext,
  runCredentialResolve,
  stubFetch,
  fakeTokenEndpoint,
} from '@revenexx/integrations-node-devkit/testing';

// execute
const ctx = createMockContext({ credentials: { 'smtp-1': { host: 'mail' } } });
const res = await node.execute(ctx, { credentials: 'smtp-1' });

// author-time resolver
const authorCtx = createAuthorContext({ category: 'fruits' });
const options = await node.loadOptions(authorCtx, 'item');

// credential resolve + OAuth rotation, no network and no broker
const stub = stubFetch(fakeTokenEndpoint({ accessToken: 'AT', refreshToken: 'RT' }));
const { result, persistDurableCreds } = await runCredentialResolve(cred, {
  config: { clientId: 'x' },
  durableCreds: { refreshToken: 'old' },
});
expect(persistDurableCreds).toHaveBeenCalledWith({ refreshToken: 'RT' });
stub.restore();
```

Always call `stub.restore()` — ideally in an `afterEach` — so a stubbed `fetch` cannot
leak into the next test.

## What a node remembers between runs

`createMockContext` builds `ctx.state` (PO-374, SDK 1.0.0) as well, and it is **stateful**:
what the node writes, it reads back. That is the point — a sync node's interesting
behaviour is the *second* run, the one that finds the mapping the first one created, and a
stub that forgot between calls could only ever exercise the create branch. It is also the
only place writes can be tested at all: in the real product, author-time execution is
read-only.

Seed what earlier runs left behind, and assert on the calls — every operation is a
`vi.fn()`:

```ts
const ctx = createMockContext({
  state: {
    mappings: { article: { 'pim:12345': 'erp:A-8891' } },
    cursors: { 'crm.customers': { '': { updatedAfter: '2026-08-01T00:00:00Z' } } },
    claims: { orders: ['evt_1'] },
    digests: { 'article.hash': { 'article:1': 'sha-abc' } },
  },
});

await node.execute(ctx, { id: '12345' });
expect(ctx.state.mapping.put).not.toHaveBeenCalled(); // it was already correlated
```

The store's own rules are kept, so a node cannot pass here and meet them for the first time
in production:

| Rule | What it means for a test |
| --- | --- |
| A mapping and a claim take effect immediately | `mapping.get` and `claim` answer the write straight away. |
| A cursor and a digest are **staged** | `cursor.get` / `digest.unchanged` answer what the last *completed* run left. Call `ctx.completeRun()` to end the run and adopt them; leave it out to play a run that failed after advancing its watermark. |
| Re-pointing a correlation is refused | `mapping.put` rejects when either side is already correlated with something else. Writing the same pair again is fine. |
| `ttlSeconds` is 1…31536000 | `claim` rejects a window outside it rather than clamping. |

`stateError` makes every state call reject — the shape of the engine refusing a namespace
the workflow never declared:

```ts
const ctx = createMockContext({ stateError: new Error('namespace is not in scope') });
```

## Validating node config in a test

The same validation the preview uses is exported from the main entry point, so you can
assert on it directly:

```ts
import { validateNodeConfig } from '@revenexx/integrations-node-devkit';
```

It checks a config payload against the manifest's field rules — required fields,
`IConfigValidation`, types, static options, and the children of resolved dynamic
schemas.

A field whose `showIf` does not hold (SDK 1.0.0, PO-410) is skipped whole: not demanded
when required, and not type-checked either. The editor does not draw it, so a value left
under its key is a leftover from a choice the author has since changed. The decision comes
from the SDK's own `settingApplies`, so the editor drawing the field and this validator
demanding it cannot drift apart.
