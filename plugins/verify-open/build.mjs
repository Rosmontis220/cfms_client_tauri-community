#!/usr/bin/env node
import { buildComExtPage, pluginDirectory } from '../../scripts/lib/com-ext-page-build.mjs';

await buildComExtPage({
  label: 'plugins/verify-open',
  directory: pluginDirectory(import.meta.url),
  entry: 'src/page.ts',
  shell: 'src/page.html',
  manifest: 'com_ext.json',
  page: 'pages/verify-open.html',
});
