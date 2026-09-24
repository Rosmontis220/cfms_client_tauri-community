import { readComExtPage, type ComExtPageSource } from '$lib/api/com-ext';
import { createComExtPageHost, type ComExtPageHost } from '$lib/com-ext-page-host';
import { comExtStore } from '$lib/com-ext.svelte';
import { invokeComExtHandler } from '$lib/com-ext-handler-registry';

interface LoadedHandler {
  pluginId: string;
  point: string;
  packageDigest: string;
  element: HTMLElement;
  host: ComExtPageHost;
}

const loaded = new Map<string, LoadedHandler>();
const loading = new Map<string, Promise<LoadedHandler>>();

function handlerKey(pluginId: string, entryId: string): string {
  return `${pluginId}:${entryId}`;
}

/** Mounts the same self-contained HTML page contract used by visible slots. */
function mountHandlerPage(source: ComExtPageSource, pluginId: string, host: ComExtPageHost): HTMLElement {
  if (source.kind !== 'html') throw new Error('A foreground handler needs a plugin HTML page');
  const parsed = new DOMParser().parseFromString(source.html, 'text/html');
  const scripts = [...parsed.querySelectorAll('script')].map((script) => {
    const code = script.textContent ?? '';
    script.remove();
    return code;
  });
  const element = document.createElement('div');
  element.hidden = true;
  element.dataset.comExtHandler = pluginId;
  const root = element.attachShadow({ mode: 'open' });
  const fragment = document.createDocumentFragment();
  for (const node of parsed.head.childNodes) fragment.append(node.cloneNode(true));
  for (const node of parsed.body.childNodes) fragment.append(node.cloneNode(true));
  root.append(fragment);
  document.body.append(element);
  try {
    for (const code of scripts) new Function('root', 'pluginId', 'host', code)(root, pluginId, host);
  } catch (error) {
    element.remove();
    throw error;
  }
  return element;
}

async function ensureHandler(pluginId: string, packageDigest: string, entry: { id: string; page: string; point: string }): Promise<LoadedHandler> {
  const key = handlerKey(pluginId, entry.id);
  const current = loaded.get(key);
  if (current && current.element.isConnected && current.packageDigest === packageDigest) return current;
  if (current) {
    current.host.dispose();
    current.element.remove();
    loaded.delete(key);
  }
  const pending = loading.get(key);
  if (pending) return pending;
  const promise = (async () => {
    const source = await readComExtPage(pluginId, entry.page);
    const host = createComExtPageHost(pluginId, key);
    try {
      const element = mountHandlerPage(source, pluginId, host);
      const instance = { pluginId, point: entry.point, packageDigest, element, host };
      loaded.set(key, instance);
      return instance;
    } catch (error) {
      host.dispose();
      throw error;
    }
  })();
  loading.set(key, promise);
  try {
    return await promise;
  } finally {
    if (loading.get(key) === promise) loading.delete(key);
  }
}

/**
 * Ask each enabled page-backed handler in manifest order. A failing plugin is
 * reported and the next contributor gets a chance; no handler means that the
 * app's normal action continues. Load happens on first use, then the mounted
 * handler is reused until disabled/uninstalled.
 */
export async function runComExtHandlers(
  point: string,
  context: Record<string, unknown>,
): Promise<boolean> {
  const contributors = comExtStore.handlerContributors(point);
  const activeKeys = new Set(contributors.map(({ pluginId, entry }) => handlerKey(pluginId, entry.id)));
  for (const [key, instance] of loaded) {
    if (activeKeys.has(key)) continue;
    instance.host.dispose();
    instance.element.remove();
    loaded.delete(key);
  }
  for (const { pluginId, packageDigest, entry } of contributors) {
    try {
      await ensureHandler(pluginId, packageDigest, entry);
      if (await invokeComExtHandler(handlerKey(pluginId, entry.id), point, context)) return true;
    } catch (error) {
      console.warn(`Community plugin "${pluginId}" handler ${point} failed:`, error);
    }
  }
  return false;
}

/** Discard mounted handler pages on sign-out or application teardown. */
export function disposeComExtHandlers(): void {
  for (const instance of loaded.values()) {
    instance.host.dispose();
    instance.element.remove();
  }
  loaded.clear();
}
