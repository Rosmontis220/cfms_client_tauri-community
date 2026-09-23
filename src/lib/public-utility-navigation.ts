// Screens a user can reach from /connect without an account. A community plugin
// page is on this list for the same reason /home/settings is: it is a local
// screen, and the route back to the connection screen must remain offered while
// it is open.
const PUBLIC_UTILITY_ROUTES = ['/home/about', '/home/settings', '/home/com-ext/view'] as const;

export function isPublicUtilityRoute(pathname: string): boolean {
  return PUBLIC_UTILITY_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function shouldOfferConnectionReturn(
  pathname: string,
  connected: boolean,
  isLoggedIn: boolean,
): boolean {
  return !connected && !isLoggedIn && isPublicUtilityRoute(pathname);
}
