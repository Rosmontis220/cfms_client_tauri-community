/**
 * Build every community plugin before the suite runs.
 *
 * The most valuable tests here drive a plugin's **built** page — the artifact a
 * user actually installs — rather than its sources, because the page contract,
 * the bundling, and the host mount are exactly what can break. Those artifacts
 * are deliberately not committed (`.gitignore`: `plugins/*​/dist/`), so without
 * this step a fresh clone would skip those tests and report green: the one
 * outcome worse than a red suite.
 *
 * Each plugin's own `build.mjs` runs on import and describes its inputs, so this
 * discovers them rather than repeating that configuration here.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function setup(): Promise<void> {
  const plugins = 'plugins';
  if (!existsSync(plugins)) return;

  for (const entry of readdirSync(plugins, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const build = join(plugins, entry.name, 'build.mjs');
    if (!existsSync(build)) continue;
    await import(pathToFileURL(build).href);
  }
}
