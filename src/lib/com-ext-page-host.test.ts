// @vitest-environment jsdom
//
// The plugin page bridge — the only surface a page with its own code is given.
//
// Three things must hold or the bridge is worse than nothing: a plugin cannot
// reach a capability it was not granted, a capability the running app answers
// is reachable at all (the backend never sees those), and an event reaches only
// the plugin it was addressed to.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { locale, waitLocale } from 'svelte-i18n';
import './i18n';
import { comExtStore } from '$lib/com-ext.svelte';
import {
  hasComExtLocalCapability,
  provideComExtLocalCapability,
} from '$lib/com-ext-local-capabilities';
import { dispatchComExtEvent } from '$lib/com-ext-events';
import { createComExtPageHost } from '$lib/com-ext-page-host';
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

/** A plugin granted exactly the capabilities named, and enabled unless told otherwise. */
function installation(
  granted: ComExtInstallation['granted_capabilities'],
  enabled = true,
): ComExtInstallation {
  return {
    package_digest: 'a'.repeat(64),
    installed_at: 1_700_000_000,
    enabled,
    granted_capabilities: granted,
    disk_bytes: 1024,
    manifest: {
      format: 'cfmscomext',
      schema_version: 1,
      id: 'org.example.remember',
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

beforeEach(async () => {
  // The confirmation the bridge raises is a translated sentence, so the
  // catalogue has to be loaded before any test can reach it.
  locale.set('en');
  await waitLocale();

  comExtStore.overview = null;
  comExtStore.error = null;
  mocks.executeComExtHostCall.mockReset();
  mocks.executeComExtHostCall.mockResolvedValue({ ok: true });
  mocks.getComExtOverview.mockReset();
  mocks.getComExtOverview.mockResolvedValue(overview([]));
});

describe('plugin page host bridge', () => {
  it('refuses a capability the plugin never declared, without reaching the host', async () => {
    comExtStore.overview = overview([installation(['storage.read'])]);

    const host = createComExtPageHost('org.example.remember');

    await expect(host.call('login.form.read', {})).rejects.toThrow(/not been granted/);
    expect(mocks.executeComExtHostCall).not.toHaveBeenCalled();
  });

  it('refuses a capability the plugin declared but the user never granted', async () => {
    // Enabled, and asking for it in the manifest, but the grant list is empty —
    // which is the state a plugin sits in when the capability prompt is declined.
    comExtStore.overview = overview([installation([])]);

    const host = createComExtPageHost('org.example.remember');

    await expect(host.call('login.form.read', {})).rejects.toThrow(/not been granted/);
  });

  it('refuses a capability held by a plugin that is installed but disabled', async () => {
    comExtStore.overview = overview([installation(['login.form.read'], false)]);

    const host = createComExtPageHost('org.example.remember');

    await expect(host.call('login.form.read', {})).rejects.toThrow(/not been granted/);
  });

  it('refuses a capability granted to a different plugin', async () => {
    // The id is bound when the bridge is built, so a page cannot borrow another
    // plugin's grant by naming it.
    comExtStore.overview = overview([installation(['login.form.read'])]);

    const host = createComExtPageHost('org.example.other');

    await expect(host.call('login.form.read', {})).rejects.toThrow(/not been granted/);
    expect(mocks.executeComExtHostCall).not.toHaveBeenCalled();
  });

  it("answers from the app when a mounted screen serves the capability", async () => {
    comExtStore.overview = overview([installation(['login.form.read'])]);
    const handler = vi.fn(() => ({ username: 'ada', password: 'hunter2' }));
    const release = provideComExtLocalCapability('login.form.read', handler);

    try {
      const host = createComExtPageHost('org.example.remember');

      await expect(host.call('login.form.read', {})).resolves.toEqual({
        username: 'ada',
        password: 'hunter2',
      });
      // Answered in the app, so the backend is never asked.
      expect(mocks.executeComExtHostCall).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it('stops serving a capability once the screen that provided it goes away', async () => {
    comExtStore.overview = overview([installation(['login.form.read'])]);
    const release = provideComExtLocalCapability('login.form.read', () => ({ username: 'ada' }));
    release();

    expect(hasComExtLocalCapability('login.form.read')).toBe(false);
  });

  it('falls through to the backend for a capability the app does not serve', async () => {
    comExtStore.overview = overview([installation(['storage.write'])]);

    const host = createComExtPageHost('org.example.remember');
    await host.call('storage.write', { key: 'a', value: 'b' });

    expect(mocks.executeComExtHostCall).toHaveBeenCalledWith(
      'org.example.remember',
      'storage.write',
      { key: 'a', value: 'b' },
      undefined,
    );
  });

  it('confirms with the user before a capability that touches their disk', async () => {
    comExtStore.overview = overview([installation(['transfers.download.enqueue'])]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    try {
      const host = createComExtPageHost('org.example.remember');
      await host.call('transfers.download.enqueue', { documentId: 'd1', filename: 'notes.pdf' });

      // The question names the plugin and the file rather than asking "allow?".
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('notes.pdf'));
      expect(mocks.executeComExtHostCall).toHaveBeenCalledWith(
        'org.example.remember',
        'transfers.download.enqueue',
        { documentId: 'd1', filename: 'notes.pdf' },
        true,
      );
    } finally {
      confirm.mockRestore();
    }
  });

  it('does not reach the backend when the user declines', async () => {
    comExtStore.overview = overview([installation(['files.open'])]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    try {
      const host = createComExtPageHost('org.example.remember');
      await expect(host.call('files.open', { documentId: 'd1', filename: 'a.pdf' })).rejects.toThrow(
        /declined/,
      );
      expect(mocks.executeComExtHostCall).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
  });

  it('delivers an event only to the plugin it was addressed to', () => {
    const host = createComExtPageHost('org.example.remember');
    const mine = vi.fn();
    const stop = host.on('login.succeeded', mine);

    dispatchComExtEvent(['org.example.other'], 'login.succeeded', { username: 'ada' });
    expect(mine).not.toHaveBeenCalled();

    dispatchComExtEvent(['org.example.remember'], 'login.succeeded', { username: 'ada' });
    expect(mine).toHaveBeenCalledWith({ username: 'ada' });

    // A different event on the same plugin is not conflated with it.
    mine.mockClear();
    dispatchComExtEvent(['org.example.remember'], 'login.failed', { reason: 'nope' });
    expect(mine).not.toHaveBeenCalled();

    stop();
    dispatchComExtEvent(['org.example.remember'], 'login.succeeded', { username: 'ada' });
    expect(mine).not.toHaveBeenCalled();
  });

  it('addresses an event from the grant list, not from whoever is listening', () => {
    comExtStore.overview = overview([installation(['events.subscribe'])]);

    expect(comExtStore.pluginsGranting('events.subscribe')).toEqual(['org.example.remember']);
  });

  it('stops delivering to a page that has been unmounted', () => {
    // The host disposes a page's bridge when it unmounts the page. Without that
    // a subscription outlives its panel, and every visit to the screen leaves
    // another live listener acting for a page that is gone.
    const host = createComExtPageHost('org.example.remember');
    const handler = vi.fn();
    host.on('login.succeeded', handler);

    dispatchComExtEvent(['org.example.remember'], 'login.succeeded', { username: 'ada' });
    expect(handler).toHaveBeenCalledTimes(1);

    host.dispose();
    dispatchComExtEvent(['org.example.remember'], 'login.succeeded', { username: 'ada' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('disposes every subscription a page left behind, and none twice', () => {
    const host = createComExtPageHost('org.example.remember');
    const stopped = vi.fn();
    const stillOpen = vi.fn();
    const stop = host.on('login.succeeded', stopped);
    host.on('login.succeeded', stillOpen);

    // A page that unsubscribed on its own must not be unsubscribed again; the
    // ones it left behind must be.
    stop();
    host.dispose();

    dispatchComExtEvent(['org.example.remember'], 'login.succeeded', {});
    expect(stopped).not.toHaveBeenCalled();
    expect(stillOpen).not.toHaveBeenCalled();
  });
});
