// Shared build step for a community plugin whose page ships its own code.
//
// A plugin page is ONE self-contained HTML file: the host lifts its `<script>`
// blocks out, appends the rest to a shadow root, then evaluates each script as
// the body of `new Function('root', 'pluginId', 'host', code)`. So a build step
// has to bundle the plugin's TypeScript into a single IIFE — no imports, no
// network, no host runtime — and inline it into the page shell at the marker.
//
// Every such plugin needs the same checks done the same way: the shell must
// carry exactly one injection marker, the manifest must parse, the bundle must
// actually contain a mountable entry, and a literal `</script>` must never
// reach the page. Four copies of that would drift, so it lives here and each
// plugin's `build.mjs` only describes its own inputs.
//
// `META-INF/files.json` is deliberately NOT written here: the packer
// (`scripts/pack-com-ext.mjs`) generates it, because it must hash exactly what
// ships.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

/** The exact marker the shell must contain exactly once. */
export const BUNDLE_MARKER = '<!--BUNDLE-->';

/**
 * Bundle `config.entry` and write the shipping files under `<directory>/dist`.
 *
 * @param {object} config
 * @param {string} config.label        Prefix for log and error lines.
 * @param {string} config.directory    The plugin's own directory.
 * @param {string} config.entry        Bundle entry, relative to `directory`.
 * @param {string} config.shell        Page shell, relative to `directory`.
 * @param {string} config.manifest     Manifest, relative to `directory`.
 * @param {string} config.page         Output page path under `dist/`.
 * @param {string} [config.globalName] IIFE global the bundle exposes.
 * @param {Record<string, string>} [config.aliases] esbuild aliases.
 * @param {string[]} [config.requireTokens] Strings the bundle must contain.
 */
export async function buildComExtPage(config) {
  const {
    label,
    directory,
    entry,
    shell,
    manifest,
    page,
    globalName = 'ComExtPlugin',
    aliases,
    requireTokens = [globalName, 'function mount'],
  } = config;

  const fail = (message, cause) => {
    console.error(`\n[${label}] build failed: ${message}`);
    if (cause) console.error(cause instanceof Error ? cause.stack ?? cause.message : cause);
    process.exit(1);
  };

  const readRequired = async (path, description) => {
    try {
      return await readFile(path, 'utf8');
    } catch (cause) {
      fail(`cannot read ${description} at ${path}`, cause);
    }
  };

  const shellPath = resolve(directory, shell);
  const manifestPath = resolve(directory, manifest);
  const pageOut = resolve(directory, 'dist', page);
  const manifestOut = resolve(directory, 'dist', 'com_ext.json');

  const shellText = await readRequired(shellPath, 'page shell');
  const manifestText = await readRequired(manifestPath, 'manifest');

  const markers = shellText.split(BUNDLE_MARKER).length - 1;
  if (markers === 0) fail(`${shell} has no ${BUNDLE_MARKER} marker to inject the bundle into`);
  if (markers > 1) fail(`${shell} has ${markers} ${BUNDLE_MARKER} markers; expected exactly one`);

  try {
    JSON.parse(manifestText);
  } catch (cause) {
    fail(`${manifest} is not valid JSON`, cause);
  }

  let result;
  try {
    result = await esbuild.build({
      entryPoints: [resolve(directory, entry)],
      bundle: true,
      format: 'iife',
      globalName,
      platform: 'browser',
      target: 'es2022',
      write: false,
      logLevel: 'info',
      ...(aliases ? { alias: aliases } : {}),
      // Keep the bundle readable and free of a sourcemap: the page is one file
      // the host hashes, so an extra sidecar would never be loaded.
      minify: false,
      legalComments: 'none',
      charset: 'utf8',
    });
  } catch (cause) {
    fail(`esbuild could not bundle ${entry}`, cause);
  }

  const outputs = result.outputFiles ?? [];
  const bundleOutput = outputs.find((file) => file.path.endsWith('.js')) ?? outputs[0];
  if (!bundleOutput) fail(`esbuild produced no output for ${entry}`);

  const code = bundleOutput.text;
  if (!code.trim()) fail(`esbuild produced an empty bundle for ${entry}`);
  // A plugin that cannot be mounted is worse than a failed build.
  for (const required of requireTokens) {
    if (!code.includes(required)) {
      fail(`the bundle does not contain "${required}", so the page could not be mounted`);
    }
  }

  // `</script>` inside the bundle would close the tag early. esbuild escapes
  // the sequence when it emits strings, but the guard keeps that a hard error
  // rather than a page that silently truncates.
  if (code.includes('</script')) {
    fail('the bundle contains a literal </script> sequence, which would break the inline tag');
  }

  const html = shellText.replace(BUNDLE_MARKER, `<script>\n${code}\n</script>`);
  if (html.includes(BUNDLE_MARKER)) fail('the bundle marker survived injection');

  await mkdir(dirname(pageOut), { recursive: true });
  await writeFile(pageOut, html, 'utf8');
  await writeFile(manifestOut, manifestText, 'utf8');

  const kilobytes = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`[${label}] wrote ${pageOut} (${kilobytes} KiB)`);
  console.log(`[${label}] wrote ${manifestOut}`);
}

/** The plugin's own directory, from a `build.mjs` at its root. */
export function pluginDirectory(importMetaUrl) {
  return dirname(fileURLToPath(importMetaUrl));
}
