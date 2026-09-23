import type { ComExtCapability } from '$lib/api/com-ext';

/**
 * Capabilities the running app answers itself.
 *
 * Almost every host capability is answered by the backend, which owns the data
 * it returns. A few cannot be: the sign-in form is component state in the
 * running UI, and no Rust command can read a Svelte variable. Those
 * capabilities are published here by the screen that owns them, and the plugin
 * page bridge consults this registry before it falls through to IPC.
 *
 * A registration lasts exactly as long as the screen that made it, so a
 * capability is unavailable precisely when its screen is not mounted. That is
 * the intended behaviour rather than a limitation: `login.form.read` returns
 * the sign-in form, and once the user is signed in there is no sign-in form to
 * return.
 *
 * Authorization is not this module's job. The bridge checks the caller's grant
 * before it looks here, so a plugin cannot reach a capability it never declared
 * and the user never approved.
 */
export type ComExtLocalCapabilityHandler = (
  pluginId: string,
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

const handlers = new Map<ComExtCapability, ComExtLocalCapabilityHandler>();

/**
 * Publish a capability until the returned function is called.
 *
 * The screen that owns the capability calls this from its own mount and calls
 * the result on teardown, so two screens never both claim the same one.
 */
export function provideComExtLocalCapability(
  capability: ComExtCapability,
  handler: ComExtLocalCapabilityHandler,
): () => void {
  handlers.set(capability, handler);
  return () => {
    if (handlers.get(capability) === handler) handlers.delete(capability);
  };
}

/** Whether some mounted screen currently answers this capability. */
export function hasComExtLocalCapability(capability: ComExtCapability): boolean {
  return handlers.has(capability);
}

/** Answer a capability on behalf of a plugin. */
export async function runComExtLocalCapability(
  capability: ComExtCapability,
  pluginId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const handler = handlers.get(capability);
  if (!handler) {
    throw new Error(`No mounted screen is serving the "${capability}" capability`);
  }
  return handler(pluginId, args);
}
