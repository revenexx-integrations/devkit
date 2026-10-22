---
"@revenexx/integrations-node-devkit": patch
---

The testing harness works under Vitest 5 as well as Vitest 2. Its spies are now typed `Mock<(...args: any[]) => any>`, which is what they were under Vitest 2; written as `ReturnType<typeof vi.fn>` they would have become a type no logger or `secrets.get` signature accepts from Vitest 3 on. The devkit's own tests run on Vitest 5.
