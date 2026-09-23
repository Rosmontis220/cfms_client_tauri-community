// @vitest-environment jsdom
//
// What happens to a plugin page when the host takes it away.
//
// A page is mounted into a shadow root and unmounted by clearing it. Clearing
// the markup is not enough: a page that subscribed to host events would keep
// its listener, so every visit to the screen would leave one more live listener
// acting on behalf of a panel that no longer exists. These tests drive the real
// `ComExtAppFrame` through a real mount and unmount, because that is the only
// place the contract can be broken.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { comExtStore } from '$lib/com-ext.svelte';
import { provideComExtLocalCapability } from '$lib/com-ext-local-capabilities';
import { dispatchComExtEvent } from '$lib/com-ext-events';
import type { ComExtInstallation, ComExtOverview } from '$lib/api/com-ext';
import ComExtAppFrame from './ComExtAppFrame.svelte';

const PLUGIN_ID = 'org.example.remember';
const rememberPage = resolve('plugins/remember/dist/pages/panel.html');

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

const GRANTED = ['login.form.read', 'login.form.fill', 'storage.read', 'storage.write'] as const;

function installation(granted: ComExtInstallation['granted_capabilities']): ComExtInstallation {
  return {
    package_digest: 'a'.repeat(64),
    installed_at: 1_700_000_000,
    enabled: true,
    granted_capabilities: granted,
    disk_bytes: 1024,
    manifest: {
      format: 'cfmscomext',
      schema_version: 1,
      id: PLUGIN_ID,
      name: 'Remember me',
      description: 'A plugin used by tests',
      publisher: 'tests',
      version: '1.0.0',
      com_ext_api: '1.0.0',
      min_client_version: '0.51.1',
      requested_capabilities: granted,
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
  comExtStore.overview = overview([installation([...GRANTED])]);
  comExtStore.error = null;
  mocks.executeComExtHostCall.mockReset();
  mocks.executeComExtHostCall.mockResolvedValue({ value: null });
});

afterEach(cleanup);

/** Render a page and hand back its shadow root once the scripts have run. */
async function mountPage(html: string): Promise<ShadowRoot> {
  const { container } = render(ComExtAppFrame, { html, pluginId: PLUGIN_ID });
  return waitFor(() => {
    const root = container.querySelector('div')?.shadowRoot;
    expect(root, 'the page never got a shadow root').toBeTruthy();
    return root as ShadowRoot;
  });
}

describe('a plugin page that is unmounted', () => {
  it('stops hearing events the host addresses to it', async () => {
    // The count is kept on `window` rather than in the markup: unmounting the
    // page clears its shadow root, so the only surviving evidence of a listener
    // that should be gone is something outside the page.
    const shadow = await mountPage(`<!doctype html><html><body>
      <p data-role="count">0</p>
      <script>
        window.__seen = 0;
        host.on('login.succeeded', () => {
          window.__seen += 1;
          const node = root.querySelector('[data-role="count"]');
          if (node) node.textContent = String(window.__seen);
        });
      </script>
    </body></html>`);

    const seen = () => (window as unknown as { __seen: number }).__seen;
    expect(seen()).toBe(0);

    dispatchComExtEvent([PLUGIN_ID], 'login.succeeded', {});
    expect(seen()).toBe(1);
    expect(shadow.querySelector('[data-role="count"]')?.textContent).toBe('1');

    cleanup();
    dispatchComExtEvent([PLUGIN_ID], 'login.succeeded', {});

    // Still one: the page is gone, so nothing it left behind is listening.
    expect(seen()).toBe(1);
  });

  // The built page is not committed, so `vitest.global-setup.ts` builds it
  // before the suite runs; reading it here makes a missing build a failure.
  it('cannot write to the host’s store after it has been taken away', async () => {
    // The remember plugin writes on every successful sign-in. Left subscribed,
    // unmounting the panel and signing in would still save the credentials —
    // the feature would be running with nothing on screen to explain it.
    const release = provideComExtLocalCapability('login.form.read', () => ({
      username: '',
      password: '',
      server: '127.0.0.1:1909',
    }));
    const shadow = await mountPage(readFileSync(rememberPage, 'utf8'));

    // Two waits, because the page has two moments. `storage.read` proves it
    // started; the disabled password box is set by the render immediately
    // before it subscribes to `login.succeeded`, so it proves the page is ready
    // to hear about a sign-in. Dispatching any earlier would test the event
    // racing the page's own start-up rather than the unmount.
    const capabilities = () =>
      mocks.executeComExtHostCall.mock.calls.map((call) => call[1] as string);
    await waitFor(() => expect(capabilities()).toContain('storage.read'));
    await waitFor(() =>
      expect(
        shadow.querySelector<HTMLInputElement>('[data-role="remember-password"]')?.disabled,
      ).toBe(true),
    );
    expect(shadow.querySelector('[data-role="remember"]')).not.toBeNull();

    cleanup();
    mocks.executeComExtHostCall.mockClear();

    dispatchComExtEvent([PLUGIN_ID], 'login.succeeded', { username: 'ada', password: 'hunter2' });
    await Promise.resolve();

    expect(capabilities()).not.toContain('storage.write');
    expect(mocks.executeComExtHostCall).not.toHaveBeenCalled();
    release();
  });
});
