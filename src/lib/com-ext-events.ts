/**
 * Events the host pushes to plugin pages.
 *
 * A host command is request/response, so it cannot call a plugin back, and a
 * declarative workflow has no way to be woken. Events are therefore delivered
 * in the page's own realm: the host dispatches a window `CustomEvent`, and the
 * page bridge turns it into a per-plugin subscription.
 *
 * Delivery is addressed rather than broadcast. The dispatcher is given the ids
 * of the plugins the event concerns, and emits one event per id carrying that
 * id, so a bridge only hands an event to the page it was addressed to. A plugin
 * page shares the window realm and could listen to the raw event instead, which
 * is why the caller — not the receiver — decides the audience from the grant
 * list rather than trusting whoever is listening.
 */
export const COM_EXT_EVENT_NAME = 'cfms:com-ext-event';

export interface ComExtPluginEvent {
  pluginId: string;
  event: string;
  detail: unknown;
}

/** Send `event` to each of `pluginIds`, carrying `detail`. */
export function dispatchComExtEvent(
  pluginIds: readonly string[],
  event: string,
  detail: unknown,
): void {
  for (const pluginId of pluginIds) {
    const payload: ComExtPluginEvent = { pluginId, event, detail };
    window.dispatchEvent(new CustomEvent<ComExtPluginEvent>(COM_EXT_EVENT_NAME, { detail: payload }));
  }
}

/**
 * Subscribe to one event on behalf of one plugin.
 *
 * Returns the unsubscribe function, so a page that is unmounted stops receiving
 * events the moment its host object is discarded.
 */
export function onComExtEvent(
  pluginId: string,
  event: string,
  handler: (detail: unknown) => void,
): () => void {
  const listener = (raw: Event) => {
    const payload = (raw as CustomEvent<ComExtPluginEvent>).detail;
    if (!payload || payload.pluginId !== pluginId || payload.event !== event) return;
    handler(payload.detail);
  };
  window.addEventListener(COM_EXT_EVENT_NAME, listener);
  return () => window.removeEventListener(COM_EXT_EVENT_NAME, listener);
}
