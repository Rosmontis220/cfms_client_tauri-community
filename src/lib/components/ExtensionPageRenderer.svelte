<script lang="ts">
  import { readExtensionPage } from '$lib/api/extensions';
  import { runExtensionWorkflow } from '$lib/extension-workflows';
  import type { DeclarativePageHost } from '$lib/declarative-page';
  import DeclarativePageRenderer from '$lib/components/DeclarativePageRenderer.svelte';

  /**
   * Renders an official extension page by binding the shared renderer to the
   * `extension_*` commands.
   */
  let { extensionId, pageId }: { extensionId: string; pageId: string } = $props();

  const host: DeclarativePageHost = {
    kindLabel: 'extension',
    loadPage: (page) => readExtensionPage(extensionId, page),
    runWorkflow: (workflow, input) =>
      runExtensionWorkflow(extensionId, workflow, { input }),
  };
</script>

<DeclarativePageRenderer {host} {pageId} />
