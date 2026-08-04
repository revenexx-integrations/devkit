import { describe, expect, it } from 'vitest';
import { isReloadableSource } from '../src/loader.js';

/**
 * The hot-reload watcher's file filter. Worth testing on its own because the
 * watcher itself is `fs.watch` on a real directory — awkward to drive, and its
 * failure mode is silence: an extension the filter misses means edits land and
 * nothing reloads, with nothing logged to say why.
 */
describe('isReloadableSource', () => {
  it('accepts the TypeScript family', () => {
    for (const file of ['index.ts', 'node.tsx', 'thing.cts', 'thing.mts']) {
      expect(isReloadableSource(file), file).toBe(true);
    }
  });

  /**
   * `.mjs` and `.cjs` were the gap: the filter was the TypeScript family plus a
   * bare `.js`, so a package built to ESM `dist/index.mjs` never hot-reloaded.
   */
  it('accepts the JavaScript family, including .mjs and .cjs', () => {
    for (const file of ['index.js', 'node.jsx', 'index.mjs', 'index.cjs']) {
      expect(isReloadableSource(file), file).toBe(true);
    }
  });

  it('accepts .json, which nodes import for locales and lookup data', () => {
    expect(isReloadableSource('locales/de.json')).toBe(true);
  });

  it('ignores files that cannot change what the package exports', () => {
    for (const file of ['README.md', 'index.js.map', 'logo.svg', 'styles.css', '.DS_Store', 'notes.txt']) {
      expect(isReloadableSource(file), file).toBe(false);
    }
  });

  it('matches on the extension, not anywhere in the path', () => {
    // A directory named after an extension must not make every file in it reload.
    expect(isReloadableSource('src/ts/README.md')).toBe(false);
    expect(isReloadableSource('src/json/notes.txt')).toBe(false);
  });
});
