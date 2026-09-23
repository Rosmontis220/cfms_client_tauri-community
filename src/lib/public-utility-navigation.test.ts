import { describe, expect, it } from 'vitest';
import { shouldOfferConnectionReturn } from './public-utility-navigation';

describe('public utility connection recovery', () => {
  it.each([
    '/home/settings',
    '/home/settings/connection',
    '/home/about',
    // A community plugin page is a local screen too: a tool that only computes
    // is useful before sign-in, and the way back to /connect must stay offered
    // while it is open.
    '/home/com-ext/view',
  ])('offers a connection return from %s while signed out and disconnected', (pathname) => {
    expect(shouldOfferConnectionReturn(pathname, false, false)).toBe(true);
  });

  it('does not replace normal session navigation', () => {
    expect(shouldOfferConnectionReturn('/home/settings', true, false)).toBe(false);
    expect(shouldOfferConnectionReturn('/home/settings', false, true)).toBe(false);
    expect(shouldOfferConnectionReturn('/home/files', false, false)).toBe(false);
    expect(shouldOfferConnectionReturn('/home/com-ext/view', true, false)).toBe(false);
    expect(shouldOfferConnectionReturn('/home/com-ext/view', false, true)).toBe(false);
  });
});
