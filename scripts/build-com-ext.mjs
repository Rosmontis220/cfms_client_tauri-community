#!/usr/bin/env node
// Build a community plugin and pack it into an installable `.cfmscomext`.
//
// A plugin directory may carry a `build.mjs` that turns its sources into the
// files that ship (`dist/`). A plugin with no build step is packed as it sits,
// so a hand-written plugin is just a folder.
//
// Usage:
//   node scripts/build-com-ext.mjs <plugin> [output.cfmscomext]
//   node scripts/build-com-ext.mjs --all [output-dir]

import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

import { packPlugin } from './pack-com-ext.mjs';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/// Run a plugin's own build step, if it has one.
function runBuild(pluginDirectory) {
  const script = join(pluginDirectory, 'build.mjs');
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${script} exited with status ${result.status}`);
  }
}

/// The directory that actually ships: the built output when there is one.
async function shippingSource(pluginDirectory) {
  const built = join(pluginDirectory, 'dist');
  return (await exists(built)) ? built : pluginDirectory;
}

async function buildOne(name, outputPath) {
  const pluginDirectory = resolve('plugins', name);
  if (!(await exists(pluginDirectory))) {
    throw new Error(`No plugin directory at ${pluginDirectory}`);
  }

  if (await exists(join(pluginDirectory, 'build.mjs'))) {
    runBuild(pluginDirectory);
  }

  const result = await packPlugin(await shippingSource(pluginDirectory), outputPath);
  const digest = createHash('sha256').update(result.archive).digest('hex');
  console.log(
    `\nPacked ${result.manifest.id} ${result.manifest.version}\n` +
      `  -> ${result.outputPath}\n` +
      `  ${result.archive.length} bytes\n` +
      `  sha256 ${digest}`,
  );
  return result;
}

async function main() {
  const [target, output] = process.argv.slice(2);

  if (!target) {
    console.error('Usage: node scripts/build-com-ext.mjs <plugin> [output.cfmscomext]');
    console.error('       node scripts/build-com-ext.mjs --all [output-dir]');
    process.exit(2);
  }

  if (target === '--all') {
    const entries = await readdir(resolve('plugins'), { withFileTypes: true }).catch(() => []);
    const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    if (names.length === 0) {
      console.error('No plugin directories under plugins/');
      process.exit(2);
    }
    const outputRoot = resolve(output ?? 'dist-plugins');
    for (const name of names) {
      await buildOne(name, join(outputRoot, `${name}.cfmscomext`));
    }
    return;
  }

  const outputPath = resolve(output ?? join('dist-plugins', `${target}.cfmscomext`));
  await buildOne(target, outputPath);
}

await main();
