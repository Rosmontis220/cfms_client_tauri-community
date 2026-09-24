import {
  executeComExtHostCall,
  getComExtOverview,
  importComExtPackage,
  setComExtEnabled,
  uninstallComExtPlugin,
  type ComExtActionPoint,
  type ComExtCapability,
  type ComExtHookPoint,
  type ComExtInstallation,
  type ComExtOverview,
  type ComExtSlotPoint,
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

  /**
   * Human-readable plugin name for consent prompts, falling back to the id so a
   * prompt is never shown with an empty name.
   */
  displayNameFor(pluginId: string): string {
    const installation = this.installed.find((entry) => entry.manifest.id === pluginId);
    return installation?.manifest.name ?? pluginId;
  }

  /**
   * Whether a plugin is enabled. Legacy capability metadata cannot restrict it.
   */
  grants(pluginId: string, _capability: ComExtCapability): boolean {
    const installation = this.installed.find((entry) => entry.manifest.id === pluginId);
    return Boolean(installation?.enabled);
  }

  /** Ids of enabled plugins that subscribe to a capability event. */
  pluginsGranting(capability: ComExtCapability): string[] {
    return this.enabledInstallations
      .filter((installation) =>
        installation.manifest.requested_capabilities.length === 0 ||
        installation.manifest.requested_capabilities.includes(capability),
      )
      .map((installation) => installation.manifest.id);
  }

  /** Enabled page-backed handlers for a host interception point, in order. */
  handlerContributors(point: string): Array<{
    pluginId: string;
    packageDigest: string;
    entry: NonNullable<ComExtInstallation['manifest']['entrypoints']['handlers']>[number];
  }> {
    return this.enabledInstallations
      .flatMap((installation) =>
        (installation.manifest.entrypoints.handlers ?? [])
          .filter((entry) => entry.point === point)
          .map((entry) => ({ pluginId: installation.manifest.id, packageDigest: installation.package_digest, entry })),
      )
      .sort((left, right) => left.entry.order - right.entry.order);
  }

  /** Plugins that contribute an action to a given action point. */
  actionContributors(point: ComExtActionPoint): Array<{
    pluginId: string;
    entry: ComExtInstallation['manifest']['entrypoints']['actions'][number];
  }> {
    const contributors: Array<{
      pluginId: string;
      entry: ComExtInstallation['manifest']['entrypoints']['actions'][number];
    }> = [];
    for (const installation of this.enabledInstallations) {
      for (const entry of installation.manifest.entrypoints.actions) {
        if (entry.point === point) {
          contributors.push({ pluginId: installation.manifest.id, entry });
        }
      }
    }
    return contributors;
  }

  /** Plugins that attach to a given lifecycle hook point, in declared order. */
  hookContributors(point: ComExtHookPoint): Array<{ pluginId: string; workflow: string }> {
    const contributors: Array<{ pluginId: string; workflow: string }> = [];
    for (const installation of this.enabledInstallations) {
      for (const entry of installation.manifest.entrypoints.hooks) {
        if (entry.point === point) {
          contributors.push({ pluginId: installation.manifest.id, workflow: entry.workflow });
        }
      }
    }
    return contributors;
  }

  /** Plugins that contribute to a given UI slot point, in declared order. */
  slotContributors(point: ComExtSlotPoint): Array<{ pluginId: string; entry: ComExtInstallation['manifest']['entrypoints']['slots'][number] }> {
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

  /** Forward a plugin host call without capability-specific consent gates. */
  async callHost<T = unknown>(
    pluginId: string,
    capability: ComExtCapability,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    return executeComExtHostCall<T>(pluginId, capability, args);
  }
}

export const comExtStore = new ComExtStore();
