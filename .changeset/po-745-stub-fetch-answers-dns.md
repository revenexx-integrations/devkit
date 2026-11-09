---
"@revenexx/integrations-node-devkit": minor
---

`stubFetch` now answers DNS as well: while it is active, `lookup` on `node:dns/promises` resolves every host but `localhost` and an IP literal to a public address, so a request through the SDK's `safeFetch` reaches the stub without asking real DNS. A stubbed suite runs offline and no longer goes red on a slow resolver. `restore()` puts the previous `lookup` back, and `stubFetch(handler, { dns: false })` leaves DNS real for a test that needs it. The address is exported as `STUB_DNS_ADDRESS`.
