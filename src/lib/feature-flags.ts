/**
 * Extension support remains in the codebase for continued development, but it
 * is intentionally excluded from every user-reachable surface until the
 * extension experience and trust model are ready to ship.
 *
 * TODO(extensions): enable this only after the extension feature is approved
 * for release, then restore coverage for its settings and navigation routes.
 */
export const USER_EXTENSIONS_ENABLED = false;

/**
 * The Community edition's own plugin surface (`com_ext`).
 *
 * This is deliberately a *separate* flag from {@link USER_EXTENSIONS_ENABLED}.
 * The two systems are parallel and independent: the official one loads signed
 * `manifest.json` packages from the upstream catalog, while `com_ext` loads
 * `.cfmscomext` packages written by community members. Neither reads or writes
 * the other's state, so enabling this one leaves the official extension
 * behaviour untouched — including its own shipped-off default.
 */
export const COMMUNITY_EXT_ENABLED = true;
