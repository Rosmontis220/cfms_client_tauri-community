import { invoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import type { ComExtCapability } from '$lib/api/com-ext';
import { onComExtEvent } from '$lib/com-ext-events';
import {
  hasComExtLocalCapability,
  runComExtLocalCapability,
} from '$lib/com-ext-local-capabilities';
import { comExtStore } from '$lib/com-ext.svelte';
import { registerComExtHandler } from '$lib/com-ext-handler-registry';

/**
 * The bridge a plugin page is handed when it starts.
 *
 * A page that ships its own markup and code is the only kind of contribution
 * that cannot be described declaratively, so it is also the only kind that
 * needs a way to talk back. It gets exactly this object, as the third argument
 * of each of its scripts, and nothing else: no global, no importable module, no
 * implied access to the app's own state.
 *
 * `call` reaches whichever half of the host answers an operation — the
 * running app for the few that live in the UI, the backend for the rest — so a
 * plugin author never has to know which is which.
 *
 * `on` is the only way the host can reach a page after it has mounted. Host
 * commands are request/response, so without it a page could not be told that
 * anything happened.
 */
export interface ComExtPageHost {
  /** This page's plugin id, exactly as the manifest declares it. */
  readonly pluginId: string;

  /**
   * Ask the host for an operation. Rejects if disabled, unavailable, or failed.
   */
  call<T = unknown>(capability: ComExtCapability, args?: Record<string, unknown>): Promise<T>;

  /**
   * Subscribe to an event the host addresses to this plugin.
   *
   * Returns the unsubscribe function; call it when the page stops caring. The
   * bridge also drops every subscription it made when it is disposed, because a
   * page has no way to tell that it is being unmounted.
   */
  on(event: string, handler: (detail: unknown) => void): () => void;

  handle(
    point: string,
    handler: (context: Record<string, unknown>) => Promise<'handled' | 'continue' | boolean> | 'handled' | 'continue' | boolean,
  ): () => void;
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T = unknown>(event: string, handler: (payload: T) => void): Promise<() => void>;

  /**
   * Drop every subscription this bridge made.
   *
   * The host calls this when it unmounts the page. Without it a page that is
   * gone keeps hearing events: navigating to the sign-in screen and back would
   * leave one live listener per visit, each still acting on behalf of a panel
   * that no longer exists.
   */
  dispose(): void;
}

/**
 * Build the bridge for one plugin page.
 *
 * The plugin id is bound here rather than passed in by the caller, so a page
 * cannot act as a different plugin by supplying another id — the id it is
 * given and the id it is checked against are the same value.
 */
export function createComExtPageHost(pluginId: string, handlerOwnerId = pluginId): ComExtPageHost {
  const subscriptions = new Set<() => void>();
  const assertEnabled = () => {
    if (!comExtStore.enabledInstallations.some((item) => item.manifest.id === pluginId)) {
      throw new Error(`Plugin "${pluginId}" is not enabled`);
    }
  };

  return {
    pluginId,

    async call<T>(capability: ComExtCapability, args: Record<string, unknown> = {}) {
      // Disabled plugins cannot invoke even UI-local operations.
      assertEnabled();

      if (hasComExtLocalCapability(capability)) {
        return (await runComExtLocalCapability(capability, pluginId, args)) as T;
      }

      return comExtStore.callHost<T>(pluginId, capability, args);
    },

    on(event, handler) {
      const stop = onComExtEvent(pluginId, event, handler);
      const tracked = () => {
        subscriptions.delete(tracked);
        stop();
      };
      subscriptions.add(tracked);
      return tracked;
    },

    handle(point, handler) {
      assertEnabled();
      const stop = registerComExtHandler(handlerOwnerId, point, handler);
      const tracked = () => {
        subscriptions.delete(tracked);
        stop();
      };
      subscriptions.add(tracked);
      return tracked;
    },

    invoke<T>(command: string, args: Record<string, unknown> = {}) {
      assertEnabled();
      return invoke<T>(command, args);
    },

    async listen<T>(event: string, handler: (payload: T) => void) {
      assertEnabled();
      const stop = await tauriListen<T>(event, (eventPayload) => handler(eventPayload.payload));
      const tracked = () => {
        subscriptions.delete(tracked);
        void stop();
      };
      subscriptions.add(tracked);
      return tracked;
    },

    dispose() {
      for (const stop of [...subscriptions]) stop();
    },
  };
}
