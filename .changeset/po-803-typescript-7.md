---
"@revenexx/integrations-node-devkit": patch
---

Built with TypeScript 7 (PO-803). The declarations now come as one `.d.ts` per module, written by TypeScript 7's own compiler, because tsup's declaration build still needs the compiler API TypeScript 7 no longer ships. The API is unchanged: read with TypeScript 5.9, both entries export the same names with the same types (49 for the root, 33 for `/testing`), and the JavaScript is byte for byte the same.
