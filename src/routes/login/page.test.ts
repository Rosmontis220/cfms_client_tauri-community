// @vitest-environment jsdom
//
// The login screen must hand a successful sign-in to the plugins entitled to it
// *before* the post-login loading state replaces the form.
//
// This is the test for a real bug: the loading state is the `{:else}` of the
// element the form sits in, so starting it unmounts the form and every plugin
// contribution inside it. The hand-over used to happen afterwards, in
// `finalizeAuthenticatedLogin`, by which point the page that renders the
// "remember me" panel was gone and its subscription had been disposed — so the
// checkboxes worked, the preference was stored, and no account was ever
// recorded. Nothing but the real screen can catch that ordering, so this mounts
// the real screen and signs in for real.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { comExtStore } from '$lib/com-ext.svelte';
import { storageKeyForServer } from '../../../plugins/remember/src/hash';
import type { ComExtInstallation, ComExtOverview } from '$lib/api/com-ext';
import LoginPage from './+page.svelte';

const PLUGIN_ID = 'org.cfms.remember';
const SERVER = '127.0.0.1:1909';
const USERNAME = 'ada';
const PASSWORD = 'hunter2';
const GRANTED = ['login.form.read', 'login.form.fill', 'storage.read', 'storage.write'] as const;

const pluginPage = resolve('plugins/remember/dist/pages/panel.html');

// The page's motion helpers build a `MediaQuery` at module scope, which jsdom
// does not implement. `vi.hoisted` runs before the imports below, so the stub
// exists by the time that module is evaluated.
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

/** What the backend and the app's stores answer during a sign-in. */
const mocks = vi.hoisted(() => ({
  server: '127.0.0.1:1909',
  goto: vi.fn(),
  info: vi.fn(),
  login: vi.fn(),
  getServerState: vi.fn(),
  getAuthStatus: vi.fn(),
  executeComExtHostCall: vi.fn(),
  getComExtOverview: vi.fn(),
  beginPostLogin: vi.fn(),
  finishPostLogin: vi.fn(),
  apply: vi.fn(),
  load: vi.fn(),
  loadUserPreference: vi.fn(),
  reloadTasksForUser: vi.fn(),
  getDownloadTasks: vi.fn(),
  validateFileShortcuts: vi.fn(),
  readComExtPage: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: mocks.info, error: vi.fn(), warn: vi.fn() }));

// The screen reaches most of the backend through this one barrel, so the real
// module is kept and only the calls a sign-in makes are replaced. Faking the
// whole module would mean reimplementing the error-classification helpers the
// sign-in path relies on, which is how this test first went wrong: `handleLogin`
// threw on a missing export and the failure looked like a plugin bug.
vi.mock('$lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/api')>()),
  login: mocks.login,
  getServerState: mocks.getServerState,
  getAuthStatus: mocks.getAuthStatus,
  getUserAvatar: vi.fn().mockResolvedValue(null),
  downloadAvatar: vi.fn(),
  getDownloadTasks: mocks.getDownloadTasks,
  reloadTasksForUser: mocks.reloadTasksForUser,
  validateFileShortcuts: mocks.validateFileShortcuts,
  loadUserPreference: mocks.loadUserPreference,
  checkCachedAvatar: vi.fn().mockResolvedValue(null),
  clearAuthSession: vi.fn(),
  disconnect: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('$lib/api/com-ext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/api/com-ext')>()),
  executeComExtHostCall: mocks.executeComExtHostCall,
  getComExtOverview: mocks.getComExtOverview,
  readComExtPage: mocks.readComExtPage,
}));

vi.mock('$lib/stores.svelte', () => ({
  authStore: {
    apply: mocks.apply,
    beginPostLogin: mocks.beginPostLogin,
    finishPostLogin: mocks.finishPostLogin,
    isLoggedIn: false,
    avatarPath: null,
  },
  fileShortcutValidationStore: { apply: vi.fn() },
  serverStateStore: {
    apply: mocks.apply,
    connected: true,
    serverName: 'Test Server',
    remoteAddress: mocks.server,
    lockdownReason: null,
  },
  notificationStore: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
  downloadStore: { setAll: vi.fn() },
}));

vi.mock('$lib/appearance.svelte', () => ({ appearanceStore: { load: mocks.load } }));

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

/** The host's own storage, standing in for the backend's. */
const storage = new Map<string, string>();

function installation(): ComExtInstallation {
  return {
    package_digest: 'a'.repeat(64),
    installed_at: 1_700_000_000,
    enabled: true,
    granted_capabilities: [...GRANTED],
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
      requested_capabilities: [...GRANTED],
      entrypoints: {
        navigation: [],
        settings: [],
        pages: [],
        slots: [{ id: 'login', point: 'login-section', page: 'panel', order: 10 }],
        actions: [],
        hooks: [],
        overrides: [],
      },
      background_triggers: [],
    },
  };
}

function overview(): ComExtOverview {
  return {
    installed: [installation()],
    hostApiVersion: '1.0.0',
    capabilities: [],
    packageExtension: 'cfmscomext',
    root: '/tmp/app/com_ext',
  };
}

beforeEach(() => {
  storage.clear();
  comExtStore.overview = overview();
  comExtStore.error = null;

  mocks.login.mockResolvedValue({ requires_2fa: false, has_server_preference_dek: false });
  mocks.getServerState.mockResolvedValue({ connected: true, serverName: 'Test Server' });
  mocks.getAuthStatus.mockResolvedValue({});
  mocks.loadUserPreference.mockResolvedValue(undefined);
  mocks.reloadTasksForUser.mockResolvedValue(undefined);
  mocks.getDownloadTasks.mockResolvedValue([]);
  mocks.validateFileShortcuts.mockResolvedValue([]);
  mocks.readComExtPage.mockResolvedValue({
    kind: 'html',
    html: readFileSync(pluginPage, 'utf8'),
  });

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function stored(): { rememberMe: boolean; accounts: Array<{ username: string }> } | null {
  const raw = storage.get(storageKeyForServer(SERVER));
  return raw ? JSON.parse(raw) : null;
}

/** The shadow root of the plugin panel the login screen renders in its slot. */
async function findPanel(): Promise<ShadowRoot> {
  return waitFor(() => {
    const frame = document.querySelector('[data-com-ext-app]');
    const shadow = frame?.shadowRoot;
    expect(shadow, 'the remember panel never rendered into the sign-in form').toBeTruthy();
    return shadow as ShadowRoot;
  });
}

describe('the sign-in screen hands credentials to plugins', () => {
  it('records the sign-in even though the loading state unmounts the form', async () => {
    render(LoginPage);

    // The remember panel renders inside the sign-in form, which is where its
    // slot is. It lives in a shadow root, so it is reached through the frame.
    const shadow = await findPanel();

    // The controls are inert until the plugin has read what they control, so
    // "the remember-me box is enabled" is the precise signal that its state is
    // loaded and its subscription is up. Ticking any earlier would be a choice
    // the load then overwrites.
    await waitFor(() =>
      expect(
        shadow.querySelector<HTMLInputElement>('[data-role="remember-me"]')?.disabled,
      ).toBe(false),
    );

    const rememberMe = shadow.querySelector<HTMLInputElement>('[data-role="remember-me"]');
    expect(rememberMe, 'the panel should offer a remember-me box').toBeTruthy();
    if (!rememberMe) return;
    rememberMe.checked = true;
    rememberMe.dispatchEvent(new Event('change'));
    await waitFor(() => expect(stored()?.rememberMe).toBe(true));

    const username = document.querySelector<HTMLInputElement>('#username');
    const password = document.querySelector<HTMLInputElement>('input[type="password"]');
    expect(username, 'the sign-in form should have a username field').toBeTruthy();
    expect(password, 'the sign-in form should have a password field').toBeTruthy();
    if (!username || !password) return;
    username.value = USERNAME;
    username.dispatchEvent(new Event('input'));
    password.value = PASSWORD;
    password.dispatchEvent(new Event('input'));

    const form = username.closest('form');
    expect(form, 'the fields should sit in a form').toBeTruthy();
    form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    await waitFor(() => expect(mocks.login).toHaveBeenCalled(), { timeout: 3000 });

    // The credentials must reach the plugin before the form is torn down. The
    // loading state replaces the form, so a hand-over that happened after it
    // would find no listener and store nothing.
    await waitFor(() => expect(stored()?.accounts).toHaveLength(1), { timeout: 3000 });
    expect(stored()?.accounts[0]).toMatchObject({ username: USERNAME });
    expect(mocks.login).toHaveBeenCalledWith(USERNAME, PASSWORD);
  });
});
