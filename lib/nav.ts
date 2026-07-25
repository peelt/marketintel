/**
 * Which nav link should read as active for a given path?
 *
 * Pure so it can be unit-tested: the rule has one non-obvious case that's easy
 * to regress — `/dashboard` is a PREFIX of `/dashboard/ops`, so a naive
 * `startsWith` lights up "dashboard" while the user is on Setup, and two nav
 * items look selected at once.
 */
export function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // Only sections WITHOUT nested sibling routes match on prefix. /dashboard has
  // children of its own (/dashboard/ops, /dashboard/diagnostics) that are their
  // own nav entries, so it matches exactly and nothing else.
  if (href === "/dashboard") return false;
  return pathname.startsWith(`${href}/`);
}
