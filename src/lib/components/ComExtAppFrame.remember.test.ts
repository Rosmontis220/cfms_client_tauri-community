// @vitest-environment jsdom
//
// Drives the real built 记住用户名密码 plugin page through the host's own mount
// path, with a stub bridge standing in for the app.
//
// This is the test that answers "does the remember-me feature work": it reads
// the artifact `pnpm plugin:build remember` produces, mounts it the way the host
// does, and then operates it — arriving with a stored account, ticking the
// boxes, and reporting a successful sign-in. A regression in the page contract,
// the bridge, or the storage rules all land here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { storageKeyForServer } from '../../../plugins/remember/src/hash';

const pluginPage = resolve('plugins/remember/dist/pages/panel.html');
const SERVER = '127.0.0.1:1909';

/** What the stub bridge remembers between mounts, like the host's own store. */
const storage = new Map<string, string>();

/** The sign-in form the stub host is pretending to own. */
interface StubForm {
  username: string;
  password: string;
  server: string;
}

interface StubHost {
  call<T = unknown>(capability: string, args?: Record<string, unknown>): Promise<T>;
  on(event: string, handler: (detail: unknown) => void): () => void;
  /** Report a successful sign-in to every listener, as the host does. */
  reportLogin(detail: { username: string; password: string }): void;
}

/**
 * Mount the built page the way `ComExtAppFrame` mounts a plugin page, with a
 * bridge backed by `storage` and `form`.
 */
function mountPluginPage(html: string, pluginId: string, form: StubForm): { shadow: ShadowRoot; host: StubHost } {
  const element = document.createElement('div');
  document.body.append(element);
  const shadow = element.attachShadow({ mode: 'open' });

  const listeners = new Set<(detail: unknown) => void>();
  const host: StubHost = {
    async call<T>(capability: string, args: Record<string, unknown> = {}) {
      switch (capability) {
        case 'login.form.read':
          return { ...form } as T;
        case 'login.form.fill':
          if (typeof args.username === 'string') form.username = args.username;
          if (typeof args.password === 'string') form.password = args.password;
          return { filled: true } as T;
        case 'storage.read':
          return { value: storage.get(String(args.key)) ?? null } as T;
        case 'storage.write':
          storage.set(String(args.key), String(args.value));
          return { saved: true } as T;
        default:
          throw new Error(`stub bridge does not answer "${capability}"`);
      }
    },
    on(_event, handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    reportLogin(detail) {
      for (const listener of listeners) listener(detail);
    },
  };

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const scripts: string[] = [];
  for (const script of parsed.querySelectorAll('script')) {
    scripts.push(script.textContent ?? '');
    script.remove();
  }

  const fragment = document.createDocumentFragment();
  for (const node of parsed.head.childNodes) fragment.append(node.cloneNode(true));
  for (const node of parsed.body.childNodes) fragment.append(node.cloneNode(true));
  shadow.append(fragment);

  for (const code of scripts) {
    new Function('root', 'pluginId', 'host', code)(shadow, pluginId, host);
  }
  return { shadow, host };
}

/** Let the page's mount sequence finish; it awaits the bridge several times. */
async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

// The artifact is not committed, so `vitest.global-setup.ts` builds it before
// the suite runs. Reading it unconditionally makes a missing build a failure
// rather than a silently skipped — and therefore green — test.
describe('built 记住用户名密码 plugin page', () => {
  const html = readFileSync(pluginPage, 'utf8');
  const key = storageKeyForServer(SERVER);

  beforeEach(() => {
    storage.clear();
    document.body.replaceChildren();
  });

  function freshForm(overrides: Partial<StubForm> = {}): StubForm {
    return { username: '', password: '', server: SERVER, ...overrides };
  }

  it('offers the two checkboxes and no account list when nothing is stored', async () => {
    const form = freshForm();
    const { shadow } = mountPluginPage(html, 'org.cfms.remember', form);
    await settle();

    expect(shadow.querySelector<HTMLInputElement>('[data-role="remember-me"]')).not.toBeNull();
    expect(shadow.querySelector<HTMLInputElement>('[data-role="remember-password"]')).not.toBeNull();
    expect(shadow.querySelector<HTMLElement>('[data-role="accounts"]')?.hidden).toBe(true);
    // Nothing stored means nothing to fill, so the form is left exactly as it was.
    expect(form.username).toBe('');
    expect(form.password).toBe('');
  });

  it('fills the form on arrival with the account it remembered', async () => {
    storage.set(
      key,
      JSON.stringify({
        rememberMe: true,
        rememberPassword: true,
        accounts: [{ username: 'ada', password: 'hunter2', lastUsedAt: 1_700_000_000 }],
      }),
    );
    const form = freshForm();

    const { shadow } = mountPluginPage(html, 'org.cfms.remember', form);
    await settle();

    expect(form.username).toBe('ada');
    expect(form.password).toBe('hunter2');
    expect(shadow.querySelector<HTMLInputElement>('[data-role="remember-me"]')?.checked).toBe(true);
    expect(shadow.querySelector<HTMLInputElement>('[data-role="remember-password"]')?.checked).toBe(true);
  });

  it('does not hand back a password the user chose not to keep', async () => {
    storage.set(
      key,
      JSON.stringify({
        rememberMe: true,
        rememberPassword: false,
        accounts: [{ username: 'ada', password: '', lastUsedAt: 1_700_000_000 }],
      }),
    );
    const form = freshForm();

    mountPluginPage(html, 'org.cfms.remember', form);
    await settle();

    expect(form.username).toBe('ada');
    expect(form.password).toBe('');
  });

  it('saves what was typed once the sign-in succeeds', async () => {
    const form = freshForm({ username: 'ada', password: 'hunter2' });
    const { shadow, host } = mountPluginPage(html, 'org.cfms.remember', form);
    await settle();

    click(shadow, 'remember-me');
    click(shadow, 'remember-password');
    await settle();

    host.reportLogin({ username: 'ada', password: 'hunter2' });
    await settle();

    const stored = JSON.parse(storage.get(key) ?? '{}');
    expect(stored.accounts).toHaveLength(1);
    expect(stored.accounts[0]).toMatchObject({ username: 'ada', password: 'hunter2' });

    // And the chip it draws is usable straight away.
    expect(shadow.querySelector<HTMLElement>('[data-role="accounts"]')?.hidden).toBe(false);
    expect(chipUsernames(shadow)).toEqual(['ada']);
  });

  it('keeps the name but not the password when only 记住我 is ticked', async () => {
    const form = freshForm({ username: 'ada', password: 'hunter2' });
    const { shadow, host } = mountPluginPage(html, 'org.cfms.remember', form);
    await settle();

    click(shadow, 'remember-me');
    await settle();
    host.reportLogin({ username: 'ada', password: 'hunter2' });
    await settle();

    const stored = JSON.parse(storage.get(key) ?? '{}');
    expect(stored.accounts[0]).toMatchObject({ username: 'ada', password: '' });
    // The lock badge exists only when a password was kept.
    expect(shadow.querySelector('[data-role="lock"]')).toBeNull();
  });

  it('forgets the account when the user did not ask to be remembered', async () => {
    storage.set(
      key,
      JSON.stringify({
        rememberMe: true,
        rememberPassword: true,
        accounts: [{ username: 'ada', password: 'hunter2', lastUsedAt: 1_700_000_000 }],
      }),
    );
    const form = freshForm();
    const { shadow, host } = mountPluginPage(html, 'org.cfms.remember', form);
    await settle();

    // Untick, then sign in as that same account.
    click(shadow, 'remember-me');
    await settle();
    host.reportLogin({ username: 'ada', password: 'hunter2' });
    await settle();

    const stored = JSON.parse(storage.get(key) ?? '{}');
    expect(stored.accounts).toEqual([]);
    expect(stored.rememberMe).toBe(false);
    expect(shadow.querySelector<HTMLElement>('[data-role="accounts"]')?.hidden).toBe(true);
  });

  it('refuses to keep a password without a name to attach it to', async () => {
    const form = freshForm();
    const { shadow } = mountPluginPage(html, 'org.cfms.remember', form);
    await settle();

    // 记住密码 is meaningless on its own, so it stays disabled until 记住我 is on.
    expect(shadow.querySelector<HTMLInputElement>('[data-role="remember-password"]')?.disabled).toBe(true);
    click(shadow, 'remember-me');
    await settle();
    expect(shadow.querySelector<HTMLInputElement>('[data-role="remember-password"]')?.disabled).toBe(false);
  });

  it('fills the form from a chip and drops it when removed', async () => {
    storage.set(
      key,
      JSON.stringify({
        rememberMe: true,
        rememberPassword: true,
        accounts: [
          { username: 'ada', password: 'hunter2', lastUsedAt: 1_700_000_002 },
          { username: 'bob', password: 'swordfish', lastUsedAt: 1_700_000_001 },
        ],
      }),
    );
    const form = freshForm();
    const { shadow } = mountPluginPage(html, 'org.cfms.remember', form);
    await settle();

    // Most recently used first, and the newest one is already in the form.
    expect(chipUsernames(shadow)).toEqual(['ada', 'bob']);
    expect(form.username).toBe('ada');

    chip(shadow, 'bob').querySelector<HTMLButtonElement>('[data-action="use"]')?.click();
    await settle();
    expect(form.username).toBe('bob');
    expect(form.password).toBe('swordfish');

    chip(shadow, 'bob').querySelector<HTMLButtonElement>('[data-action="remove"]')?.click();
    await settle();

    expect(chipUsernames(shadow)).toEqual(['ada']);
    const stored = JSON.parse(storage.get(key) ?? '{}');
    expect(stored.accounts.map((account: { username: string }) => account.username)).toEqual(['ada']);
  });

  it('keeps each server’s accounts apart', async () => {
    const otherServer = 'other.example:1909';

    // One server turns remembering on but nobody signs in there.
    const first = mountPluginPage(html, 'org.cfms.remember', freshForm());
    await settle();
    click(first.shadow, 'remember-me');
    await settle();

    // A different server signs in.
    const second = mountPluginPage(html, 'org.cfms.remember', freshForm({ server: otherServer }));
    await settle();
    click(second.shadow, 'remember-me');
    await settle();
    second.host.reportLogin({ username: 'zoe', password: 'pw' });
    await settle();

    expect(accountsAt(storageKeyForServer(otherServer))).toEqual(['zoe']);
    // The first server kept its preference and nothing else: the sign-in that
    // happened elsewhere was never offered to it.
    expect(accountsAt(key)).toEqual([]);
  });

  it('reports a bridge that cannot answer instead of rendering a dead panel', async () => {
    const form = freshForm();
    const element = document.createElement('div');
    document.body.append(element);
    const shadow = element.attachShadow({ mode: 'open' });

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const scripts: string[] = [];
    for (const script of parsed.querySelectorAll('script')) {
      scripts.push(script.textContent ?? '');
      script.remove();
    }
    const fragment = document.createDocumentFragment();
    for (const node of parsed.head.childNodes) fragment.append(node.cloneNode(true));
    for (const node of parsed.body.childNodes) fragment.append(node.cloneNode(true));
    shadow.append(fragment);

    const refusing = {
      call: () => Promise.reject(new Error('denied')),
      on: () => () => {},
    };
    for (const code of scripts) {
      new Function('root', 'pluginId', 'host', code)(shadow, 'org.cfms.remember', refusing);
    }
    await settle();

    const status = shadow.querySelector<HTMLElement>('[data-role="status"]');
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toContain('denied');
  });
});

// -- helpers ---------------------------------------------------------------

function click(shadow: ShadowRoot, role: string) {
  const input = shadow.querySelector<HTMLInputElement>(`[data-role="${role}"]`);
  expect(input, `no control for "${role}"`).not.toBeNull();
  input!.checked = !input!.checked;
  input!.dispatchEvent(new Event('change'));
}

/** The usernames stored for one server key, in stored order. */
function accountsAt(storageKey: string): string[] {
  const raw = storage.get(storageKey);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { accounts?: Array<{ username?: string }> };
  return (parsed.accounts ?? []).map((account) => account.username ?? '');
}

function chipUsernames(shadow: ShadowRoot): string[] {
  return [...shadow.querySelectorAll<HTMLElement>('.remember-chip')].map(
    (node) => node.dataset.username ?? '',
  );
}

function chip(shadow: ShadowRoot, username: string): HTMLElement {
  const node = shadow.querySelector<HTMLElement>(`.remember-chip[data-username="${username}"]`);
  expect(node, `no chip for "${username}"`).not.toBeNull();
  return node!;
}
