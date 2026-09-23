import {
  getComExtOverview,
  importComExtPackage,
  setComExtEnabled,
  uninstallComExtPlugin,
  type ComExtInstallation,
  type ComExtOverview,
} from '$lib/api/com-ext';

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
}

export const comExtStore = new ComExtStore();
