// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { comExtStore } from '$lib/com-ext.svelte';
import type { ComExtInstallation, ComExtOverview } from '$lib/api/com-ext';

const mocks = vi.hoisted(() => ({
  executeComExtHostCall: vi.fn(),
  getComExtOverview: vi.fn(),
  importComExtPackage: vi.fn(),
  setComExtEnabled: vi.fn(),
  uninstallComExtPlugin: vi.fn(),
}));

vi.mock('$lib/api/com-ext', () => ({
  executeComExtHostCall: mocks.executeComExtHostCall,
  getComExtOverview: mocks.getComExtOverview,
  importComExtPackage: mocks.importComExtPackage,
  setComExtEnabled: mocks.setComExtEnabled,
  uninstallComExtPlugin: mocks.uninstallComExtPlugin,
}));

function installation(overrides: Partial<ComExtInstallation> = {}): ComExtInstallation {
  return {
    package_digest: 'a'.repeat(64),
    installed_at: 1_700_000_000,
    enabled: true,
    granted_capabilities: ['files.list', 'files.open'],
    disk_bytes: 1024,
    manifest: {
      format: 'cfmscomext',
      schema_version: 1,
      id: 'org.example.test',
      name: 'Test Plugin',
      description: 'A plugin used by tests',
      publisher: 'tests',
      version: '1.0.0',
      com_ext_api: '1.0.0',
      min_client_version: '0.51.1',
      requested_capabilities: ['files.list', 'files.open'],
      entrypoints: {
        navigation: [],
        settings: [],
        pages: [],
        slots: [],
        actions: [],
        hooks: [],
        overrides: [],
      },
      background_triggers: [],
    },
    ...overrides,
  };
}

function overview(installed: ComExtInstallation[]): ComExtOverview {
  return {
    installed,
    hostApiVersion: '1.0.0',
    capabilities: ['files.list', 'files.open'],
    packageExtension: 'cfmscomext',
    root: '/tmp/app/com_ext',
  };
}

beforeEach(() => {
  comExtStore.overview = null;
  comExtStore.error = null;
  mocks.executeComExtHostCall.mockReset();
  mocks.executeComExtHostCall.mockResolvedValue({ ok: true });
  mocks.getComExtOverview.mockReset();
  mocks.getComExtOverview.mockResolvedValue(overview([]));
  mocks.setComExtEnabled.mockReset();
  mocks.setComExtEnabled.mockResolvedValue(undefined);
});

describe('community plugin host-call broker', () => {
  it('forwards a read-only capability without asking for confirmation', async () => {
    const confirm = vi.fn(() => true);

    await comExtStore.callHost('org.example.test', 'files.list', { folderId: 'root' }, confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.executeComExtHostCall).toHaveBeenCalledWith(
      'org.example.test',
      'files.list',
      { folderId: 'root' },
      undefined,
    );
  });

  it('refuses a side-effecting capability when the caller offers no confirmation', async () => {
    await expect(
      comExtStore.callHost('org.example.test', 'files.open', { documentId: 'doc-1' }),
    ).rejects.toThrow(/declined/i);

    expect(mocks.executeComExtHostCall).not.toHaveBeenCalled();
  });

  it('refuses a side-effecting capability when the user declines', async () => {
    const confirm = vi.fn(() => false);

    await expect(
      comExtStore.callHost(
        'org.example.test',
        'transfers.download.enqueue',
        { documentId: 'doc-1', filename: 'report.pdf' },
        confirm,
      ),
    ).rejects.toThrow(/declined/i);

    expect(confirm).toHaveBeenCalledWith('report.pdf');
    expect(mocks.executeComExtHostCall).not.toHaveBeenCalled();
  });

  it('passes userConfirmed once the user approves a download', async () => {
    const confirm = vi.fn(() => true);

    await comExtStore.callHost(
      'org.example.test',
      'transfers.download.enqueue',
      { documentId: 'doc-1', filename: 'report.pdf' },
      confirm,
    );

    expect(mocks.executeComExtHostCall).toHaveBeenCalledWith(
      'org.example.test',
      'transfers.download.enqueue',
      { documentId: 'doc-1', filename: 'report.pdf' },
      true,
    );
  });
});

describe('community plugin slot registry', () => {
  it('returns contributions only from enabled plugins', () => {
    comExtStore.overview = overview([
      installation({
        manifest: {
          ...installation().manifest,
          id: 'org.example.enabled',
          entrypoints: {
            ...installation().manifest.entrypoints,
            slots: [{ id: 'a', point: 'file-row-trailing', page: 'row', order: 1 }],
          },
        },
      }),
      installation({
        enabled: false,
        manifest: {
          ...installation().manifest,
          id: 'org.example.disabled',
          entrypoints: {
            ...installation().manifest.entrypoints,
            slots: [{ id: 'b', point: 'file-row-trailing', page: 'row', order: 0 }],
          },
        },
      }),
    ]);

    const contributors = comExtStore.slotContributors('file-row-trailing');

    expect(contributors.map((entry) => entry.pluginId)).toEqual(['org.example.enabled']);
  });

  it('sorts contributions by their declared order', () => {
    comExtStore.overview = overview([
      installation({
        manifest: {
          ...installation().manifest,
          id: 'org.example.late',
          entrypoints: {
            ...installation().manifest.entrypoints,
            slots: [{ id: 'late', point: 'file-toolbar', page: 'late', order: 20 }],
          },
        },
      }),
      installation({
        manifest: {
          ...installation().manifest,
          id: 'org.example.early',
          entrypoints: {
            ...installation().manifest.entrypoints,
            slots: [{ id: 'early', point: 'file-toolbar', page: 'early', order: 5 }],
          },
        },
      }),
    ]);

    const contributors = comExtStore.slotContributors('file-toolbar');

    expect(contributors.map((entry) => entry.pluginId)).toEqual([
      'org.example.early',
      'org.example.late',
    ]);
  });

  it('ignores contributions aimed at other slot points', () => {
    comExtStore.overview = overview([
      installation({
        manifest: {
          ...installation().manifest,
          entrypoints: {
            ...installation().manifest.entrypoints,
            slots: [{ id: 'nav', point: 'navigation', page: 'nav', order: 1 }],
          },
        },
      }),
    ]);

    expect(comExtStore.slotContributors('file-row-trailing')).toEqual([]);
  });
});

describe('community plugin action registry', () => {
  function withActions(
    id: string,
    actions: Array<{ id: string; label: string; workflow: string; point: string; tone: string }>,
    enabled = true,
  ) {
    const entry = installation({ enabled });
    entry.manifest.id = id;
    entry.manifest.entrypoints.actions = actions;
    return entry;
  }

  it('returns actions contributed to the requested point only', () => {
    comExtStore.overview = overview([
      withActions('org.example.toolbar', [
        { id: 'a', label: 'Scan', workflow: 'scan', point: 'file-toolbar', tone: 'default' },
        { id: 'b', label: 'Menu', workflow: 'menu', point: 'file-context-menu', tone: 'default' },
      ]),
    ]);

    const contributors = comExtStore.actionContributors('file-toolbar');

    expect(contributors.map((entry) => entry.entry.label)).toEqual(['Scan']);
    expect(contributors[0].pluginId).toBe('org.example.toolbar');
  });

  it('ignores actions belonging to a disabled plugin', () => {
    comExtStore.overview = overview([
      withActions(
        'org.example.off',
        [{ id: 'a', label: 'Scan', workflow: 'scan', point: 'file-toolbar', tone: 'default' }],
        false,
      ),
    ]);

    expect(comExtStore.actionContributors('file-toolbar')).toEqual([]);
  });

  it('collects actions from every enabled plugin', () => {
    comExtStore.overview = overview([
      withActions('org.example.a', [
        { id: 'a', label: 'Alpha', workflow: 'a', point: 'file-toolbar', tone: 'default' },
      ]),
      withActions('org.example.b', [
        { id: 'b', label: 'Beta', workflow: 'b', point: 'file-toolbar', tone: 'default' },
      ]),
    ]);

    expect(comExtStore.actionContributors('file-toolbar').map((e) => e.pluginId)).toEqual([
      'org.example.a',
      'org.example.b',
    ]);
  });
});

describe('community plugin store refresh', () => {
  it('records a failed refresh instead of throwing', async () => {
    mocks.getComExtOverview.mockRejectedValue(new Error('backend offline'));

    await comExtStore.refresh();

    expect(comExtStore.error).toContain('backend offline');
    expect(comExtStore.loading).toBe(false);
  });

  it('exposes only enabled plugins as enabled installations', async () => {
    mocks.getComExtOverview.mockResolvedValue(
      overview([installation(), installation({ enabled: false })]),
    );

    await comExtStore.refresh();

    expect(comExtStore.installed).toHaveLength(2);
    expect(comExtStore.enabledInstallations).toHaveLength(1);
  });
});
