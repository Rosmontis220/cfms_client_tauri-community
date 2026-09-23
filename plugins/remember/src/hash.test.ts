import { describe, expect, it } from 'vitest';
import { fnv1aHex, storageKeyForServer } from './hash';

describe('plugin storage keys', () => {
  it('produces a key the storage backend accepts', () => {
    // The backend validates keys against `[A-Za-z0-9.\-_:]` and rejects the
    // write otherwise, so an address it cannot spell must still yield a key it
    // can: an IPv6 literal carries brackets, which are not in that alphabet.
    const allowed = /^[A-Za-z0-9.\-_:]{1,128}$/;

    for (const server of [
      '127.0.0.1:1909',
      'example.com:443',
      '[2001:db8::1]:1909',
      'server name with spaces',
      '',
    ]) {
      expect(storageKeyForServer(server), server).toMatch(allowed);
    }
  });

  it('is stable, so a stored account is found again', () => {
    expect(storageKeyForServer('example.com:443')).toBe(storageKeyForServer('example.com:443'));
    expect(storageKeyForServer('  EXAMPLE.com:443 ')).toBe(storageKeyForServer('example.com:443'));
  });

  it('separates servers that differ only in an unusable character', () => {
    // Sanitising the address instead of hashing it would fold these two onto one
    // key, and each server would see the other's accounts.
    expect(storageKeyForServer('a[b')).not.toBe(storageKeyForServer('ab'));
  });

  it('is eight hex digits', () => {
    expect(fnv1aHex('anything')).toMatch(/^[0-9a-f]{8}$/);
  });
});
