<script lang="ts">
  import { readComExtPage } from '$lib/api/com-ext';
  import { runComExtWorkflow } from '$lib/com-ext-workflow';
  import type { DeclarativePageHost } from '$lib/declarative-page';
  import DeclarativePageRenderer from '$lib/components/DeclarativePageRenderer.svelte';

  /**
   * Renders a community plugin page by binding the shared renderer to the
   * `com_ext_*` commands.
   */
  let { pluginId, pageId }: { pluginId: string; pageId: string } = $props();

  const host: DeclarativePageHost = {
    kindLabel: 'community plugin',
    loadPage: (page) => readComExtPage(pluginId, page),
    runWorkflow: (workflow, input) => runComExtWorkflow(pluginId, workflow, { input }),
  };
</script>

<DeclarativePageRenderer {host} {pageId} />
