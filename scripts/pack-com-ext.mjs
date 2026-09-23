#!/usr/bin/env node
// Pack a community plugin directory into a `.cfmscomext` archive.
//
// A plugin is a directory, and a `.cfmscomext` is that directory zipped. The
// host verifies the archive on import, so this script's only jobs are to
// produce a well-formed zip and to generate the `META-INF/files.json` index the
// host uses to detect later edits. It deliberately performs no signing: the
// community interface has no trust root, by design.
//
// Usage:
//   node scripts/pack-com-ext.mjs <plugin-dir> [output.cfmscomext]
//   node scripts/pack-com-ext.mjs --all [output-dir]

import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/// Mirror of the host's allowlist in `crates/service/src/com_ext/package.rs`.
/// Kept in sync by hand: the host is the authority, and a package it refuses
/// must be refused here too, where the author can still be told why.
const MANIFEST_FILENAME = 'com_ext.json';
const FILES_INDEX_PATH = 'META-INF/files.json';
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 512;

const allowedPath = (path) =>
  path === MANIFEST_FILENAME ||
  (path.startsWith('pages/') && (path.endsWith('.json') || path.endsWith('.html'))) ||
  (path.startsWith('workflows/') && path.endsWith('.json')) ||
  (path.startsWith('slots/') && path.endsWith('.json')) ||
  (path.startsWith('hooks/') && path.endsWith('.json')) ||
  (path.startsWith('assets/') && /\.(png|jpg|jpeg|webp|gif|ico)$/i.test(path));

async function collect(root, directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Plugin contains a symbolic link, which the host refuses: ${absolute}`);
    }
    if (entry.isDirectory()) {
      await collect(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) continue;

    const path = relative(root, absolute).split(sep).join('/');
    if (path === FILES_INDEX_PATH) continue;
    if (!allowedPath(path)) {
      // The same explanation the host gives, but before the archive exists.
      throw new Error(
        `Plugin contains "${path}", which the host does not allow in a package. ` +
          `Allowed: ${MANIFEST_FILENAME}, META-INF/, pages/*.json, pages/*.html, ` +
          'workflows/*.json, slots/*.json, hooks/*.json, assets/*.{png,jpg,jpeg,webp,gif,ico}',
      );
    }
    files.set(path, await readFile(absolute));
  }
}

/// Write a zip archive. Entries are stored with deflate, matching what the
/// host's own packer produces.
function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [path, contents] of entries) {
    const name = Buffer.from(path, 'utf8');
    const compressed = deflateRawSync(contents, { level: 9 });
    const crc = crc32(contents);

    // A stored entry is used when deflating did not help, which happens for
    // already-compressed assets.
    const useDeflate = compressed.length < contents.length;
    const payload = useDeflate ? compressed : contents;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1980-01-01, so builds are reproducible
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, so the mode above is read
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function packPlugin(directory, outputPath) {
  const root = resolve(directory);
  const manifestPath = join(root, MANIFEST_FILENAME);
  const manifestBytes = await readFile(manifestPath).catch(() => null);
  if (!manifestBytes) {
    throw new Error(`${root} has no ${MANIFEST_FILENAME}, so it is not a plugin`);
  }

  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.format !== 'cfmscomext') {
    throw new Error(
      `${MANIFEST_FILENAME} declares format "${manifest.format}"; a community plugin must declare "cfmscomext"`,
    );
  }

  const files = new Map();
  await collect(root, root, files);

  if (files.size + 1 > MAX_FILES) {
    throw new Error(`Plugin has ${files.size} files, over the host's ${MAX_FILES} file limit`);
  }

  // The index covers everything the host will read; it excludes itself. The
  // host re-hashes these files on every page read, so a mismatch is how an
  // on-disk edit is caught.
  const index = {
    files: [...files]
      .map(([path, contents]) => ({
        path,
        sha256: createHash('sha256').update(contents).digest('hex'),
        size: contents.length,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };

  const expanded = [...files.values()].reduce((total, bytes) => total + bytes.length, 0);
  if (expanded > MAX_EXPANDED_BYTES) {
    throw new Error(`Plugin expands to ${expanded} bytes, over the host's ${MAX_EXPANDED_BYTES}`);
  }

  const entries = new Map(files);
  entries.set(FILES_INDEX_PATH, Buffer.from(JSON.stringify(index), 'utf8'));

  const archive = zip(entries);
  if (archive.length > MAX_PACKAGE_BYTES) {
    throw new Error(`Archive is ${archive.length} bytes, over the host's ${MAX_PACKAGE_BYTES}`);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, archive);
  return { archive, manifest, outputPath };
}

async function main() {
  const [target, output] = process.argv.slice(2);

  if (!target) {
    console.error('Usage: node scripts/pack-com-ext.mjs <plugin-dir> [output.cfmscomext]');
    console.error('       node scripts/pack-com-ext.mjs --all [output-dir]');
    process.exit(2);
  }

  if (target === '--all') {
    const pluginsRoot = resolve('plugins');
    const entries = await readdir(pluginsRoot, { withFileTypes: true }).catch(() => []);
    const directories = entries.filter((entry) => entry.isDirectory());
    if (directories.length === 0) {
      console.error(`No plugin directories under ${pluginsRoot}`);
      process.exit(2);
    }

    const outputRoot = resolve(output ?? 'dist-plugins');
    for (const entry of directories) {
      // A plugin directory may keep its built output in `dist/`; that is what
      // ships, so pack that when it exists.
      const source = join(pluginsRoot, entry.name, 'dist');
      const from = (await exists(source)) ? source : join(pluginsRoot, entry.name);
      const result = await packPlugin(from, join(outputRoot, `${entry.name}.cfmscomext`));
      const digest = createHash('sha256').update(result.archive).digest('hex').slice(0, 16);
      console.log(
        `Packed ${result.manifest.id} ${result.manifest.version} -> ${result.outputPath} ` +
          `(${result.archive.length} bytes, sha256 ${digest}…)`,
      );
    }
    return;
  }

  const directory = resolve(target);
  const manifestGuess = JSON.parse(
    await readFile(join(directory, MANIFEST_FILENAME), 'utf8').catch(() => '{"id":"plugin"}'),
  );
  const outputPath = resolve(
    output ?? `${manifestGuess.id ?? basename(directory)}.cfmscomext`,
  );
  const result = await packPlugin(directory, outputPath);
  console.log(
    `Packed ${result.manifest.id} ${result.manifest.version} -> ${result.outputPath} ` +
      `(${result.archive.length} bytes)`,
  );
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Only run when invoked directly, so tests and the build script can import
// `packPlugin` without packing anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
