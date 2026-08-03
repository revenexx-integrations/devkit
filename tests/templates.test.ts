import { describe, expect, it } from 'vitest';
import { previewTemplates } from '../src/preview/templates.js';

describe('preview host templates', () => {
  const files = previewTemplates({ integrationsApiUrl: 'http://localhost:3555/api/v1' });

  it('emits the custom local-nodes page', () => {
    expect(Object.keys(files)).toContain('pages/nodes.vue');
  });

  it('reuses the editor lightbox (studio Dialog + NodeInspector) and calls config:validate', () => {
    const page = files['pages/nodes.vue']!;
    expect(page).toContain('IntegrationsNodeInspector'); // reuse the real edit-view
    expect(page).toContain('DialogContent'); // wrapped in the studio Dialog, like WorkflowEditor
    expect(page).toContain('config:validate');
  });

  it('links to the nodes page from the landing page', () => {
    expect(files['pages/index.vue']).toContain('/nodes');
  });

  it('hides the workflows surface (phase 1): nav CSS + redirect middleware, not linked from index', () => {
    expect(files['assets/css/main.css']).toContain('a[href^="/integrations/workflows"]');
    const mw = files['middleware/hide-workflows.global.ts'];
    expect(mw).toBeDefined();
    expect(mw).toContain("navigateTo('/integrations')");
    expect(files['pages/index.vue']).not.toContain('/integrations/workflows');
  });

  it('ships console-composable stubs so the credential dialog does not crash', () => {
    const stubs = files['composables/devkit-console-stubs.ts'];
    expect(stubs).toBeDefined();
    for (const fn of ['useConsoleTenants', 'useActiveMarket', 'useConsoleSftp', 'useMailAdmin', 'useConsoleApiKeys']) {
      expect(stubs).toContain(`export function ${fn}(`);
    }
  });

  it('pins the studio 0.5.x peer set with the new peers', () => {
    const pkg = files['package.json']!;
    expect(pkg).toContain('"@revenexx/studio-integrations": "^0.5.1"');
    expect(pkg).toContain('@tiptap/core');
    expect(pkg).toContain('@vue-flow/node-toolbar');
    expect(pkg).toContain('vue-sonner');
  });
});
