---
"@revenexx/integrations-node-devkit": minor
---

`stubFetch` now answers DNS as well: while it is active, `lookup` on `node:dns/promises` resolves every host but `localhost` and an IP literal to a public address, so a request through the SDK's `safeFetch` reaches the stub without asking real DNS. A stubbed suite runs offline and no longer goes red on a slow resolver. `restore()` puts the previous `lookup` back. A `lookup` the test already replaced with a vitest mock is left alone, so a test that resolves a host to a private address keeps its answer; `stubFetch(handler, { dns: false })` leaves DNS real for a test that needs it. A suite that replaces `lookup` with a plain function rather than a mock, and then calls `stubFetch`, gets the stub instead and needs `{ dns: false }`. The address is exported as `STUB_DNS_ADDRESS`.
