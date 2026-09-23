import { describe, expect, it } from 'vitest';
import {
  applyLoginOutcome,
  emptyRememberedServer,
  MAX_ACCOUNTS_PER_SERVER,
  mostRecentAccount,
  parseRememberedServer,
  removeAccount,
  restoreTarget,
  serializeRememberedServer,
  setPreferences,
} from './store';

describe('remembered-account state', () => {
  it('treats storage it cannot read as nothing remembered', () => {
    // Storage hands back whatever was written, possibly by an older version of
    // this plugin or by something else entirely. Throwing here would surface on
    // the sign-in screen as an app that does not work.
    expect(parseRememberedServer(null)).toEqual(emptyRememberedServer());
    expect(parseRememberedServer('')).toEqual(emptyRememberedServer());
    expect(parseRememberedServer('not json')).toEqual(emptyRememberedServer());
    expect(parseRememberedServer('[]')).toEqual(emptyRememberedServer());
    expect(parseRememberedServer('{"accounts":"nope"}')).toEqual(emptyRememberedServer());
  });

  it('keeps the entries it can read and drops the ones it cannot', () => {
    const state = parseRememberedServer(
      JSON.stringify({
        rememberMe: true,
        rememberPassword: true,
        accounts: [
          { username: 'ada', password: 'hunter2', lastUsedAt: 2 },
          { username: '', password: 'ignored', lastUsedAt: 3 },
          { password: 'no name', lastUsedAt: 4 },
          'not an object',
        ],
      }),
    );

    expect(state.accounts).toEqual([{ username: 'ada', password: 'hunter2', lastUsedAt: 2 }]);
  });

  it('refuses a stored state that keeps a password without keeping the account', () => {
    // A contradiction rather than a preference, so the account wins.
    const state = parseRememberedServer(
      JSON.stringify({ rememberMe: false, rememberPassword: true, accounts: [] }),
    );

    expect(state.rememberMe).toBe(false);
    expect(state.rememberPassword).toBe(false);
  });

  it('round-trips through storage', () => {
    const state = setPreferences(emptyRememberedServer(), {
      rememberMe: true,
      rememberPassword: true,
    });
    const saved = applyLoginOutcome(state, { username: 'ada', password: 'hunter2', at: 7 });

    expect(parseRememberedServer(serializeRememberedServer(saved))).toEqual(saved);
  });

  it('keeps the password only when the user asked for it', () => {
    const named = applyLoginOutcome(
      setPreferences(emptyRememberedServer(), { rememberMe: true }),
      { username: 'ada', password: 'hunter2', at: 7 },
    );
    expect(named.accounts[0].password).toBe('');

    const both = applyLoginOutcome(
      setPreferences(emptyRememberedServer(), { rememberMe: true, rememberPassword: true }),
      { username: 'ada', password: 'hunter2', at: 7 },
    );
    expect(both.accounts[0].password).toBe('hunter2');
  });

  it('forgets an account whose sign-in was not to be remembered', () => {
    // Storage can hold accounts while the preference is off — a state written
    // by an older version of this plugin, or edited by hand — and signing in
    // that way has to clean it up rather than leave it behind. Unticking the
    // box in the UI reaches the same place by a shorter route, because clearing
    // the preference already drops the list.
    const state = parseRememberedServer(
      JSON.stringify({
        rememberMe: false,
        accounts: [{ username: 'ada', password: 'hunter2', lastUsedAt: 1 }],
      }),
    );
    expect(state.accounts).toHaveLength(1);

    const forgotten = applyLoginOutcome(state, { username: 'ada', password: 'hunter2', at: 8 });

    expect(forgotten.accounts).toEqual([]);
  });

  it('replaces an account rather than storing it twice', () => {
    const once = applyLoginOutcome(
      setPreferences(emptyRememberedServer(), { rememberMe: true, rememberPassword: true }),
      { username: 'ada', password: 'old', at: 1 },
    );
    const twice = applyLoginOutcome(once, { username: 'ada', password: 'new', at: 2 });

    expect(twice.accounts).toEqual([{ username: 'ada', password: 'new', lastUsedAt: 2 }]);
  });

  it('orders by most recent use', () => {
    let state = setPreferences(emptyRememberedServer(), { rememberMe: true });
    state = applyLoginOutcome(state, { username: 'ada', password: '', at: 1 });
    state = applyLoginOutcome(state, { username: 'bob', password: '', at: 2 });

    expect(state.accounts.map((account) => account.username)).toEqual(['bob', 'ada']);
    expect(mostRecentAccount(state)?.username).toBe('bob');
  });

  it('drops the oldest accounts once the list is full', () => {
    let state = setPreferences(emptyRememberedServer(), { rememberMe: true });
    for (let index = 0; index < MAX_ACCOUNTS_PER_SERVER + 3; index += 1) {
      state = applyLoginOutcome(state, { username: `user${index}`, password: '', at: index });
    }

    expect(state.accounts).toHaveLength(MAX_ACCOUNTS_PER_SERVER);
    // The newest survived; the oldest three fell off.
    expect(state.accounts[0].username).toBe(`user${MAX_ACCOUNTS_PER_SERVER + 2}`);
    expect(state.accounts.map((account) => account.username)).not.toContain('user0');
  });

  it('ignores a sign-in with no username to attach it to', () => {
    const state = setPreferences(emptyRememberedServer(), { rememberMe: true });
    expect(applyLoginOutcome(state, { username: '   ', password: 'x', at: 1 })).toEqual(state);
  });

  it('clears the list when remembering is turned off', () => {
    const remembered = applyLoginOutcome(
      setPreferences(emptyRememberedServer(), { rememberMe: true, rememberPassword: true }),
      { username: 'ada', password: 'hunter2', at: 1 },
    );
    const cleared = setPreferences(remembered, { rememberMe: false });

    // Turning the feature off is the user asking to be forgotten, so the
    // accounts go with it instead of lingering invisibly.
    expect(cleared).toEqual(emptyRememberedServer());
  });

  it('removes one account by name', () => {
    let state = setPreferences(emptyRememberedServer(), { rememberMe: true });
    state = applyLoginOutcome(state, { username: 'ada', password: '', at: 1 });
    state = applyLoginOutcome(state, { username: 'bob', password: '', at: 2 });

    expect(removeAccount(state, 'ada').accounts.map((account) => account.username)).toEqual(['bob']);
    expect(removeAccount(state, 'nobody').accounts).toHaveLength(2);
  });

  it('offers a password back only when the user kept passwords', () => {
    const named = applyLoginOutcome(
      setPreferences(emptyRememberedServer(), { rememberMe: true }),
      { username: 'ada', password: 'hunter2', at: 1 },
    );
    expect(restoreTarget(named)).toEqual({ username: 'ada', password: '' });

    const both = applyLoginOutcome(
      setPreferences(emptyRememberedServer(), { rememberMe: true, rememberPassword: true }),
      { username: 'ada', password: 'hunter2', at: 1 },
    );
    expect(restoreTarget(both)).toEqual({ username: 'ada', password: 'hunter2' });
  });

  it('offers nothing when remembering is off', () => {
    expect(restoreTarget(emptyRememberedServer())).toBeNull();
  });
});
