import type { ComExtCapability } from '$lib/api/com-ext';

/**
 * i18n keys for the capability names the user is shown.
 *
 * Two places name a capability to the user: the enable prompt on the plugin
 * manager, which asks before anything is granted, and the confirmation the page
 * bridge raises before a side-effecting call. Both read this one map, so a
 * capability cannot be described one way when it is granted and another way
 * when it is used.
 *
 * The type is exhaustive on purpose: adding a capability to the union without
 * naming it here fails to compile, which is what stops a new capability from
 * reaching a user as a raw dotted string.
 */
export const CAPABILITY_LABEL_KEYS: Record<ComExtCapability, string> = {
  'files.list': 'settings.comExt.capabilities.files_list',
  'files.metadata.read': 'settings.comExt.capabilities.files_metadata_read',
  'files.search': 'settings.comExt.capabilities.files_search',
  'files.open': 'settings.comExt.capabilities.files_open',
  'tasks.read': 'settings.comExt.capabilities.tasks_read',
  'transfers.download.enqueue': 'settings.comExt.capabilities.transfers_download_enqueue',
  'account.summary.read': 'settings.comExt.capabilities.account_summary_read',
  'events.subscribe': 'settings.comExt.capabilities.events_subscribe',
  'ui.notify': 'settings.comExt.capabilities.ui_notify',
  'ui.confirm': 'settings.comExt.capabilities.ui_confirm',
  'storage.read': 'settings.comExt.capabilities.storage_read',
  'storage.write': 'settings.comExt.capabilities.storage_write',
  'login.form.read': 'settings.comExt.capabilities.login_form_read',
  'login.form.fill': 'settings.comExt.capabilities.login_form_fill',
};
