<script lang="ts">
  import ComExtPageRenderer from '$lib/components/ComExtPageRenderer.svelte';
  import type { ComExtSlotPoint } from '$lib/api/com-ext';
  import { comExtStore } from '$lib/com-ext.svelte';
  import { COMMUNITY_EXT_ENABLED } from '$lib/feature-flags';

  /**
   * Renders every enabled community plugin contribution for one slot point.
   *
   * A contribution is a declarative page document, so the slot reuses the same
   * renderer as a full plugin page. Contributions appear in the order their
   * manifests declare, and a plugin that is disabled contributes nothing —
   * both of which `slotContributors` decides, so this component stays a thin
   * view over the registry.
   */
  let { point, heading }: { point: ComExtSlotPoint; heading?: string } = $props();

  const contributions = $derived(
    COMMUNITY_EXT_ENABLED ? comExtStore.slotContributors(point) : [],
  );
</script>

{#if contributions.length > 0}
  <div class="com-ext-slot" data-com-ext-slot={point}>
    {#if heading}<h2 class="com-ext-slot-heading">{heading}</h2>{/if}
    {#each contributions as contribution (`${contribution.pluginId}:${contribution.entry.id}`)}
      <section
        class="com-ext-slot-contribution"
        data-com-ext-plugin={contribution.pluginId}
        aria-label={comExtStore.displayNameFor(contribution.pluginId)}
      >
        <ComExtPageRenderer
          pluginId={contribution.pluginId}
          pageId={contribution.entry.page}
        />
      </section>
    {/each}
  </div>
{/if}

<style>
  .com-ext-slot { display: grid; gap: 0.75rem; }
  .com-ext-slot-heading { font-size: 0.95rem; font-weight: 650; color: var(--explorer-text); }
  .com-ext-slot-contribution {
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-medium);
    background: var(--explorer-surface-raised);
    overflow: hidden;
  }
</style>
