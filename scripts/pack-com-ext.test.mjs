// Tests for the community plugin packer.
//
// The zip reader below is written independently of the writer on purpose: it
// walks the central directory the way an unzip tool does, so a writer bug that
// happens to be self-consistent still fails here.

import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { packPlugin } from './pack-com-ext.mjs';

/// Read a zip by walking its central directory.
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(end, -1, 'archive must have an end-of-central-directory record');

  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  assert.equal(buffer.readUInt16LE(end + 8), count, 'entries must fit on one disk');
  assert.equal(buffer.readUInt32LE(end + 12), end - offset, 'central directory size must match');

  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'central directory header signature');
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, 'local header signature');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(start, start + compressedSize);

    const contents =
      method === 0 ? payload : method === 8 ? inflateRawSync(payload) : assert.fail('method');

    assert.equal(contents.length, size, `${name}: uncompressed size`);
    assert.equal(crc32(contents), crc, `${name}: crc`);

    entries.set(name, contents);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
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

const manifest = (extra = {}) =>
  JSON.stringify({
    format: 'cfmscomext',
    schema_version: 1,
    id: 'org.example.test',
    name: 'Test Plugin',
    description: 'Used by packer tests',
    publisher: 'tests',
    version: '1.0.0',
    com_ext_api: '1.0.0',
    min_client_version: '1.0.0',
    requested_capabilities: [],
    entrypoints: { pages: [{ id: 'home', label: 'Home', page: 'home' }] },
    background_triggers: [],
    ...extra,
  });

let root;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'com-ext-pack-'));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function plugin(name, files) {
  const directory = join(root, name);
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(directory, path);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, contents);
  }
  return directory;
}

describe('packing a community plugin', () => {
  it('writes an archive whose entries round-trip byte for byte', async () => {
    const directory = await plugin('basic', {
      'com_ext.json': manifest(),
      'pages/home.html': '<!doctype html><p id="out">hi</p><script>2 + 2</script>',
      'assets/icon.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    const { archive, outputPath } = await packPlugin(directory, join(root, 'basic.cfmscomext'));
    const entries = readZip(archive);

    assert.equal(
      entries.get('pages/home.html').toString('utf8'),
      '<!doctype html><p id="out">hi</p><script>2 + 2</script>',
    );
    assert.deepEqual(entries.get('assets/icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    assert.ok(outputPath.endsWith('basic.cfmscomext'));
  });

  it('writes an index the host can use to detect later edits', async () => {
    const directory = await plugin('indexed', {
      'com_ext.json': manifest(),
      'pages/home.html': '<p>body</p>',
    });

    const { archive } = await packPlugin(directory, join(root, 'indexed.cfmscomext'));
    const entries = readZip(archive);
    const index = JSON.parse(entries.get('META-INF/files.json').toString('utf8'));

    assert.deepEqual(
      index.files.map((entry) => entry.path),
      ['com_ext.json', 'pages/home.html'],
    );
    for (const entry of index.files) {
      const contents = entries.get(entry.path);
      assert.equal(entry.sha256, createHash('sha256').update(contents).digest('hex'));
      assert.equal(entry.size, contents.length);
    }
  });

  it('does not index its own index', async () => {
    const directory = await plugin('self', {
      'com_ext.json': manifest(),
      'pages/home.html': '<p>body</p>',
    });

    const { archive } = await packPlugin(directory, join(root, 'self.cfmscomext'));
    const index = JSON.parse(readZip(archive).get('META-INF/files.json').toString('utf8'));

    assert.ok(!index.files.some((entry) => entry.path === 'META-INF/files.json'));
  });

  it('refuses a file the host would refuse, and names it', async () => {
    const directory = await plugin('forbidden', {
      'com_ext.json': manifest(),
      'pages/home.html': '<p>body</p>',
      'pages/home.js': 'alert(1)',
    });

    await assert.rejects(
      () => packPlugin(directory, join(root, 'forbidden.cfmscomext')),
      /pages\/home\.js/,
    );
  });

  it('refuses a package that is not a community package', async () => {
    const directory = await plugin('wrong-format', {
      'com_ext.json': manifest({ format: 'cfmsext' }),
      'pages/home.html': '<p>body</p>',
    });

    await assert.rejects(
      () => packPlugin(directory, join(root, 'wrong.cfmscomext')),
      /cfmscomext/,
    );
  });

  it('refuses a directory with no manifest', async () => {
    const directory = await plugin('no-manifest', { 'pages/home.html': '<p>body</p>' });

    await assert.rejects(
      () => packPlugin(directory, join(root, 'none.cfmscomext')),
      /com_ext\.json/,
    );
  });

  it('refuses a symbolic link rather than following it', async () => {
    const directory = await plugin('linked', {
      'com_ext.json': manifest(),
      'pages/home.html': '<p>body</p>',
    });
    await symlink(join(directory, 'pages', 'home.html'), join(directory, 'pages', 'link.html'));

    await assert.rejects(
      () => packPlugin(directory, join(root, 'linked.cfmscomext')),
      /symbolic link/,
    );
  });

  it('packs the same input to the same bytes', async () => {
    const directory = await plugin('reproducible', {
      'com_ext.json': manifest(),
      'pages/home.html': '<p>body</p>',
    });

    const first = await packPlugin(directory, join(root, 'one.cfmscomext'));
    const second = await packPlugin(directory, join(root, 'two.cfmscomext'));

    assert.deepEqual(first.archive, second.archive);
  });
});
