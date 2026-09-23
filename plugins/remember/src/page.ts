/**
 * 记住用户名密码 — the plugin's behaviour.
 *
 * The host hands a page three things: its own shadow root, its plugin id, and a
 * bridge. Everything this plugin does goes through the bridge, because it is
 * the only sanctioned way to reach the sign-in form: the form is component
 * state in the host, so no backend command can answer for it, and reaching into
 * the host's document for the fields would be reading state this plugin was
 * never given.
 *
 * The division of labour is deliberate. The host owns the form and decides who
 * may touch it, through two capabilities the user approves when enabling the
 * plugin. This plugin owns everything the user sees and every rule about what
 * is kept — which accounts, for which server, and when they are dropped — so
 * the feature can be installed, disabled and uninstalled without the app
 * carrying any of it.
 */

import { storageKeyForServer } from './hash';
import { t } from './labels';
import {
  applyLoginOutcome,
  emptyRememberedServer,
  parseRememberedServer,
  removeAccount,
  restoreTarget,
  serializeRememberedServer,
  setPreferences,
  type RememberedServer,
  type SavedAccount,
} from './store';

/** The bridge the host passes to a plugin page. */
interface PluginHost {
  readonly pluginId: string;
  call<T = unknown>(capability: string, args?: Record<string, unknown>): Promise<T>;
  on(event: string, handler: (detail: unknown) => void): () => void;
}

const READ_FORM = 'login.form.read';
const FILL_FORM = 'login.form.fill';
const READ_STORAGE = 'storage.read';
const WRITE_STORAGE = 'storage.write';

/** The event the host sends when the server has accepted a sign-in. */
const LOGIN_SUCCEEDED = 'login.succeeded';

const mountedRoots = new WeakSet<ShadowRoot>();

/**
 * Build the panel inside `root`.
 *
 * Idempotent, like every plugin page: the host evaluates this bundle as the
 * body of a function that already has `root` in scope, and some hosts also call
 * `ComExtPlugin.mount(...)`, so both paths can arrive here.
 */
export function mount(root: ShadowRoot, pluginId: string, host: PluginHost): void {
  if (mountedRoots.has(root)) return;
  mountedRoots.add(root);
  void start(root, host, pluginId);
}

/** The credentials a successful sign-in carries. */
interface SignIn {
  username: string;
  password: string;
}

/**
 * Read a `login.succeeded` payload, or `null` when it names no account.
 *
 * The detail arrives from the host over a window event, so it is checked rather
 * than trusted: a sign-in with nothing to attach it to is not worth recording.
 */
function readSignIn(detail: unknown): SignIn | null {
  const payload = (detail ?? {}) as { username?: unknown; password?: unknown };
  const username = typeof payload.username === 'string' ? payload.username : '';
  if (username === '') return null;
  return {
    username,
    password: typeof payload.password === 'string' ? payload.password : '',
  };
}

interface Panel {
  accounts: HTMLElement;
  accountsLabel: HTMLElement;
  chips: HTMLElement;
  options: HTMLElement;
  rememberMe: HTMLInputElement;
  rememberMeLabel: HTMLElement;
  rememberPassword: HTMLInputElement;
  rememberPasswordLabel: HTMLElement;
  status: HTMLElement;
}

function query<T extends Element>(root: ShadowRoot, role: string): T | null {
  return root.querySelector<T>(`[data-role="${role}"]`);
}

function collect(root: ShadowRoot): Panel | null {
  const panel: Panel = {
    accounts: query(root, 'accounts') as HTMLElement,
    accountsLabel: query(root, 'accounts-label') as HTMLElement,
    chips: query(root, 'chips') as HTMLElement,
    options: query(root, 'options') as HTMLElement,
    rememberMe: query(root, 'remember-me') as HTMLInputElement,
    rememberMeLabel: query(root, 'remember-me-label') as HTMLElement,
    rememberPassword: query(root, 'remember-password') as HTMLInputElement,
    rememberPasswordLabel: query(root, 'remember-password-label') as HTMLElement,
    status: query(root, 'status') as HTMLElement,
  };
  return Object.values(panel).every((node) => node instanceof Element) ? panel : null;
}

async function start(root: ShadowRoot, host: PluginHost, pluginId: string): Promise<void> {
  const panel = collect(root);
  if (!panel) return;

  // The two checkboxes are one decision about this account, so they are one
  // named group rather than two loose controls inside the host's form.
  panel.options.setAttribute('aria-label', t('title'));
  panel.accountsLabel.textContent = t('savedAccounts');
  panel.rememberMeLabel.textContent = t('rememberMe');
  panel.rememberPasswordLabel.textContent = t('rememberPassword');
  if (root.host instanceof HTMLElement) root.host.dataset.pluginId = pluginId;

  let server = '';
  let state: RememberedServer = emptyRememberedServer();
  /** Whether the saved accounts have been read yet. */
  let loaded = false;
  /** A sign-in that arrived while they were still loading. */
  let early: SignIn | null = null;

  const persist = async () => {
    await host.call(WRITE_STORAGE, {
      key: storageKeyForServer(server),
      value: serializeRememberedServer(state),
    });
  };

  function render() {
    panel.rememberMe.checked = state.rememberMe;
    panel.rememberPassword.checked = state.rememberPassword;
    panel.rememberPassword.disabled = !state.rememberMe;

    panel.accounts.hidden = state.accounts.length === 0;
    panel.chips.replaceChildren(
      ...state.accounts.map((account) => chip(account, useAccount, forgetAccount)),
    );
  }

  function chip(
    account: SavedAccount,
    onUse: (account: SavedAccount) => void,
    onRemove: (account: SavedAccount) => void,
  ): HTMLElement {
    const row = document.createElement('span');
    row.className = 'remember-chip';
    row.dataset.username = account.username;

    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'remember-chip__use';
    use.dataset.action = 'use';
    use.title = t('useAccount', { username: account.username });
    use.setAttribute('aria-label', use.title);
    use.append(document.createTextNode(account.username));
    if (account.password !== '') {
      const lock = document.createElement('span');
      lock.className = 'remember-chip__lock';
      lock.dataset.role = 'lock';
      lock.title = t('savedPassword');
      lock.setAttribute('aria-label', t('savedPassword'));
      use.append(lock);
    }
    use.addEventListener('click', () => onUse(account));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remember-chip__remove';
    remove.dataset.action = 'remove';
    remove.textContent = '×';
    remove.title = t('removeAccount', { username: account.username });
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => onRemove(account));

    row.append(use, remove);
    return row;
  }

  /** Fill the host's sign-in form, leaving the password alone when there is none. */
  async function fill(account: SavedAccount, includePassword: boolean) {
    const args: Record<string, unknown> = { username: account.username };
    if (includePassword && account.password !== '') args.password = account.password;
    await host.call(FILL_FORM, args);
  }

  async function useAccount(account: SavedAccount) {
    await fill(account, true);
  }

  async function forgetAccount(account: SavedAccount) {
    state = removeAccount(state, account.username);
    render();
    await persist();
  }

  panel.rememberMe.addEventListener('change', () => {
    state = setPreferences(state, { rememberMe: panel.rememberMe.checked });
    render();
    void persist();
  });

  panel.rememberPassword.addEventListener('change', () => {
    state = setPreferences(state, { rememberPassword: panel.rememberPassword.checked });
    render();
    void persist();
  });

  /** Record the sign-in that just succeeded. */
  function record(signIn: SignIn) {
    state = applyLoginOutcome(state, { ...signIn, at: Date.now() });
    render();
    // The page is about to be unmounted by the navigation that follows a
    // successful sign-in, so this write is started and not awaited: the call is
    // already in flight, and the host answers it independently of this page.
    void persist();
  }

  // The listener goes up before the first await, because the host does not
  // replay an event to a page that was not listening yet and the sign-in this
  // plugin exists for happens exactly once. A sign-in that arrives while the
  // saved accounts are still loading is held instead of written, because the
  // storage key it belongs under is not known until then.
  host.on(LOGIN_SUCCEEDED, (detail) => {
    const signIn = readSignIn(detail);
    if (!signIn) return;
    if (!loaded) {
      early = signIn;
      return;
    }
    record(signIn);
  });

  try {
    const form = await host.call<{ server?: unknown }>(READ_FORM, {});
    server = typeof form?.server === 'string' ? form.server : '';
    state = parseRememberedServer(await readStorage(host, storageKeyForServer(server)));
  } catch (error) {
    showFailure(panel, error);
    return;
  }
  loaded = true;

  // Arriving at the form with a remembered account is the whole point, so the
  // restore happens before anything else can take the user's attention.
  const target = restoreTarget(state);
  if (target) {
    try {
      await host.call(FILL_FORM, {
        username: target.username,
        ...(target.password !== '' ? { password: target.password } : {}),
      });
    } catch {
      // A form that could not be pre-filled is still a form the user can type
      // into; the checkboxes below stay usable either way.
    }
  }

  render();

  const held = early;
  early = null;
  if (held) record(held);
}

async function readStorage(host: PluginHost, key: string): Promise<string | null> {
  const result = await host.call<{ value?: unknown }>(READ_STORAGE, { key });
  return typeof result?.value === 'string' ? result.value : null;
}

function showFailure(panel: Panel, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  panel.status.hidden = false;
  panel.status.textContent = t('failed', { reason });
  panel.accounts.hidden = true;
  panel.rememberMe.disabled = true;
  panel.rememberPassword.disabled = true;
}

// The host evaluates this bundle as the body of `new Function('root',
// 'pluginId', 'host', code)`, which leaves all three names in scope as free
// variables. Some hosts also append `ComExtPlugin.mount(root, pluginId, host)`
// to that body; `mount` is idempotent, so both shapes end in one panel.
declare const root: ShadowRoot | undefined;
declare const pluginId: string | undefined;
declare const host: PluginHost | undefined;

if (
  typeof root !== 'undefined' &&
  root !== null &&
  typeof root.querySelector === 'function' &&
  typeof host !== 'undefined' &&
  host !== null &&
  typeof host.call === 'function'
) {
  mount(root, typeof pluginId === 'string' ? pluginId : 'org.cfms.remember', host);
}
