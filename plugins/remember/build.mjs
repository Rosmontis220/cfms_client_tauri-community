#!/usr/bin/env node
// Build the 记住用户名密码 community plugin.
//
// The bundling, the shell checks and the output layout are shared with every
// other plugin that ships its own page code; see
// `scripts/lib/com-ext-page-build.mjs`. This file only describes this plugin's
// inputs.
//
// Usage (from the repository root):
//   node plugins/remember/build.mjs
//
// Output:
//   plugins/remember/dist/com_ext.json
//   plugins/remember/dist/pages/panel.html

import { buildComExtPage, pluginDirectory } from '../../scripts/lib/com-ext-page-build.mjs';

await buildComExtPage({
  label: 'plugins/remember',
  directory: pluginDirectory(import.meta.url),
  entry: 'src/page.ts',
  shell: 'src/page.html',
  manifest: 'com_ext.json',
  page: 'pages/panel.html',
});
