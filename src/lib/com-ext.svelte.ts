import {
  executeComExtHostCall,
  getComExtOverview,
  importComExtPackage,
  setComExtEnabled,
  uninstallComExtPlugin,
  type ComExtCapability,
  type ComExtInstallation,
  type ComExtOverview,
} from '$lib/api/com-ext';

/**
 * Capabilities that cause a real, user-visible side effect.
 *
 * Both of these start a download onto the user's disk, so the broker refuses to
 * forward them unless the caller has obtained explicit confirmation.  The
 * backend enforces the same rule, so this is defence in depth rather than the
 * only barrier.
 */
const SIDE_EFFECTING_CAPABILITIES: ReadonlySet<ComExtCapability> = new Set([
  'files.open',
  'transfers.download.enqueue',
]);

/**
 * Community plugin state.
 *
 * Separate from `extensionsStore`, which tracks the official extension
 * interface.  The two read different commands and different state, so neither
 * can perturb the other's view.
 */
class ComExtStore {
  overview = $state<ComExtOverview | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  get installed(): ComExtInstallation[] {
    return this.overview?.installed ?? [];
  }

  get enabledInstallations(): ComExtInstallation[] {
    return this.installed.filter((installation) => installation.enabled);
  }

  /** Plugins that contribute to a given UI slot point, in declared order. */
  slotContributors(point: string): Array<{ pluginId: string; entry: ComExtInstallation['manifest']['entrypoints']['slots'][number] }> {
    const contributors: Array<{ pluginId: string; entry: ComExtInstallation['manifest']['entrypoints']['slots'][number] }> = [];
    for (const installation of this.enabledInstallations) {
      for (const entry of installation.manifest.entrypoints.slots) {
        if (entry.point === point) {
          contributors.push({ pluginId: installation.manifest.id, entry });
        }
      }
    }
    return contributors.sort((left, right) => left.entry.order - right.entry.order);
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.overview = await getComExtOverview();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  async importPackage(path: string): Promise<ComExtInstallation> {
    const installed = await importComExtPackage(path);
    await this.refresh();
    return installed;
  }

  async changeEnabled(pluginId: string, enabled: boolean): Promise<void> {
    await setComExtEnabled(pluginId, enabled);
    await this.refresh();
  }

  async uninstall(pluginId: string): Promise<void> {
    await uninstallComExtPlugin(pluginId);
    await this.refresh();
  }

  /**
   * Invoke a host capability on behalf of a plugin.
   *
   * `confirm` is consulted only for side-effecting capabilities; when it is
   * absent or declines, the call is refused without reaching the backend.
   */
  async callHost<T = unknown>(
    pluginId: string,
    capability: ComExtCapability,
    args: Record<string, unknown> = {},
    confirm?: (summary: string) => boolean,
  ): Promise<T> {
    let userConfirmed: boolean | undefined;

    if (SIDE_EFFECTING_CAPABILITIES.has(capability)) {
      const summary =
        typeof args.filename === 'string'
          ? args.filename
          : typeof args.documentId === 'string'
            ? args.documentId
            : '';
      if (!confirm?.(summary)) {
        throw new Error('The user declined this action.');
      }
      userConfirmed = true;
    }

    return executeComExtHostCall<T>(pluginId, capability, args, userConfirmed);
  }
}

export const comExtStore = new ComExtStore();
