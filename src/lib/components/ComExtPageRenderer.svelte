<script lang="ts">
  import { readComExtPage, type ComExtPageSource } from '$lib/api/com-ext';
  import { runComExtWorkflow } from '$lib/com-ext-workflow';
  import type { DeclarativePageHost } from '$lib/declarative-page';
  import ComExtAppFrame from '$lib/components/ComExtAppFrame.svelte';
  import DeclarativePageRenderer from '$lib/components/DeclarativePageRenderer.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  /**
   * Renders a community plugin page.
   *
   * A plugin describes a page one of two ways: a self-contained application
   * that brings its own markup and code, or a declarative document the shared
   * block renderer draws. The source is fetched once here, so whichever
   * renderer ends up drawing it does not fetch it again.
   */
  let { pluginId, pageId }: { pluginId: string; pageId: string } = $props();

  let source = $state<ComExtPageSource | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  $effect(() => {
    const id = pluginId;
    const page = pageId;
    let cancelled = false;

    void (async () => {
      loading = true;
      error = null;
      source = null;
      try {
        const loaded = await readComExtPage(id, page);
        if (!cancelled) source = loaded;
      } catch (cause) {
        if (!cancelled) error = cause instanceof Error ? cause.message : String(cause);
      } finally {
        if (!cancelled) loading = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  const host: DeclarativePageHost = {
    kindLabel: 'community plugin',
    loadPage: async () => {
      if (source?.kind === 'declarative') return source.document;
      throw new Error('This plugin page is not declarative');
    },
    runWorkflow: (workflow, input) => runComExtWorkflow(pluginId, workflow, { input }),
  };
</script>

{#if loading}
  <div class="extension-state"><ProgressRing size={28} label="Loading page" /></div>
{:else if error}
  <div class="extension-state extension-error" role="alert">
    <strong>Unable to open community plugin page</strong>
    <p>{error}</p>
  </div>
{:else if source?.kind === 'html'}
  <ComExtAppFrame html={source.html} {pluginId} />
{:else if source}
  <DeclarativePageRenderer {host} {pageId} />
{/if}

<style>
  .extension-state {
    display: grid;
    min-height: 260px;
    place-items: center;
    padding: 2rem;
    text-align: center;
  }

  .extension-error {
    align-content: center;
    gap: 0.6rem;
  }
</style>
