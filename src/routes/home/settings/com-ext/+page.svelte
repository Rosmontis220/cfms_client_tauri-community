<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { open } from '@tauri-apps/plugin-dialog';
  import { _ as t } from 'svelte-i18n';
  import { type ComExtCapability, type ComExtInstallation } from '$lib/api/com-ext';
  import { comExtStore } from '$lib/com-ext.svelte';
  import { COMMUNITY_EXT_ENABLED } from '$lib/feature-flags';
  import { notificationStore } from '$lib/stores.svelte';
  import { isMobilePlatform } from '$lib/platform';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import { formatUserFacingError } from '$lib/user-facing-errors';

  let busy = $state<string | null>(null);
  const mobile = isMobilePlatform();

  const CAPABILITY_LABEL_KEYS: Record<ComExtCapability, string> = {
    'files.list': 'settings.comExt.capabilities.files_list',
    'files.metadata.read': 'settings.comExt.capabilities.files_metadata_read',
    'files.search': 'settings.comExt.capabilities.files_search',
    'files.open': 'settings.comExt.capabilities.files_open',
    'tasks.read': 'settings.comExt.capabilities.tasks_read',
    'transfers.download.enqueue': 'settings.comExt.capabilities.transfers_download_enqueue',
    'account.summary.read': 'settings.comExt.capabilities.account_summary_read',
    'events.subscribe': 'settings.comExt.capabilities.events_subscribe',
    'ui.notify': 'settings.comExt.capabilities.ui_notify',
    'ui.confirm': 'settings.comExt.capabilities.ui_confirm',
    'storage.read': 'settings.comExt.capabilities.storage_read',
    'storage.write': 'settings.comExt.capabilities.storage_write',
  };

  onMount(() => {
    // Direct URL access stays closed while the community interface is off.
    if (!COMMUNITY_EXT_ENABLED) {
      void goto('/home/settings', { replaceState: true });
      return;
    }
    void comExtStore.refresh();
  });

  async function importPackage() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'CFMS Community Plugin', extensions: ['cfmscomext'] }],
    });
    if (typeof selected !== 'string') return;
    busy = 'import';
    try {
      const installed = await comExtStore.importPackage(selected);
      // A plugin that asks for nothing has nothing to be gated on, so making
      // the user take a second step to enable it would be ceremony. One that
      // asks for capabilities still waits for an explicit decision.
      if (installed.manifest.requested_capabilities.length === 0) {
        await comExtStore.changeEnabled(installed.manifest.id, true);
        notificationStore.success(
          $t('settings.comExt.installCompleteEnabled', { values: { name: installed.manifest.name } }),
        );
      } else {
        notificationStore.success(
          $t('settings.comExt.installComplete', { values: { name: installed.manifest.name } }),
        );
      }
    } catch (error) {
      notificationStore.error(`${$t('settings.comExt.installFailed')}: ${formatError(error)}`);
    } finally {
      busy = null;
    }
  }

  async function toggle(installation: ComExtInstallation) {
    const enable = !installation.enabled;
    if (enable && installation.manifest.requested_capabilities.length > 0) {
      const list = installation.manifest.requested_capabilities.map(capabilityLabel).join('\n• ');
      const prompt = `${$t('settings.comExt.enableConfirm', { values: { name: installation.manifest.name } })}\n\n• ${list}`;
      if (!window.confirm(prompt)) return;
    }
    busy = installation.manifest.id;
    try {
      await comExtStore.changeEnabled(installation.manifest.id, enable);
    } catch (error) {
      notificationStore.error(formatError(error));
    } finally {
      busy = null;
    }
  }

  async function uninstall(installation: ComExtInstallation) {
    const confirmed = window.confirm(
      $t('settings.comExt.uninstallConfirm', { values: { name: installation.manifest.name } }),
    );
    if (!confirmed) return;
    busy = installation.manifest.id;
    try {
      await comExtStore.uninstall(installation.manifest.id);
      notificationStore.success($t('settings.comExt.uninstalled'));
    } catch (error) {
      notificationStore.error(formatError(error));
    } finally {
      busy = null;
    }
  }

  function capabilityLabel(capability: ComExtCapability): string {
    return $t(CAPABILITY_LABEL_KEYS[capability]);
  }

  function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  }

  function formatError(error: unknown) {
    return formatUserFacingError(error);
  }
</script>

{#if COMMUNITY_EXT_ENABLED}
  <div class="com-ext-page">
    <header>
      <div>
        <h1>{$t('settings.comExt.title')}</h1>
        <p>{$t('settings.comExt.description')}</p>
      </div>
      {#if !mobile}
        <button type="button" class="secondary" disabled={busy !== null} onclick={importPackage}>
          <Icon name="uploadFile" size="18px" />
          {$t('settings.comExt.import')}
        </button>
      {/if}
    </header>

    <section class="notice warning">
      <Icon name="warning" size="22px" />
      <div>
        <p>{$t('settings.comExt.unsignedWarning')}</p>
      </div>
    </section>

    <section class="section">
      <div class="section-title">
        <div>
          <h2>{$t('settings.comExt.installedTitle')}</h2>
          <p>{$t('settings.comExt.installedHint')}</p>
        </div>
      </div>

      {#if comExtStore.loading && !comExtStore.overview}
        <div class="loading">
          <ProgressRing size={26} label={$t('common.loading')} />
        </div>
      {:else if comExtStore.installed.length === 0}
        <div class="empty">
          <Icon name="extensions" size="34px" />
          <strong>{$t('settings.comExt.noneInstalled')}</strong>
          <p>{$t('settings.comExt.noneInstalledHint')}</p>
        </div>
      {:else}
        <div class="cards">
          {#each comExtStore.installed as installation (installation.manifest.id)}
            <article class="plugin-card">
              <div class="plugin-icon"><Icon name="extensions" size="24px" /></div>
              <div class="plugin-copy">
                <h3>{installation.manifest.name}</h3>
                <p>{installation.manifest.description}</p>
                <small>
                  {$t('settings.comExt.publisher')}：{installation.manifest.publisher} · v{installation.manifest.version} · {formatBytes(installation.disk_bytes)}
                </small>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={installation.enabled}
                  disabled={busy !== null}
                  onchange={() => toggle(installation)}
                />
                <span></span>
              </label>

              <details>
                <summary>
                  {installation.manifest.requested_capabilities.length > 0
                    ? $t('settings.comExt.permissions')
                    : $t('settings.comExt.noPermissions')}
                </summary>
                {#if installation.manifest.requested_capabilities.length > 0}
                  <ul>
                    {#each installation.manifest.requested_capabilities as capability}
                      <li>
                        {capabilityLabel(capability)}
                        {#if installation.granted_capabilities.includes(capability)}
                          <em>· {$t('settings.comExt.granted')}</em>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </details>

              <div class="card-actions">
                <button type="button" class="danger" disabled={busy !== null} onclick={() => uninstall(installation)}>
                  {$t('settings.comExt.uninstall')}
                </button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="section">
      <div class="section-title">
        <div>
          <h2>{$t('settings.comExt.capabilitiesTitle')}</h2>
          {#if comExtStore.overview}
            <p>{$t('settings.comExt.root')}: <code>{comExtStore.overview.root}</code></p>
          {/if}
        </div>
      </div>
      <ul class="capability-list">
        {#each comExtStore.overview?.capabilities ?? [] as capability}
          <li><code>{capability}</code><span>{capabilityLabel(capability)}</span></li>
        {/each}
      </ul>
    </section>
  </div>
{/if}

<style>
  .com-ext-page { max-width: 980px; margin: 0 auto; padding: 1.5rem; color: var(--explorer-text); }
  header, .section-title { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  header { margin-bottom: 1rem; }
  h1 { font-size: 1.35rem; font-weight: 700; }
  h2 { font-size: 1rem; font-weight: 650; }
  header p, .section-title p, .plugin-copy p, .empty p, .notice p { color: var(--explorer-text-muted); font-size: .78rem; }
  code { font-family: var(--explorer-font-mono, ui-monospace, monospace); font-size: .7rem; }
  button { display: inline-flex; align-items: center; gap: .4rem; min-height: 36px; border: 1px solid var(--explorer-border); border-radius: 999px; padding: .4rem .8rem; background: var(--explorer-surface-raised); font-size: .76rem; }
  button:hover:not(:disabled) { background: var(--explorer-surface-hover); }
  button:disabled { opacity: .5; }
  button.danger { color: var(--explorer-danger); }
  .notice { display: flex; gap: .7rem; align-items: flex-start; margin-bottom: 1rem; border: 1px solid var(--explorer-border); border-left: 4px solid var(--explorer-accent); border-radius: 10px; padding: .8rem; background: var(--explorer-surface-raised); }
  .notice.warning { border-left-color: var(--explorer-warning, #c77d00); }
  .section { margin-top: 1.25rem; }
  .section-title { margin-bottom: .65rem; }
  .cards { display: grid; gap: .65rem; }
  .plugin-card { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: .8rem; border: 1px solid var(--explorer-border); border-radius: var(--explorer-radius-medium); padding: .85rem; background: var(--explorer-surface-raised); }
  .plugin-icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 12px; color: var(--explorer-accent); background: var(--explorer-accent-soft); }
  .plugin-copy { min-width: 0; }
  .plugin-copy h3 { font-size: .88rem; font-weight: 650; }
  .plugin-copy p { margin: .1rem 0 .25rem; }
  .plugin-copy small { color: var(--explorer-text-muted); font-size: .68rem; }
  details, .card-actions { grid-column: 2 / -1; }
  details { font-size: .72rem; color: var(--explorer-text-muted); }
  details ul { padding: .4rem 1rem; list-style: disc; }
  details em { font-style: normal; color: var(--explorer-accent); }
  .card-actions { display: flex; flex-wrap: wrap; gap: .4rem; }
  .switch input { position: absolute; opacity: 0; }
  .switch span { display: block; width: 38px; height: 22px; border-radius: 999px; background: var(--explorer-border-strong); padding: 3px; transition: background 140ms ease; }
  .switch span::after { display: block; width: 16px; height: 16px; border-radius: 50%; background: white; content: ''; transition: transform 140ms ease; }
  .switch input:checked + span { background: var(--explorer-accent); }
  .switch input:checked + span::after { transform: translateX(16px); }
  .empty, .loading { display: grid; min-height: 150px; place-items: center; align-content: center; gap: .35rem; border: 1px dashed var(--explorer-border); border-radius: var(--explorer-radius-medium); text-align: center; }
  .empty :global(.material-symbols-rounded) { color: var(--explorer-text-muted); }
  .capability-list { display: grid; gap: .3rem; margin: 0; padding: 0; list-style: none; }
  .capability-list li { display: flex; gap: .6rem; align-items: baseline; border: 1px solid var(--explorer-border); border-radius: 8px; padding: .45rem .6rem; background: var(--explorer-surface-raised); }
  .capability-list span { color: var(--explorer-text-muted); font-size: .74rem; }
  @media (max-width: 650px) {
    .com-ext-page { padding: 1rem; }
    header { align-items: flex-start; }
    .plugin-card { grid-template-columns: 40px minmax(0, 1fr) auto; }
    details, .card-actions { grid-column: 1 / -1; }
  }
</style>
