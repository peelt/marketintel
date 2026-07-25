"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/cli";
import { isNavActive } from "@/lib/nav";
import { signOut } from "@/lib/auth/session-actions";

/**
 * The persistent app nav.
 *
 * Two deliberate behaviours, both about FEEDBACK rather than raw speed:
 *
 *  1. Active state is derived client-side from `usePathname`, so the clicked
 *     link highlights on the click — not after the server responds. Previously
 *     the header was part of each page's server payload, so a click produced
 *     no visible change at all until the whole page had rendered.
 *  2. Each link renders a pending marker driven by `useLinkStatus`, so a
 *     navigation that takes a moment says so. Dynamic pages take real time to
 *     render; silence reads as a broken button.
 *
 * This component lives in the (app) layout, so it stays MOUNTED across
 * navigations inside the group — the shell never blanks and only the content
 * area swaps to a skeleton.
 */

function NavPending() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span
      aria-hidden
      className="ml-1 inline-block animate-pulse font-mono-cli text-il-orange"
    >
      …
    </span>
  ) : null;
}

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = isNavActive(pathname, href);
  return (
    <Link
      href={href}
      className={`font-mono-cli text-base ${
        active ? "text-il-orange" : "text-il-navy hover:text-il-orange"
      }`}
    >
      {label}
      <NavPending />
    </Link>
  );
}

export function AppNav({
  userEmail,
  isOwner = false,
}: {
  userEmail?: string | null;
  isOwner?: boolean;
}) {
  const promptUser = userEmail ? userEmail.split("@")[0] : "guest";
  return (
    <header className="border-b-2 border-border bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center">
            <Wordmark size="h-12" />
          </Link>
          <span className="hidden font-mono-cli text-sm text-muted-foreground md:inline">
            {promptUser}@investorlogical:~
          </span>
        </div>
        <nav className="flex items-center gap-5">
          <NavLink href="/dashboard" label="dashboard" />
          <NavLink href="/portfolio" label="portfolio" />
          <NavLink href="/reports" label="reports" />
          {isOwner && <NavLink href="/dashboard/ops" label="setup" />}
          {userEmail && (
            <>
              <span aria-hidden className="text-border">
                |
              </span>
              <form action={signOut} className="flex">
                <button
                  type="submit"
                  className="font-mono-cli text-base text-muted-foreground hover:text-il-orange"
                >
                  sign out
                </button>
              </form>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
