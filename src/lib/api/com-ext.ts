import { invoke } from '@tauri-apps/api/core';
import type { DeclarativePage, DeclarativeWorkflow } from '$lib/api/extensions';

/**
 * Community plugin (`com_ext`) IPC surface.
 *
 * Parallel to `./extensions`, which talks to the official `extension_*`
 * commands.  The two never share a package format, storage root, state, or
 * capability set, so both can be used at the same time.
 */

/**
 * The declarative page and workflow vocabulary is deliberately shared with the
 * official interface: both renderers consume the same block shapes, and two
 * copies of the same union would drift apart.  Re-exported here so community
 * consumers have a single import site.  This is a type-only dependency and
 * carries no state or behaviour across the two interfaces.
 */
export type { DeclarativeBlock, DeclarativePage, DeclarativeWorkflow } from '$lib/api/extensions';

export type ComExtCapability =
  | 'files.list'
  | 'files.metadata.read'
  | 'files.search'
  | 'files.open'
  | 'tasks.read'
  | 'transfers.download.enqueue'
  | 'account.summary.read'
  | 'events.subscribe'
  | 'ui.notify'
  | 'ui.confirm'
  | 'storage.read'
  | 'storage.write';

/** UI extension points a plugin may contribute to. */
export type ComExtSlotPoint =
  | 'navigation'
  | 'settings-section'
  | 'page'
  | 'file-row-trailing'
  | 'file-row-status'
  | 'file-toolbar'
  | 'file-context-menu'
  | 'overview-section';

/** Flow hooks a plugin may attach to. */
export type ComExtHookPoint =
  | 'beforeDocumentOpen'
  | 'afterDownloadEnqueue'
  | 'onLogin'
  | 'onLogout';

/** Core surfaces a plugin may replace wholesale. */
export type ComExtOverridePoint = 'page' | 'component';

export type ComExtBackgroundTrigger =
  | { type: 'on_enable'; workflow: string }
  | { type: 'on_login'; workflow: string }
  | { type: 'interval'; workflow: string; minutes: number }
  | { type: 'event'; workflow: string; event: string };

export interface ComExtNavigationEntry {
  id: string;
  label: string;
  icon: string;
  page: string;
  order: number;
}

export interface ComExtPageEntry {
  id: string;
  label: string;
  page: string;
}

export interface ComExtSlotEntry {
  id: string;
  point: ComExtSlotPoint;
  page: string;
  order: number;
}

export interface ComExtActionEntry {
  id: string;
  label: string;
  workflow: string;
  point: string;
  tone: string;
}

export interface ComExtHookEntry {
  id: string;
  point: ComExtHookPoint;
  workflow: string;
}

export interface ComExtOverrideEntry {
  id: string;
  point: ComExtOverridePoint;
  target: string;
  page: string;
}

export interface ComExtEntrypoints {
  navigation: ComExtNavigationEntry[];
  settings: ComExtPageEntry[];
  pages: ComExtPageEntry[];
  slots: ComExtSlotEntry[];
  actions: ComExtActionEntry[];
  hooks: ComExtHookEntry[];
  overrides: ComExtOverrideEntry[];
}

export interface ComExtManifest {
  /** Always `cfmscomext`; this is the format marker. */
  format: string;
  schema_version: number;
  id: string;
  name: string;
  description: string;
  publisher: string;
  version: string;
  com_ext_api: string;
  min_client_version: string;
  requested_capabilities: ComExtCapability[];
  entrypoints: ComExtEntrypoints;
  background_triggers: ComExtBackgroundTrigger[];
}

export interface ComExtInstallation {
  manifest: ComExtManifest;
  package_digest: string;
  installed_at: number;
  enabled: boolean;
  granted_capabilities: ComExtCapability[];
  disk_bytes: number;
}

export interface ComExtOverview {
  installed: ComExtInstallation[];
  hostApiVersion: string;
  capabilities: ComExtCapability[];
  packageExtension: string;
  root: string;
}

export function getComExtOverview(): Promise<ComExtOverview> {
  return invoke('get_com_ext_overview');
}

export function importComExtPackage(path: string): Promise<ComExtInstallation> {
  return invoke('import_com_ext_package', { path });
}

export function uninstallComExtPlugin(pluginId: string): Promise<void> {
  return invoke('uninstall_com_ext_plugin', { pluginId });
}

export function setComExtEnabled(pluginId: string, enabled: boolean): Promise<void> {
  return invoke('set_com_ext_enabled', { pluginId, enabled });
}

export function readComExtPage(pluginId: string, page: string): Promise<DeclarativePage> {
  return invoke('read_com_ext_page', { pluginId, page });
}

export function readComExtWorkflow(pluginId: string, workflow: string): Promise<DeclarativeWorkflow> {
  return invoke('read_com_ext_workflow', { pluginId, workflow });
}

export function readComExtContribution(
  pluginId: string,
  kind: 'slots' | 'hooks',
  id: string,
): Promise<DeclarativePage> {
  return invoke('read_com_ext_contribution', { pluginId, kind, id });
}

export function getComExtStorage(pluginId: string, key: string): Promise<string | null> {
  return invoke('get_com_ext_storage', { pluginId, key });
}

export function setComExtStorage(pluginId: string, key: string, value: string): Promise<void> {
  return invoke('set_com_ext_storage', { pluginId, key, value });
}

export function removeComExtStorage(pluginId: string, key: string): Promise<void> {
  return invoke('remove_com_ext_storage', { pluginId, key });
}

export function clearComExtStorage(pluginId: string): Promise<void> {
  return invoke('clear_com_ext_storage', { pluginId });
}

/**
 * Invoke a host capability on behalf of a plugin.
 *
 * The backend re-checks authorization on every call, so passing a capability
 * here grants nothing by itself. `userConfirmed` is required for capabilities
 * that cause a real side effect (opening or downloading a file).
 */
export function executeComExtHostCall<T = unknown>(
  pluginId: string,
  capability: ComExtCapability,
  args: unknown = {},
  userConfirmed?: boolean,
): Promise<T> {
  return invoke('execute_com_ext_host_call', {
    pluginId,
    capability,
    arguments: args,
    userConfirmed,
  });
}
