<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import ComExtPageRenderer from '$lib/components/ComExtPageRenderer.svelte';
  import { COMMUNITY_EXT_ENABLED } from '$lib/feature-flags';

  const pluginId = $derived(page.url.searchParams.get('plugin') ?? '');
  const pageId = $derived(page.url.searchParams.get('page') ?? '');

  onMount(() => {
    // A plugin page is only reachable while the community interface is on. A
    // hand-entered URL must not instantiate plugin-provided UI otherwise.
    if (!COMMUNITY_EXT_ENABLED) void goto('/home/overview', { replaceState: true });
  });
</script>

{#if COMMUNITY_EXT_ENABLED}
  {#if pluginId && pageId}
    <ComExtPageRenderer {pluginId} {pageId} />
  {:else}
    <div class="invalid">
      <h1>Plugin page unavailable</h1>
      <p>The plugin or page identifier is missing.</p>
    </div>
  {/if}
{/if}

<style>
  .invalid { display: grid; min-height: 260px; place-items: center; align-content: center; gap: .5rem; padding: 2rem; text-align: center; color: var(--explorer-text); }
  .invalid p { color: var(--explorer-text-muted); }
</style>
