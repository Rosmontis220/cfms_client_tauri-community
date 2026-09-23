// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ComExtSlot from '$lib/components/ComExtSlot.svelte';
import { comExtStore } from '$lib/com-ext.svelte';
import type { ComExtInstallation, ComExtOverview, ComExtSlotEntry } from '$lib/api/com-ext';

const mocks = vi.hoisted(() => ({
  readComExtPage: vi.fn(),
  readComExtWorkflow: vi.fn(),
  executeComExtHostCall: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$lib/api/com-ext', () => ({
  readComExtPage: mocks.readComExtPage,
  readComExtWorkflow: mocks.readComExtWorkflow,
  executeComExtHostCall: mocks.executeComExtHostCall,
}));
vi.mock('$lib/platform', () => ({ isMobilePlatform: () => false }));
vi.mock('$lib/stores.svelte', () => ({
  notificationStore: { error: mocks.error, info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

function installation(
  id: string,
  name: string,
  slots: ComExtSlotEntry[],
  enabled = true,
): ComExtInstallation {
  return {
    package_digest: 'a'.repeat(64),
    installed_at: 1_700_000_000,
    enabled,
    granted_capabilities: [],
    disk_bytes: 512,
    manifest: {
      format: 'cfmscomext',
      schema_version: 1,
      id,
      name,
      description: '',
      publisher: 'tests',
      version: '1.0.0',
      com_ext_api: '1.0.0',
      min_client_version: '1.0.0',
      requested_capabilities: [],
      entrypoints: {
        navigation: [],
        settings: [],
        pages: [],
        slots,
        actions: [],
        hooks: [],
        overrides: [],
      },
      background_triggers: [],
    },
  };
}

function overview(installed: ComExtInstallation[]): ComExtOverview {
  return {
    installed,
    hostApiVersion: '1.0.0',
    capabilities: [],
    packageExtension: 'cfmscomext',
    root: '/tmp/app/com_ext',
  };
}

beforeEach(() => {
  mocks.readComExtPage.mockReset();
  mocks.readComExtPage.mockImplementation(async (_pluginId: string, page: string) => ({
    kind: 'declarative',
    document: {
      schema_version: 1,
      title: `Panel ${page}`,
      blocks: [{ type: 'text', text: `from ${page}` }],
    },
  }));
  comExtStore.overview = overview([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('community plugin slot', () => {
  it('renders nothing when no plugin contributes to the point', () => {
    const { container } = render(ComExtSlot, { point: 'overview-section' });

    expect(container.querySelector('.com-ext-slot')).toBeNull();
    expect(mocks.readComExtPage).not.toHaveBeenCalled();
  });

  it('renders a contribution and labels it with the plugin name', async () => {
    comExtStore.overview = overview([
      installation('org.example.a', 'Alpha Plugin', [
        { id: 'panel', point: 'overview-section', page: 'panel', order: 1 },
      ]),
    ]);

    render(ComExtSlot, { point: 'overview-section' });

    expect(await screen.findByText('from panel')).toBeTruthy();
    expect(mocks.readComExtPage).toHaveBeenCalledWith('org.example.a', 'panel');
    expect(screen.getByLabelText('Alpha Plugin')).toBeTruthy();
  });

  it('ignores a disabled plugin', () => {
    comExtStore.overview = overview([
      installation(
        'org.example.off',
        'Disabled Plugin',
        [{ id: 'panel', point: 'overview-section', page: 'panel', order: 1 }],
        false,
      ),
    ]);

    const { container } = render(ComExtSlot, { point: 'overview-section' });

    expect(container.querySelector('.com-ext-slot')).toBeNull();
    expect(mocks.readComExtPage).not.toHaveBeenCalled();
  });

  it('ignores contributions aimed at a different point', () => {
    comExtStore.overview = overview([
      installation('org.example.a', 'Alpha Plugin', [
        { id: 'settings', point: 'settings-section', page: 'settings', order: 1 },
      ]),
    ]);

    const { container } = render(ComExtSlot, { point: 'overview-section' });

    expect(container.querySelector('.com-ext-slot')).toBeNull();
  });

  it('orders contributions by their declared order', async () => {
    comExtStore.overview = overview([
      installation('org.example.late', 'Late Plugin', [
        { id: 'panel', point: 'overview-section', page: 'late', order: 20 },
      ]),
      installation('org.example.early', 'Early Plugin', [
        { id: 'panel', point: 'overview-section', page: 'early', order: 5 },
      ]),
    ]);

    const { container } = render(ComExtSlot, { point: 'overview-section' });
    await screen.findByText('from early');

    const plugins = Array.from(container.querySelectorAll('[data-com-ext-plugin]')).map((node) =>
      node.getAttribute('data-com-ext-plugin'),
    );
    expect(plugins).toEqual(['org.example.early', 'org.example.late']);
  });

  it('renders one contribution per plugin', async () => {
    comExtStore.overview = overview([
      installation('org.example.a', 'Alpha Plugin', [
        { id: 'panel', point: 'overview-section', page: 'alpha', order: 1 },
      ]),
      installation('org.example.b', 'Beta Plugin', [
        { id: 'panel', point: 'overview-section', page: 'beta', order: 2 },
      ]),
    ]);

    render(ComExtSlot, { point: 'overview-section' });

    expect(await screen.findByText('from alpha')).toBeTruthy();
    expect(await screen.findByText('from beta')).toBeTruthy();
  });
});
