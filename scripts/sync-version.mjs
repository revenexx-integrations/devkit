/**
 * Sync the package version into the `DEVKIT_VERSION` constant.
 *
 * `changeset version` only bumps package.json (and CHANGELOG.md). The version
 * is also a source constant in `src/index.ts` — it is a public export and backs
 * `integrations-devkit --version` — so the two must stay in lockstep. Without
 * this, a released 0.2.0 would keep reporting 0.1.0.
 *
 * Run right after `changeset version` (see the `version` npm script), so the
 * resulting "Version Packages" PR carries both files in sync.
 *
 * A leading `v` is stripped defensively: the git release tag is `v{version}`,
 * but the constant must be the bare SemVer.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/index.ts';
// Matches the single `export const DEVKIT_VERSION = '<semver>';` declaration.
const PATTERN = /(export const DEVKIT_VERSION = ')([^']*)(';)/;

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version.replace(/^v/, '');
const source = readFileSync(FILE, 'utf8');

const match = source.match(PATTERN);
if (!match) {
  // Fail loudly: silently skipping would ship a wrong version constant.
  console.error(`✗ Could not find the DEVKIT_VERSION declaration in ${FILE}.`);
  process.exit(1);
}

if (match[2] === version) {
  console.log(`DEVKIT_VERSION already at ${version} — nothing to do.`);
} else {
  writeFileSync(FILE, source.replace(PATTERN, `$1${version}$3`));
  console.log(`✓ DEVKIT_VERSION ${match[2]} -> ${version}`);
}
