import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { getSessionContext } from "@/lib/auth/session";

/**
 * The authenticated app shell.
 *
 * Every page in this group used to render its own <SiteHeader>, which meant
 * the header was part of each page's SERVER payload: clicking a nav link
 * produced nothing on screen until the whole next page — slowest query
 * included — had rendered. Hoisting the nav into a shared layout keeps it
 * MOUNTED across navigations inside the group, so a click swaps only the
 * content area (to that route's loading.tsx skeleton) while the shell stays
 * put and the clicked link highlights immediately.
 *
 * The auth read here is deduped with the pages' own via React cache() (see
 * lib/auth/session.ts), so the shell costs no extra round-trip. Pages keep
 * their own entitlement checks — RLS is the real boundary either way.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { email, entitled, isOwner } = await getSessionContext();
  if (!entitled) redirect("/login");

  return (
    <>
      <AppNav userEmail={email} isOwner={isOwner} />
      {children}
    </>
  );
}
