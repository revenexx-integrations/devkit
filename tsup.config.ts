import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/testing/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  // The CLI is a bin, never imported as a library — only emit declarations for
  // the library entries.
  dts: { entry: ['src/index.ts', 'src/testing/index.ts'] },
  clean: true,
  sourcemap: true,
});
