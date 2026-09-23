import { get } from 'svelte/store';
import { _ as t } from 'svelte-i18n';
import type { ComExtCapability } from '$lib/api/com-ext';
import { CAPABILITY_LABEL_KEYS } from '$lib/com-ext-capability-labels';
import { onComExtEvent } from '$lib/com-ext-events';
import {
  hasComExtLocalCapability,
  runComExtLocalCapability,
} from '$lib/com-ext-local-capabilities';
import { comExtStore } from '$lib/com-ext.svelte';

/**
 * The bridge a plugin page is handed when it starts.
 *
 * A page that ships its own markup and code is the only kind of contribution
 * that cannot be described declaratively, so it is also the only kind that
 * needs a way to talk back. It gets exactly this object, as the third argument
 * of each of its scripts, and nothing else: no global, no importable module, no
 * implied access to the app's own state.
 *
 * `call` is the sanctioned path to a host capability. It checks the grant
 * first, then asks whichever half of the host answers that capability — the
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
   * Ask the host for a capability this plugin declared.
   *
   * Resolves with the capability's own result. Rejects when the plugin was not
   * granted the capability, when no mounted screen serves it, or when the host
   * refuses the call.
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
export function createComExtPageHost(pluginId: string): ComExtPageHost {
  const subscriptions = new Set<() => void>();

  return {
    pluginId,

    async call<T>(capability: ComExtCapability, args: Record<string, unknown> = {}) {
      // The backend re-checks every capability it answers. This check covers the
      // ones it never sees: a capability the running app answers would
      // otherwise be reachable by a page that never declared it.
      if (!comExtStore.grants(pluginId, capability)) {
        throw new Error(`Plugin "${pluginId}" has not been granted the "${capability}" capability`);
      }

      if (hasComExtLocalCapability(capability)) {
        return (await runComExtLocalCapability(capability, pluginId, args)) as T;
      }

      return comExtStore.callHost<T>(pluginId, capability, args, (summary) =>
        window.confirm(describeCall(pluginId, capability, summary)),
      );
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

    dispose() {
      for (const stop of [...subscriptions]) stop();
    },
  };
}

/**
 * The question a user is asked before a capability that touches their disk.
 *
 * It names the plugin, says in words what the capability does, and names the
 * file, because "allow?" with no subject is not something anyone can answer.
 */
function describeCall(pluginId: string, capability: ComExtCapability, summary: string): string {
  const translate = get(t);
  const label = translate(CAPABILITY_LABEL_KEYS[capability]);
  return translate('settings.comExt.sideEffectConfirm', {
    values: { name: comExtStore.displayNameFor(pluginId), action: label, target: summary },
  });
}
