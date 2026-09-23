<script lang="ts">
  import { onMount } from 'svelte';

  /**
   * Mounts a plugin page that ships its own markup and code.
   *
   * A page is one self-contained HTML file. Its styles and markup are mounted
   * into a shadow root, so a plugin cannot restyle the app and the app cannot
   * restyle a plugin, and its scripts run once the markup is in place. Each
   * script is called with the shadow root as `root` and the plugin id as
   * `pluginId`, so a page can reach its own markup without guessing at ids in
   * the app's document.
   */
  let { html, pluginId }: { html: string; pluginId: string } = $props();

  let mount = $state<HTMLDivElement | null>(null);
  let error = $state<string | null>(null);

  onMount(() => {
    const element = mount;
    if (!element) return;

    const shadow = element.attachShadow({ mode: 'open' });
    try {
      error = null;
      mountPage(shadow, html, pluginId);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    return () => shadow.replaceChildren();
  });

  function mountPage(shadow: ShadowRoot, source: string, id: string) {
    const parsed = new DOMParser().parseFromString(source, 'text/html');

    // Scripts are lifted out before the markup is mounted: an inline <script>
    // moved into the document this way would never run, so they are collected
    // and invoked explicitly after the markup exists.
    const scripts: string[] = [];
    for (const script of parsed.querySelectorAll('script')) {
      scripts.push(script.textContent ?? '');
      script.remove();
    }

    const fragment = document.createDocumentFragment();
    for (const node of parsed.head.childNodes) fragment.append(node.cloneNode(true));
    for (const node of parsed.body.childNodes) fragment.append(node.cloneNode(true));
    shadow.append(fragment);

    for (const code of scripts) {
      // The page is trusted: the user installed it, and a plugin that cannot
      // run code cannot compute anything. `root` scopes it to its own markup.
      new Function('root', 'pluginId', code)(shadow, id);
    }
  }
</script>

{#if error}
  <div class="app-frame-error" role="alert">
    <p>This plugin page failed to start.</p>
    <pre>{error}</pre>
  </div>
{:else}
  <div class="app-frame" bind:this={mount} data-com-ext-app={pluginId}></div>
{/if}

<style>
  .app-frame {
    display: block;
    min-height: 0;
  }

  .app-frame-error {
    padding: 16px;
    border-radius: 12px;
    background: var(--md-sys-color-error-container, #f9dedc);
    color: var(--md-sys-color-on-error-container, #410e0b);
  }

  .app-frame-error p {
    margin: 0 0 8px;
    font-weight: 500;
  }

  .app-frame-error pre {
    margin: 0;
    overflow-x: auto;
    font-size: 12px;
    white-space: pre-wrap;
  }
</style>
