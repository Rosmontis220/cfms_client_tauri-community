// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '$lib/i18n';
import { comExtStore } from '$lib/com-ext.svelte';
import type { ComExtInstallation } from '$lib/api/com-ext';
import ComExtSettingsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  getComExtOverview: vi.fn(),
  importComExtPackage: vi.fn(),
  setComExtEnabled: vi.fn(),
  uninstallComExtPlugin: vi.fn(),
  openDialog: vi.fn(),
  goto: vi.fn(),
  notificationSuccess: vi.fn(),
  notificationError: vi.fn(),
}));

vi.mock('$lib/api/com-ext', () => ({
  getComExtOverview: mocks.getComExtOverview,
  importComExtPackage: mocks.importComExtPackage,
  setComExtEnabled: mocks.setComExtEnabled,
  uninstallComExtPlugin: mocks.uninstallComExtPlugin,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.openDialog }));
vi.mock('$lib/platform', () => ({ isMobilePlatform: () => false }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/stores.svelte', () => ({
  notificationStore: { success: mocks.notificationSuccess, error: mocks.notificationError },
}));

function installation(overrides: Partial<ComExtInstallation> = {}): ComExtInstallation {
  return {
    package_digest: 'a'.repeat(64),
    installed_at: 1_700_000_000,
    enabled: false,
    granted_capabilities: [],
    disk_bytes: 2048,
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
      requested_capabilities: ['files.list', 'tasks.read'],
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

function overview(installed: ComExtInstallation[]) {
  return {
    installed,
    hostApiVersion: '1.0.0',
    capabilities: ['files.list', 'tasks.read'],
    packageExtension: 'cfmscomext',
    root: '/tmp/app/com_ext',
  };
}

beforeEach(() => {
  locale.set('en');
  comExtStore.overview = null;
  comExtStore.error = null;
  mocks.getComExtOverview.mockResolvedValue(overview([]));
  mocks.importComExtPackage.mockReset();
  mocks.setComExtEnabled.mockResolvedValue(undefined);
  mocks.uninstallComExtPlugin.mockResolvedValue(undefined);
  mocks.openDialog.mockResolvedValue(null);
  mocks.notificationSuccess.mockReset();
  mocks.notificationError.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('community plugin settings page', () => {
  it('shows the empty state when nothing is installed', async () => {
    render(ComExtSettingsPage);
    await waitFor(() => expect(mocks.getComExtOverview).toHaveBeenCalled());
    expect(await screen.findByText('No community plugins installed')).toBeTruthy();
  });

  it('warns that community plugins are not signature-verified', async () => {
    render(ComExtSettingsPage);
    expect(
      await screen.findByText(/not signature-verified/i),
    ).toBeTruthy();
  });

  it('lists an installed plugin with its declared capabilities', async () => {
    mocks.getComExtOverview.mockResolvedValue(overview([installation()]));
    const { container } = render(ComExtSettingsPage);

    expect(await screen.findByText('Test Plugin')).toBeTruthy();
    expect(screen.getByText(/tests · v1\.0\.0/)).toBeTruthy();

    // Scope to the plugin card: the capability reference further down the page
    // repeats these labels.
    const declared = Array.from(
      container.querySelectorAll('.plugin-card details li'),
    ).map((node) => node.textContent?.trim());
    expect(declared).toEqual(['List server directories', 'Read transfer task state']);
  });

  it('asks for confirmation before enabling and then enables', async () => {
    mocks.getComExtOverview.mockResolvedValue(overview([installation()]));
    const { container } = render(ComExtSettingsPage);
    await screen.findByText('Test Plugin');

    const toggle = container.querySelector('.switch input') as HTMLInputElement;
    await fireEvent.click(toggle);

    await waitFor(() =>
      expect(mocks.setComExtEnabled).toHaveBeenCalledWith('org.example.test', true),
    );
    // The capability prompt must name the plugin before anything is granted.
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Test Plugin'));
  });

  it('does not enable when the capability prompt is declined', async () => {
    mocks.getComExtOverview.mockResolvedValue(overview([installation()]));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container } = render(ComExtSettingsPage);
    await screen.findByText('Test Plugin');

    await fireEvent.click(container.querySelector('.switch input') as HTMLInputElement);

    expect(mocks.setComExtEnabled).not.toHaveBeenCalled();
  });

  it('disables an enabled plugin without prompting', async () => {
    mocks.getComExtOverview.mockResolvedValue(
      overview([
        installation({ enabled: true, granted_capabilities: ['files.list', 'tasks.read'] }),
      ]),
    );
    const { container } = render(ComExtSettingsPage);
    await screen.findByText('Test Plugin');

    await fireEvent.click(container.querySelector('.switch input') as HTMLInputElement);

    await waitFor(() =>
      expect(mocks.setComExtEnabled).toHaveBeenCalledWith('org.example.test', false),
    );
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('uninstalls only after confirmation', async () => {
    mocks.getComExtOverview.mockResolvedValue(overview([installation()]));
    render(ComExtSettingsPage);
    await screen.findByText('Test Plugin');

    await fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));

    await waitFor(() =>
      expect(mocks.uninstallComExtPlugin).toHaveBeenCalledWith('org.example.test'),
    );
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Test Plugin'));
  });

  it('imports a package chosen from the .cfmscomext filter', async () => {
    mocks.openDialog.mockResolvedValue('C:\\plugins\\demo.cfmscomext');
    mocks.importComExtPackage.mockResolvedValue(installation());
    render(ComExtSettingsPage);
    await waitFor(() => expect(mocks.getComExtOverview).toHaveBeenCalled());

    await fireEvent.click(screen.getByRole('button', { name: /Import plugin package/i }));

    await waitFor(() =>
      expect(mocks.importComExtPackage).toHaveBeenCalledWith('C:\\plugins\\demo.cfmscomext'),
    );
    expect(mocks.openDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ name: 'CFMS Community Plugin', extensions: ['cfmscomext'] }],
      }),
    );
  });

  it('surfaces an installation failure instead of failing silently', async () => {
    mocks.openDialog.mockResolvedValue('C:\\plugins\\broken.cfmscomext');
    mocks.importComExtPackage.mockRejectedValue(new Error('Not a community package'));
    render(ComExtSettingsPage);
    await waitFor(() => expect(mocks.getComExtOverview).toHaveBeenCalled());

    await fireEvent.click(screen.getByRole('button', { name: /Import plugin package/i }));

    await waitFor(() => expect(mocks.notificationError).toHaveBeenCalled());
  });
});
