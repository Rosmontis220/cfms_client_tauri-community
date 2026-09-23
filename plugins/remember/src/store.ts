/**
 * The stored shape of "remember me", and every rule that changes it.
 *
 * All of this is pure so it can be tested without a DOM, a host bridge or a
 * backend: what gets kept, for whom, and what happens to the others is the part
 * of this plugin that can actually be wrong.
 */

/** One account this plugin remembers for one server. */
export interface SavedAccount {
  username: string;
  /**
   * The password, or `''` when the user asked to remember the name only.
   *
   * An empty string is the absence of a password, never a valid one, so the UI
   * can show a lock icon purely from whether this is empty.
   */
  password: string;
  /** When this account was last used, for ordering and for "most recent". */
  lastUsedAt: number;
}

/** What is stored for one server. */
export interface RememberedServer {
  /** Whether the user wants accounts remembered at all. */
  rememberMe: boolean;
  /** Whether the user also wants the password itself remembered. */
  rememberPassword: boolean;
  accounts: SavedAccount[];
}

/**
 * How many accounts are kept per server.
 *
 * A sign-in form is not an account manager: the list exists to be scanned, and
 * one that has to be scrolled is already too long. The oldest entries fall off
 * as new ones arrive.
 */
export const MAX_ACCOUNTS_PER_SERVER = 12;

export function emptyRememberedServer(): RememberedServer {
  return { rememberMe: false, rememberPassword: false, accounts: [] };
}

/**
 * Read stored text back into state.
 *
 * Storage hands back whatever was written, possibly by an older version of this
 * plugin or not by this plugin at all, so every field is checked rather than
 * trusted. A shape that does not fit becomes an empty state instead of throwing
 * on the sign-in screen, where a thrown error would be indistinguishable from
 * the app itself being broken.
 */
export function parseRememberedServer(raw: string | null | undefined): RememberedServer {
  if (typeof raw !== 'string' || raw.trim() === '') return emptyRememberedServer();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRememberedServer();
  }

  if (typeof parsed !== 'object' || parsed === null) return emptyRememberedServer();
  const candidate = parsed as Record<string, unknown>;

  const accounts: SavedAccount[] = [];
  for (const entry of Array.isArray(candidate.accounts) ? candidate.accounts : []) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.username !== 'string' || record.username === '') continue;
    accounts.push({
      username: record.username,
      password: typeof record.password === 'string' ? record.password : '',
      lastUsedAt: typeof record.lastUsedAt === 'number' ? record.lastUsedAt : 0,
    });
  }

  return {
    rememberMe: candidate.rememberMe === true,
    // Remembering a password implies remembering the account, so a stored state
    // that says otherwise is a contradiction rather than a preference.
    rememberPassword: candidate.rememberMe === true && candidate.rememberPassword === true,
    accounts: sortByRecency(accounts),
  };
}

export function serializeRememberedServer(state: RememberedServer): string {
  return JSON.stringify({
    rememberMe: state.rememberMe,
    rememberPassword: state.rememberPassword,
    accounts: state.accounts,
  });
}

/** Most recently used first — the order the chips are read in. */
function sortByRecency(accounts: SavedAccount[]): SavedAccount[] {
  return [...accounts].sort((left, right) => right.lastUsedAt - left.lastUsedAt);
}

/** The account most recently used, or `null` when nothing is remembered. */
export function mostRecentAccount(state: RememberedServer): SavedAccount | null {
  return sortByRecency(state.accounts)[0] ?? null;
}

export function findAccount(state: RememberedServer, username: string): SavedAccount | null {
  return state.accounts.find((account) => account.username === username) ?? null;
}

/** Turn one of the two checkboxes on or off. */
export function setPreferences(
  state: RememberedServer,
  preferences: { rememberMe?: boolean; rememberPassword?: boolean },
): RememberedServer {
  const rememberMe = preferences.rememberMe ?? state.rememberMe;
  const rememberPassword = preferences.rememberPassword ?? state.rememberPassword;

  // Clearing "remember me" is the user asking for their account to be
  // forgotten, so the list goes with it rather than lingering invisibly.
  if (!rememberMe) return emptyRememberedServer();

  return { ...state, rememberMe, rememberPassword };
}

export function removeAccount(state: RememberedServer, username: string): RememberedServer {
  const accounts = state.accounts.filter((account) => account.username !== username);
  return { ...state, accounts };
}

/**
 * Record the sign-in that just succeeded.
 *
 * Called with the credentials the server has already accepted, which is the
 * only moment they exist: the app drops them immediately afterwards. When the
 * user asked not to be remembered, the account is actively removed, so unticking
 * the box on the way in also cleans up what an earlier sign-in stored.
 */
export function applyLoginOutcome(
  state: RememberedServer,
  outcome: { username: string; password: string; at: number },
): RememberedServer {
  const username = outcome.username.trim();
  if (username === '') return state;

  if (!state.rememberMe) return removeAccount(state, username);

  const account: SavedAccount = {
    username,
    password: state.rememberPassword ? outcome.password : '',
    lastUsedAt: outcome.at,
  };

  const accounts = sortByRecency([
    account,
    ...state.accounts.filter((entry) => entry.username !== username),
  ]).slice(0, MAX_ACCOUNTS_PER_SERVER);

  return { ...state, accounts };
}

/**
 * What to put in the form on arrival.
 *
 * The password is offered only when both the server's stored preference and the
 * stored entry have one, so a user who unticked "remember password" is not
 * handed a password back the next time they sign in.
 */
export function restoreTarget(state: RememberedServer): { username: string; password: string } | null {
  if (!state.rememberMe) return null;
  const account = mostRecentAccount(state);
  if (!account) return null;
  return {
    username: account.username,
    password: state.rememberPassword ? account.password : '',
  };
}
