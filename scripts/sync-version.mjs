#!/usr/bin/env node
/**
 * Keeps `DEVKIT_VERSION` in `src/index.ts` in step with `package.json`.
 *
 * `changeset version` only rewrites `package.json`, so the exported constant —
 * which is what `integrations-devkit --version` prints — silently kept saying
 * 0.1.0 after the 0.2.0 release. This runs as part of the `version` script so
 * the two can never drift again; never edit either value by hand.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/index.ts');

const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const source = readFileSync(entry, 'utf8');

const pattern = /^(export const DEVKIT_VERSION = ')(.*)(';)$/m;
const match = source.match(pattern);
if (!match) {
  console.error(`sync-version: no "export const DEVKIT_VERSION = '…';" line in ${entry}`);
  process.exit(1);
}

if (match[2] === version) {
  console.log(`sync-version: DEVKIT_VERSION already ${version}`);
  process.exit(0);
}

writeFileSync(entry, source.replace(pattern, `$1${version}$3`));
console.log(`sync-version: DEVKIT_VERSION ${match[2]} -> ${version}`);
