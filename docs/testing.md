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

## Validating node config in a test

The same validation the preview uses is exported from the main entry point, so you can
assert on it directly:

```ts
import { validateNodeConfig } from '@revenexx/integrations-node-devkit';
```

It checks a config payload against the manifest's field rules — required fields,
`IConfigValidation`, types, static options, and the children of resolved dynamic
schemas.
