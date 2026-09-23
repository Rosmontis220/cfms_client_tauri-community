#!/usr/bin/env node
// Build the 小工具 community plugin.
//
// The bundling, the shell checks and the output layout are shared with every
// other plugin that ships its own page code; see
// `scripts/lib/com-ext-page-build.mjs`. This file only describes this plugin's
// inputs.
//
// Usage (from the repository root):
//   node plugins/tools/build.mjs
//
// Output:
//   plugins/tools/dist/com_ext.json
//   plugins/tools/dist/pages/tools.html

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { buildComExtPage, pluginDirectory } from '../../scripts/lib/com-ext-page-build.mjs';

/**
 * `buffer` is a Node core module that ships a browser build; the esbuild
 * `browser` platform would otherwise leave the bare `buffer` import external
 * and the page would throw `Buffer is not defined` inside the webview.
 */
function bufferBrowserEntry() {
  const require = createRequire(import.meta.url);
  try {
    const packageJsonPath = require.resolve('buffer/package.json');
    const packageDir = dirname(packageJsonPath);
    const packageJson = require('buffer/package.json');
    const browserEntry = packageJson.browser ?? packageJson.main ?? 'index.js';
    return resolve(packageDir, typeof browserEntry === 'string' ? browserEntry : 'index.js');
  } catch (cause) {
    console.error(
      '\n[plugins/tools] build failed: the `buffer` package is not installed; it is a ' +
        'devDependency used to polyfill Buffer for the 编码转换 tool',
    );
    console.error(cause instanceof Error ? cause.stack ?? cause.message : cause);
    process.exit(1);
  }
}

await buildComExtPage({
  label: 'plugins/tools',
  directory: pluginDirectory(import.meta.url),
  entry: 'src/page.ts',
  shell: 'src/page.html',
  manifest: 'com_ext.json',
  page: 'pages/tools.html',
  aliases: { buffer: bufferBrowserEntry() },
});
