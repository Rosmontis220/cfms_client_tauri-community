/**
 * FNV-1a, as 8 hex digits.
 *
 * The plugin's storage backend only accepts keys of `[A-Za-z0-9.\-_:]`, which a
 * server address does not always satisfy — an IPv6 literal carries `[` and `]`.
 * Hashing sidesteps the alphabet entirely instead of sanitising it, and two
 * different servers cannot collide onto the same key by both losing the same
 * forbidden characters.
 *
 * This is a key derivation, not a security measure: the address is not secret
 * and nothing here needs to resist an attacker.
 */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The storage key holding one server's saved accounts. */
export function storageKeyForServer(server: string): string {
  return `accounts.${fnv1aHex(server.trim().toLowerCase())}`;
}
