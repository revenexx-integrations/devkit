import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/testing/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  // Declarations come from TypeScript 7's own compiler (tsconfig.build.json):
  // tsup's declaration build needs the compiler API TypeScript 7 no longer ships.
  dts: false,
  clean: true,
  sourcemap: true,
  // `DEVKIT_VERSION` reads package.json via `import.meta.url`, which esbuild
  // stubs as `{}` in the CJS output — without this shim the `require` entry
  // throws "Invalid URL" on import.
  shims: true,
});
