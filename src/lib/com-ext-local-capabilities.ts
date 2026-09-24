import { open } from '@tauri-apps/plugin-dialog';
import type { ComExtCapability } from '$lib/api/com-ext';
import { waitForComExtDownloadTask } from '$lib/com-ext-task-wait';
import { notificationStore } from '$lib/stores.svelte';

/** Frontend-owned host operations and temporary capabilities supplied by screens. */
export type ComExtLocalCapabilityHandler = (
  pluginId: string,
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

const handlers = new Map<ComExtCapability, ComExtLocalCapabilityHandler>();

/** Publish a screen-owned capability until the returned function is called. */
export function provideComExtLocalCapability(
  capability: ComExtCapability,
  handler: ComExtLocalCapabilityHandler,
): () => void {
  handlers.set(capability, handler);
  return () => {
    if (handlers.get(capability) === handler) handlers.delete(capability);
  };
}

const builtins: Record<string, ComExtLocalCapabilityHandler> = {
  'local.folder.choose': async (_pluginId, args) => {
    const path = await open({
      directory: true,
      multiple: false,
      ...(typeof args.title === 'string' ? { title: args.title } : {}),
    });
    return { path: typeof path === 'string' ? path : null };
  },
  'ui.confirm': (_pluginId, args) => ({ confirmed: window.confirm(String(args.message ?? '')) }),
  'ui.notify': (_pluginId, args) => {
    const message = String(args.message ?? '');
    const level = String(args.level ?? args.type ?? 'info');
    if (level === 'success') notificationStore.success(message);
    else if (level === 'warning') notificationStore.warning(message);
    else if (level === 'error') notificationStore.error(message);
    else notificationStore.info(message);
    return { notified: true };
  },
  'tasks.wait': async (_pluginId, args) => {
    const taskId = String(args.taskId ?? args.task_id ?? '');
    if (!taskId) throw new Error('tasks.wait requires taskId');
    return waitForComExtDownloadTask(taskId);
  },
};

/** Whether a mounted screen or builtin frontend service answers this capability. */
export function hasComExtLocalCapability(capability: ComExtCapability): boolean {
  return handlers.has(capability) || Object.hasOwn(builtins, capability);
}

/** Answer a frontend-owned host operation on behalf of an enabled plugin. */
export async function runComExtLocalCapability(
  capability: ComExtCapability,
  pluginId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const handler = handlers.get(capability) ?? builtins[capability];
  if (!handler) throw new Error(`No mounted screen is serving the "${capability}" capability`);
  return handler(pluginId, args);
}
