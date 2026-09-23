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
 * Capabilities that cause a real, user-visible side effect.
 *
 * Both of these put a file on the user's disk, so the broker refuses to forward
 * them unless the caller has obtained explicit confirmation.  The backend
 * enforces the same rule, so this is defence in depth rather than the only
 * barrier.
 *
 * Exported because the workflow engine needs the same list: if the two
 * disagreed, a workflow could either prompt twice or skip the prompt entirely.
 */
export const COM_EXT_SIDE_EFFECTING_CAPABILITIES: ReadonlySet<ComExtCapability> =
  new Set(['files.open', 'transfers.download.enqueue']);

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
   * Whether an enabled plugin holds a granted capability.
   *
   * The backend re-checks this for every call it answers, so this is not the
   * only barrier. It is the *first* one for the capabilities the backend never
   * sees: the running app answers those itself, and without this check a page
   * could reach one the user was never asked about.
   */
  grants(pluginId: string, capability: ComExtCapability): boolean {
    const installation = this.installed.find((entry) => entry.manifest.id === pluginId);
    return Boolean(
      installation?.enabled && installation.granted_capabilities.includes(capability),
    );
  }

  /**
   * Ids of the enabled plugins that hold a granted capability.
   *
   * Used to address an event at the plugins entitled to receive it, so the
   * decision is made from the grant list rather than by whoever is listening.
   */
  pluginsGranting(capability: ComExtCapability): string[] {
    return this.enabledInstallations
      .filter((installation) => installation.granted_capabilities.includes(capability))
      .map((installation) => installation.manifest.id);
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

    if (COM_EXT_SIDE_EFFECTING_CAPABILITIES.has(capability)) {
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
