<script lang="ts">
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import { comExtStore } from '$lib/com-ext.svelte';
  import { COMMUNITY_EXT_ENABLED } from '$lib/feature-flags';
  import { isIconName } from '$lib/icons';

  /**
   * The community plugin launcher for the unauthenticated screens.
   *
   * A plugin is installed per device rather than per account, and a page that
   * only computes — a converter, a cipher tool — is useful precisely when
   * nobody is signed in. The workspace sidebar is account-scoped, so it cannot
   * carry these entries before sign-in; this sits in the shared top-right
   * toolbar of the server-address screen only, beside Settings and About.
   *
   * Only navigation entrypoints appear. A plugin that contributes just a slot
   * has nothing to launch, so it adds no item here and the button stays hidden.
   */
  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLDivElement | null>(null);

  const entries = $derived(
    COMMUNITY_EXT_ENABLED
      ? comExtStore.enabledInstallations.flatMap((installation) =>
          installation.manifest.entrypoints.navigation.map((entry) => ({
            key: `${installation.manifest.id}:${entry.id}`,
            label: entry.label,
            icon: isIconName(entry.icon) ? entry.icon : 'extensions',
            href: `/home/com-ext/view?plugin=${encodeURIComponent(installation.manifest.id)}&page=${encodeURIComponent(entry.page)}`,
          })),
        )
      : [],
  );

  function closeOnOutsidePointer(event: PointerEvent) {
    if (!open) return;
    const target = event.target as Node | null;
    if (target && (trigger?.contains(target) || menu?.contains(target))) return;
    open = false;
  }

  function closeOnEscape(event: KeyboardEvent) {
    if (!open || event.key !== 'Escape') return;
    open = false;
    trigger?.focus({ preventScroll: true });
  }

  async function launch(href: string) {
    open = false;
    await goto(href);
  }
</script>

<svelte:window onpointerdown={closeOnOutsidePointer} onkeydown={closeOnEscape} />

{#if entries.length > 0}
  <div class="relative inline-flex">
    <button
      type="button"
      class="inline-flex h-9 w-9 items-center justify-center rounded-full text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high/70 hover:text-md3-on-surface"
      class:bg-md3-surface-container-high={open}
      class:text-md3-on-surface={open}
      bind:this={trigger}
      title={$t('settings.comExt.title')}
      aria-label={$t('settings.comExt.title')}
      aria-haspopup="menu"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <Icon name="extensions" size="18px" />
    </button>

    {#if open}
      <div
        bind:this={menu}
        class="com-ext-launch-menu absolute right-0 top-[calc(100%+0.4rem)] z-50 min-w-[190px]
               max-w-[min(260px,calc(100vw-16px))] rounded-xl border border-md3-outline
               bg-md3-surface-container/95 py-1 shadow-lg backdrop-blur-sm"
        role="menu"
        aria-label={$t('settings.comExt.title')}
      >
        <p class="px-3 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.05em] text-md3-on-surface-variant">
          {$t('settings.comExt.title')}
        </p>
        {#each entries as entry (entry.key)}
          <button
            type="button"
            data-menu-item
            role="menuitem"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-md3-on-surface
                   transition-colors hover:bg-md3-primary-container/30"
            style="font-family: var(--font-md3-sans);"
            title={entry.label}
            onclick={() => launch(entry.href)}
          >
            <Icon name={entry.icon} size="16px" />
            <span class="truncate">{entry.label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .com-ext-launch-menu {
    transform-origin: top right;
    animation: com-ext-launch-in 140ms ease-out;
  }

  @keyframes com-ext-launch-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.97); }
    to { opacity: 1; transform: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .com-ext-launch-menu { animation: none; }
  }
</style>
