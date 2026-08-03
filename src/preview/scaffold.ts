import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { previewTemplates } from './templates.js';

export interface ScaffoldPreviewOptions {
  /** Target directory for the host (default `.revenexx-dev/preview`). */
  dir: string;
  /** Mock API base URL baked into `.env`. */
  integrationsApiUrl: string;
  /** Overwrite existing files. */
  force?: boolean;
  log?: (msg: string) => void;
}

export interface ScaffoldResult {
  dir: string;
  written: string[];
  skipped: string[];
}

/**
 * Writes the Nuxt preview host into `dir`. Idempotent: existing files are left
 * untouched unless `force` is set. Returns which files were written vs skipped.
 */
export function scaffoldPreview(options: ScaffoldPreviewOptions): ScaffoldResult {
  const log = options.log ?? (() => {});
  const files = previewTemplates({ integrationsApiUrl: options.integrationsApiUrl });
  const written: string[] = [];
  const skipped: string[] = [];

  for (const [relative, content] of Object.entries(files)) {
    const target = resolve(options.dir, relative);
    if (existsSync(target) && !options.force) {
      skipped.push(relative);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf-8');
    written.push(relative);
  }

  if (written.length > 0) {
    log(`Scaffolded preview host in ${options.dir} (${written.length} file(s)).`);
  }
  if (skipped.length > 0) {
    log(`Kept ${skipped.length} existing file(s) (use --force to overwrite).`);
  }
  return { dir: options.dir, written, skipped };
}

/** True when the preview host has its dependencies installed. */
export function previewDepsInstalled(dir: string): boolean {
  return existsSync(join(dir, 'node_modules'));
}

/** True when a preview host has been scaffolded in `dir`. */
export function previewExists(dir: string): boolean {
  return existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'nuxt.config.ts'));
}
