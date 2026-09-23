#!/usr/bin/env node
// Build the 小工具 community plugin.
//
// A plugin page is ONE self-contained HTML file: the host lifts its `<script>`
// blocks out, appends the rest to a shadow root, then evaluates each script as
// the body of `new Function('root', 'pluginId', code)`. So this script bundles
// `src/page.ts` into a single IIFE — no imports, no network, no host runtime —
// and inlines it into the page shell at the `<!--BUNDLE-->` marker.
//
// Usage (from the repository root):
//   node plugins/tools/build.mjs
//
// Output:
//   plugins/tools/dist/com_ext.json
//   plugins/tools/dist/pages/tools.html
//
// `META-INF/files.json` is deliberately NOT written here: the packer
// (`scripts/pack-com-ext.mjs`) generates it, because it must hash exactly what
// ships.

import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, 'src', 'page.ts');
const shellPath = join(here, 'src', 'page.html');
const manifestPath = join(here, 'com_ext.json');
const distDir = join(here, 'dist');
const pageOut = join(distDir, 'pages', 'tools.html');
const manifestOut = join(distDir, 'com_ext.json');

/** The exact marker the shell must contain exactly once. */
const BUNDLE_MARKER = '<!--BUNDLE-->';

function fail(message, cause) {
  console.error(`\n[plugins/tools] build failed: ${message}`);
  if (cause) console.error(cause instanceof Error ? cause.stack ?? cause.message : cause);
  process.exit(1);
}

async function readRequired(path, description) {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    fail(`cannot read ${description} at ${path}`, cause);
  }
}

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
    fail(
      'the `buffer` package is not installed; it is a devDependency used to ' +
        'polyfill Buffer for the 编码转换 tool',
      cause,
    );
  }
}

async function bundle() {
  let result;
  try {
    result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      globalName: 'ComExtPlugin',
      platform: 'browser',
      target: 'es2022',
      write: false,
      logLevel: 'info',
      alias: { buffer: bufferBrowserEntry() },
      // Keep the bundle readable-ish and free of a sourcemap: the page is one
      // file the host hashes, so an extra sidecar would never be loaded.
      minify: false,
      legalComments: 'none',
      charset: 'utf8',
    });
  } catch (cause) {
    fail('esbuild could not bundle src/page.ts', cause);
  }

  const outputs = result.outputFiles ?? [];
  const bundleOutput = outputs.find((file) => file.path.endsWith('.js')) ?? outputs[0];
  if (!bundleOutput) fail('esbuild produced no output for src/page.ts');

  const code = bundleOutput.text;
  if (!code.trim()) fail('esbuild produced an empty bundle for src/page.ts');
  // A plugin that cannot be mounted is worse than a failed build.
  for (const required of ['ComExtPlugin', 'function mount']) {
    if (!code.includes(required)) {
      fail(`the bundle does not contain "${required}", so the page could not be mounted`);
    }
  }
  return code;
}

async function main() {
  const shell = await readRequired(shellPath, 'page shell (src/page.html)');
  const manifestText = await readRequired(manifestPath, 'manifest (com_ext.json)');

  const markers = shell.split(BUNDLE_MARKER).length - 1;
  if (markers === 0) fail(`src/page.html has no ${BUNDLE_MARKER} marker to inject the bundle into`);
  if (markers > 1) fail(`src/page.html has ${markers} ${BUNDLE_MARKER} markers; expected exactly one`);

  try {
    JSON.parse(manifestText);
  } catch (cause) {
    fail('com_ext.json is not valid JSON', cause);
  }

  const code = await bundle();

  // `</script>` inside the bundle would close the tag early. esbuild escapes
  // the sequence when it emits strings, but the guard keeps that a hard error
  // rather than a page that silently truncates.
  if (code.includes('</script')) {
    fail('the bundle contains a literal </script> sequence, which would break the inline tag');
  }

  const html = shell.replace(BUNDLE_MARKER, `<script>\n${code}\n</script>`);
  if (html.includes(BUNDLE_MARKER)) fail('the bundle marker survived injection');

  await mkdir(dirname(pageOut), { recursive: true });
  await writeFile(pageOut, html, 'utf8');
  await writeFile(manifestOut, manifestText, 'utf8');

  const kilobytes = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`[plugins/tools] wrote ${pageOut} (${kilobytes} KiB)`);
  console.log(`[plugins/tools] wrote ${manifestOut}`);
}

await main();
