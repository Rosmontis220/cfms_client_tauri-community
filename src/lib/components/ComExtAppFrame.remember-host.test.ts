// @vitest-environment jsdom
//
// The whole chain a real sign-in takes, with nothing stubbed that the app does
// not stub itself.
//
// The sibling `ComExtAppFrame.remember.test.ts` mounts the page with a stub
// bridge, which is the right way to test the plugin's own rules but is also a
// way to miss everything the real bridge does: the grant check, the choice
// between the app and the backend for a capability, the addressed event
// channel, and the app's own registry of the sign-in form. Those are exactly
// the parts that differ between a test and the installed app, so they are
// driven for real here — real `ComExtAppFrame`, real `createComExtPageHost`,
// real `comExtStore`, real `provideComExtLocalCapability`, real
// `dispatchComExtEvent`, and the real built page.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { comExtStore } from '$lib/com-ext.svelte';
import { dispatchComExtEvent } from '$lib/com-ext-events';
import { provideComExtLocalCapability } from '$lib/com-ext-local-capabilities';
import { storageKeyForServer } from '../../../plugins/remember/src/hash';
import type { ComExtInstallation, ComExtOverview } from '$lib/api/com-ext';
import ComExtAppFrame from './ComExtAppFrame.svelte';

const PLUGIN_ID = 'org.cfms.remember';
const SERVER = '127.0.0.1:1909';
const GRANTED = ['login.form.read', 'login.form.fill', 'storage.read', 'storage.write'] as const;

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

const pluginPage = resolve('plugins/remember/dist/pages/panel.html');

/** The host's own storage, standing in for the backend's. */
const storage = new Map<string, string>();

/** The sign-in form, standing in for the login screen's component state. */
let form: { username: string; password: string; server: string };

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
      name: '记住用户名密码',
      description: 'A plugin used by tests',
      publisher: 'DC',
      version: '1.0.0',
      com_ext_api: '1.0.0',
      min_client_version: '1.0.0',
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
  storage.clear();
  form = { username: '', password: '', server: SERVER };
  comExtStore.overview = overview([installation([...GRANTED])]);
  comExtStore.error = null;

  mocks.executeComExtHostCall.mockReset();
  mocks.executeComExtHostCall.mockImplementation(
    async (_pluginId: string, capability: string, args: Record<string, unknown> = {}) => {
      switch (capability) {
        case 'storage.read':
          return { value: storage.get(String(args.key)) ?? null };
        case 'storage.write':
          storage.set(String(args.key), String(args.value));
          return { saved: true };
        default:
          throw new Error(`the backend was asked to answer "${capability}"`);
      }
    },
  );
});

afterEach(cleanup);

/** Mount the built page the way the host does, and wait until it is ready. */
async function mountPage(): Promise<ShadowRoot> {
  const { container } = render(ComExtAppFrame, {
    html: readFileSync(pluginPage, 'utf8'),
    pluginId: PLUGIN_ID,
  });
  const shadow = await waitFor(() => {
    const root = container.querySelector('div')?.shadowRoot;
    expect(root, 'the page never got a shadow root').toBeTruthy();
    return root as ShadowRoot;
  });

  // The controls are inert until the plugin has read what they control, so
  // "the remember-me box is enabled" is the precise signal that its state is
  // loaded and its subscription is up. Waiting on the `storage.read` call
  // instead would only prove the read had been *issued*.
  await waitFor(() =>
    expect(
      shadow.querySelector<HTMLInputElement>('[data-role="remember-me"]')?.disabled,
    ).toBe(false),
  );
  return shadow;
}

/** Tick a checkbox the way a user does. */
function tick(shadow: ShadowRoot, role: string, checked: boolean): void {
  const box = shadow.querySelector<HTMLInputElement>(`[data-role="${role}"]`);
  if (!box) throw new Error(`no [data-role="${role}"] in the page`);
  box.checked = checked;
  box.dispatchEvent(new Event('change'));
}

/** Everything stored for this server, parsed. */
function storedForServer(): { rememberMe: boolean; rememberPassword: boolean; accounts: Array<{ username: string; password: string }> } | null {
  const raw = storage.get(storageKeyForServer(SERVER));
  return raw ? JSON.parse(raw) : null;
}

describe('the sign-in chain, end to end', () => {
  /** Register the sign-in form exactly as the login screen does. */
  function serveSignInForm(): () => void {
    const releases = [
      provideComExtLocalCapability('login.form.read', () => ({ ...form })),
      provideComExtLocalCapability('login.form.fill', (_pluginId, args) => {
        if (typeof args.username === 'string') form.username = args.username;
        if (typeof args.password === 'string') form.password = args.password;
        return { filled: true };
      }),
    ];
    return () => {
      for (const release of releases) release();
    };
  }

  /** Tell the plugins entitled to know that a sign-in succeeded. */
  function reportSignIn(username: string, password: string): void {
    const audience = comExtStore.pluginsGranting('login.form.read');
    dispatchComExtEvent(audience, 'login.succeeded', { username, password });
  }

  it('records the credentials when the user asked to be remembered', async () => {
    const release = serveSignInForm();
    const shadow = await mountPage();

    tick(shadow, 'remember-me', true);
    await waitFor(() => expect(storedForServer()?.rememberMe).toBe(true));
    tick(shadow, 'remember-password', true);
    await waitFor(() => expect(storedForServer()?.rememberPassword).toBe(true));

    reportSignIn('ada', 'hunter2');

    await waitFor(() => expect(storedForServer()?.accounts).toHaveLength(1));
    expect(storedForServer()?.accounts[0]).toMatchObject({
      username: 'ada',
      password: 'hunter2',
    });

    release();
  });

  it('still records the sign-in when the form is torn down right after it', async () => {
    // What the real sign-in does: hand the credentials over, then navigate. The
    // write has to be in flight before the page is gone, because the page is
    // disposed the moment the navigation unmounts it.
    const release = serveSignInForm();
    const shadow = await mountPage();

    tick(shadow, 'remember-me', true);
    await waitFor(() => expect(storedForServer()?.rememberMe).toBe(true));

    reportSignIn('ada', 'hunter2');
    cleanup();

    await waitFor(() => expect(storedForServer()?.accounts).toHaveLength(1));
    expect(storedForServer()?.accounts[0]).toMatchObject({ username: 'ada' });

    release();
  });

  it('finds the plugin entitled to the sign-in through the grant list', async () => {
    // The audience is computed from the grants the user approved, not from who
    // happens to be listening, so an empty list means the plugin never hears.
    expect(comExtStore.pluginsGranting('login.form.read')).toEqual([PLUGIN_ID]);
  });

  it('restores the account on the next visit to the form', async () => {
    const release = serveSignInForm();
    const first = await mountPage();
    tick(first, 'remember-me', true);
    await waitFor(() => expect(storedForServer()?.rememberMe).toBe(true));
    tick(first, 'remember-password', true);
    await waitFor(() => expect(storedForServer()?.rememberPassword).toBe(true));
    reportSignIn('ada', 'hunter2');
    await waitFor(() => expect(storedForServer()?.accounts).toHaveLength(1));
    cleanup();

    // A fresh visit to the sign-in form, with the same stored state.
    form = { username: '', password: '', server: SERVER };
    const second = await mountPage();

    await waitFor(() => expect(form.username).toBe('ada'));
    expect(form.password).toBe('hunter2');
    expect(second.querySelector('[data-role="remember-me"]')).toBeTruthy();

    release();
  });
});
