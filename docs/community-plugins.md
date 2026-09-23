# Community plugins

A community plugin extends the app with its own pages. It is an ordinary
directory, and the `.cfmscomext` file you install is that directory zipped.

This interface is separate from the official extension system. The two use
different package formats, live in different directories, and share no state, so
installing one never affects the other.

> Community plugins are **not** signature-checked. Install only packages you
> trust.

## The shortest possible plugin

Two files:

```
my-plugin/
  com_ext.json          the manifest
  pages/home.html       the page
```

`com_ext.json`:

```json
{
  "format": "cfmscomext",
  "schema_version": 1,
  "id": "org.example.hello",
  "name": "Hello",
  "description": "A minimal community plugin.",
  "publisher": "you",
  "version": "1.0.0",
  "com_ext_api": "1.0.0",
  "min_client_version": "1.0.0",
  "requested_capabilities": [],
  "entrypoints": {
    "navigation": [{ "id": "hello", "label": "Hello", "page": "home", "order": 10 }],
    "pages": [{ "id": "hello", "label": "Hello", "page": "home" }]
  },
  "background_triggers": []
}
```

`pages/home.html`:

```html
<style>
  body { font-family: system-ui; padding: 24px; }
</style>
<p id="out">…</p>
<script>
  root.querySelector('#out').textContent = 'Hello from ' + pluginId;
</script>
```

Pack it and install it:

```sh
pnpm plugin:pack my-plugin
```

Then **Settings → Community plugins → Import**, and pick
`my-plugin.cfmscomext`. A plugin that requests no capabilities is enabled on
install, so its navigation entry appears immediately.

## A page is one self-contained file

A page is mounted in isolation: its markup and styles are attached to a shadow
root, so it cannot restyle the app and the app cannot restyle it. That
isolation cuts both ways — **the app's CSS is not visible to your page**, so
bring your own styles.

Your scripts run once the markup exists, called with two arguments:

| Argument  | What it is |
| --------- | ---------- |
| `root`      | the page's own `ShadowRoot`; query your markup through it |
| `pluginId`  | your plugin's id from the manifest |

```html
<p id="out"></p>
<script>
  // `root` scopes you to your own markup, so you never collide with the app.
  root.querySelector('#out').textContent = pluginId;
</script>
```

Because scripts are evaluated rather than injected as `<script>` tags, you can
write anything a web page can: compute, keep state, listen for events. A page
that needs a library can bundle it in.

### A page can also be declarative

If a page needs no code at all — a status panel, a table, a few buttons — ship
`pages/<id>.json` instead of `pages/<id>.html` and the host renders it from a
fixed block vocabulary (`text`, `status_card`, `alert`, `progress`, `list`,
`table`, `empty_state`, `form`, `actions`). See
[`src/lib/api/extensions.ts`](../src/lib/api/extensions.ts) for the block
shapes.

A page id must resolve to exactly one of the two forms. Shipping both is an
error, not a preference.

## Manifest reference

| Field | Notes |
| ----- | ----- |
| `format` | must be `cfmscomext` |
| `schema_version` | must be `1` |
| `id` | reverse-DNS, unique; also the directory name under `<app data>/com_ext` |
| `name`, `description`, `publisher` | shown in the plugin manager |
| `version` | semver; a higher version replaces a lower one on re-import |
| `com_ext_api` | the interface version you target; major must match the host |
| `min_client_version` | oldest app version you support |
| `requested_capabilities` | host APIs you need; see below. Empty means the plugin cannot reach the host at all |
| `entrypoints` | what you contribute; see below |
| `background_triggers` | must be empty on this host version |

Unknown fields, and unknown values in known fields, are **rejected at install**
rather than ignored. A package that would install and then silently do nothing
is treated as a mistake.

### Entrypoints

| Key | What it does |
| --- | ------------ |
| `navigation` | adds an entry to the app's navigation. Fields: `id`, `label`, `page`, optional `icon`, optional `order` (lower sorts first) |
| `pages` | declares a page that other entrypoints can point at |
| `settings` | adds an entry under Settings |
| `slots` | renders a page into a region of a host screen. Supported points: `overview-section`, `settings-section` |
| `actions` | adds a command. Supported points: `file-toolbar`, `file-context-menu` |
| `hooks` | runs a workflow on a lifecycle event: `beforeDocumentOpen`, `afterDownloadEnqueue`, `onLogin`, `onLogout` |

`slots`, `actions`, and `hooks` carry your own page or workflow documents under
`slots/`, `workflows/`, and `hooks/`. `actions` and `hooks` are declarative
workflows, not code; see
[`src/lib/declarative-workflow.ts`](../src/lib/declarative-workflow.ts) for the
node and expression vocabulary.

### Capabilities

A plugin reaches the host only through capabilities it declared **and** that
were granted when it was enabled. Capabilities are re-checked inside the host on
every call, so a frontend check is never the only gate.

| Capability | Grants |
| ---------- | ------ |
| `account.summary.read` | read the signed-in account summary |
| `tasks.read` | read the task lists |
| `files.list` | list a server directory |
| `files.search` | search server files |
| `files.metadata.read` | read a file's metadata |
| `files.open` | open a file — **always asks the user first** |
| `transfers.download.enqueue` | queue a download — **always asks the user first** |
| `events.subscribe` | subscribe to host events |
| `ui.notify` | show a notification |
| `ui.confirm` | ask the user to confirm |
| `storage.read` / `storage.write` | a private key-value store, per plugin |

A plugin that computes on its own — a converter, a cipher tool — needs **none**
of these, and an empty list keeps it incapable of touching the host at all.

## Packaging rules

The host reads packages defensively, so a few shapes are refused outright:

- Paths are relative and normalized. `..` and absolute paths are rejected, as
  are symbolic links.
- Only these paths are allowed:
  `com_ext.json`, `META-INF/`, `pages/*.json`, `pages/*.html`,
  `workflows/*.json`, `slots/*.json`, `hooks/*.json`,
  `assets/*.{png,jpg,jpeg,webp,gif,ico}`.
  A loose `.js` next to a page is refused: a page is one self-contained file.
- Limits: 32 MiB packed, 64 MiB expanded, 8 MiB per file, 4 MiB per JSON file,
  512 files.

`pnpm plugin:pack` applies the same rules before writing the archive, so a
packaging mistake is reported where you can still fix it.

### The file index

The packer writes `META-INF/files.json`, listing every shipped file with its
SHA-256. The host re-hashes the installed files on every page read and refuses
to serve a plugin whose files changed since installation. Editing a plugin
in place therefore breaks it — re-import the package instead.

## A plugin with a build step

If a plugin needs a bundler, give it a `build.mjs` and let the packer run it:

```
my-plugin/
  build.mjs      produces dist/
  src/           TypeScript sources
  com_ext.json
```

`pnpm plugin:build my-plugin` runs `build.mjs` and then packs `dist/`. When
`dist/` exists it is what ships, so `com_ext.json` belongs in `dist/` too
(usually by copying it in `build.mjs`).

[`plugins/tools/`](../plugins/tools/) is a worked example: it bundles
TypeScript with esbuild into a single self-contained `pages/tools.html`.

## Building and testing

```sh
pnpm plugin:build tools       # build + pack plugins/tools
pnpm plugin:build --all       # every plugin under plugins/
pnpm plugin:pack my-plugin    # pack without running a build step
pnpm test:plugin              # packer tests
```

`packages/tools` is also checked by the host's own Rust validator in
`crates/service/src/com_ext/package.rs`, so the packer and the host cannot
silently drift apart.
