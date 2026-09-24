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
`my-plugin.cfmscomext`. Imported plugins are enabled on install regardless of
legacy `requested_capabilities`, so their navigation entries appear immediately.

## A page is one self-contained file

A page is mounted in isolation: its markup and styles are attached to a shadow
root, so it cannot restyle the app and the app cannot restyle it. That
isolation cuts both ways — **the app's CSS is not visible to your page**, so
bring your own styles.

Your scripts run once the markup exists, called with three arguments:

| Argument  | What it is |
| --------- | ---------- |
| `root`      | the page's own `ShadowRoot`; query your markup through it |
| `pluginId`  | your plugin's id from the manifest |
| `host`      | the bridge to the host; see below |

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

### Talking back to the host

`host` is the sanctioned way to reach the host, and it is small:

| Member | What it does |
| ------ | ------------ |
| `host.pluginId` | your id, bound when the bridge was built |
| `host.call(capability, args?)` | asks the host for an operation and resolves with its result; legacy capability metadata is optional |
| `host.on(event, handler)` | subscribes to an event addressed to your plugin; returns the unsubscribe function |
| `host.handle(point, handler)` | registers a page-backed action interceptor; return `handled` or `continue` |
| `host.invoke(command, args?)` | invokes an existing Tauri command directly, with no per-plugin capability registry |
| `host.listen(event, handler)` | listens to a Tauri event; resolves with an unsubscribe function |

```html
<button id="stamp">记一笔</button>
<script>
  root.querySelector('#stamp').addEventListener('click', async () => {
    const value = String(Date.now());
    await host.call('storage.write', { key: 'lastSeen', value });
  });
</script>
```

`call` works for an enabled plugin without a capability grant or per-call
consent prompt. Operations can still fail because the host operation is
unavailable or its arguments are invalid. Plugins may explicitly call
`ui.confirm` when they want to ask the user before an action.

`on` exists because a host command is request/response: without it the host
could never tell your page that anything happened. It delivers only events
addressed to your plugin id, and only while your page is mounted — the host
drops every subscription your page made when it unmounts it, so a page that is
gone stops acting on the user's behalf.

Delivery is to whoever is already subscribed, so **an event that fires while
your page is still starting up is not replayed.** Subscribe as early as your
page can, and treat an event as a notification rather than as the only record of
what happened.

The `host` argument is new, and a page that ignores it keeps working unchanged.

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
| `requested_capabilities` | optional legacy metadata; neither omitted nor unknown names restrict installation or calls |
| `entrypoints` | what you contribute; see below |
| `background_triggers` | must be empty on this host version |

Unknown structural fields and unsupported entrypoint points are rejected at
install rather than silently ignored. `requested_capabilities` is legacy
informational metadata: unknown names in this list are accepted.

### Entrypoints

| Key | What it does |
| --- | ------------ |
| `navigation` | adds an entry to the app's navigation. Fields: `id`, `label`, `page`, optional `icon`, optional `order` (lower sorts first) |
| `pages` | declares a page that other entrypoints can point at |
| `settings` | adds an entry under Settings |
| `slots` | renders a page into a region of a host screen. Supported points: `overview-section`, `settings-section`, `login-section` |
| `actions` | adds a command. Supported points: `file-toolbar`, `file-context-menu` |
| `hooks` | runs an observational workflow on a lifecycle event: `beforeDocumentOpen`, `afterDownloadEnqueue`, `onLogin`, `onLogout` |
| `handlers` | mounts an HTML page to intercept a foreground action; supported point: `file.activate`; fields: `id`, `point`, `page`, optional `order` |

A handler page registers `host.handle('file.activate', async (context) => 'handled')`.
The host awaits it on document double-click and keyboard Enter. Return `continue`
to let the built-in download run; return `handled` to suppress it. The context
includes `documentId`, `filename`, `folderId`, `pathParts`, `sha256`, and `size`.
Handler pages mount invisibly on first use, then remain mounted while enabled;
their subscriptions are disposed when the plugin is disabled or removed.

`slots`, `actions`, and `hooks` carry your own page or workflow documents under
`slots/`, `workflows/`, and `hooks/`. `actions` and `hooks` are declarative
workflows, not code; see
[`src/lib/declarative-workflow.ts`](../src/lib/declarative-workflow.ts) for the
node and expression vocabulary.

A `navigation` entry is **device-level, not account-level**. Once someone is
signed in it appears in the workspace sidebar; before sign-in its launcher
appears only on the server-address screen beside Settings. A plugin page is therefore
reachable with no account and no server connection at all — which is what makes
a compute-only plugin useful before anyone signs in, and is why the page route
is not behind the sign-in gate.

The consequence is yours to handle: if your page does want host data, it will be
opened while nobody is signed in, and the host does not hide it for you. Either
work without an account or say so on the page.

### Capabilities

Enabled community plugins can call supported host operations without declaring
or receiving grants. The following names describe existing operations; this list
is not an allow-list for future extensions.

| Operation | Result or purpose |
| --------- | ----------------- |
| `server.action` | `{action,payload}` → complete server Response envelope |
| `server.path.resolve`, `server.directory.list` | resolve a node path / list a folder |
| `server.document.readText`, `server.document.download` | read UTF-8 from a server document / enqueue its download |
| `local.folder.choose`, `local.directory.scan` | pick a local folder / enumerate chatbox-style room records |
| `local.folder.scan`, `local.file.readText`, `local.file.writeText` | generic local filesystem primitives |
| `local.path.open` | open a local file with the platform handler |
| `local.document.state`, `local.document.open` | hash and open a document under the client download root |
| `tasks.wait` | await a download task until terminal state or timeout |
| `account.summary.read` | read the signed-in account summary |
| `tasks.read` | read the task lists |
| `files.list` | list a server directory |
| `files.search` | search server files |
| `files.metadata.read` | read a file's metadata |
| `files.open` | open a file |
| `transfers.download.enqueue` | queue a download |
| `events.subscribe` | subscribe to host events |
| `ui.notify` | show a notification |
| `ui.confirm` | ask the user to confirm |
| `storage.read` / `storage.write` | a private key-value store, per plugin |
| `login.form.read` | read what the sign-in form holds: username, password, server |
| `login.form.fill` | put a username and password into the sign-in form |

A plugin that computes on its own needs no host operations. An empty legacy
capability list does not prevent an enabled plugin from calling host operations.

### The sign-in screen

Two things are worth knowing before you attach to `login-section`.

**`login.form.*` is served by the app, not the backend.** The sign-in form is
component state in the running UI, so no command can read it; the app answers
those two itself, for exactly as long as the sign-in screen is mounted. The
same bridge handles both halves without requiring a grant.

**The host tells you when a sign-in succeeds.**
`host.on('login.succeeded', …)` delivers `{ username, password }` immediately
before the app drops its own copies, which is the last moment they exist. It is
addressed to enabled plugins that subscribe to the login form event; legacy
`login.form.read` metadata may identify interested older plugins, but is not a
grant. There is no `login.failed`: nothing is gained by being told
about a password the server rejected.

Two properties of that delivery are load-bearing, and both have bitten this
interface once:

- **Subscribe before your first `await`.** The host does not replay an event to a
  page that was not listening when it was sent, so a page that subscribes after
  reading its own storage can miss the one sign-in it exists for.
- **You are only told while the sign-in screen is mounted.** A successful sign-in
  replaces the form — and everything contributed into it — with a loading state,
  and the host hands the credentials over just before that happens. A page that
  has already been unmounted is not listening, so the hand-over is a genuine
  event with a deadline rather than a notification you can collect later.

**Keep your own controls inert until you have read what they control.** The host
loads your page before the user can see it, but "before" is milliseconds, not
never: a checkbox that accepts a change before your stored state arrives will
take the user's choice and then lose it to that load. Disable the control in your
markup and enable it once you are ready.

**What you store is stored as written.** `storage.write` keeps your value in the
app's local settings with no encryption of its own — the backend has no key store
to hold a key anywhere but beside the data, which would be a lock with its key
taped to it. If your plugin remembers a password, say so in its `description` and
let the user decide.

A worked example is [`plugins/remember`](../plugins/remember) — saved accounts,
a chip per account, and two checkboxes — which is what this slot point was added
for.

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
