import Link from "next/link";
import type { AgentName } from "@/lib/agents/types";

/**
 * Manifesto-White CLI building blocks (family design language).
 * Server-safe pieces live here; CliTyping (client) is in cli-typing.tsx.
 */

/** investor·logical — Ubuntu Bold two-colour split (navy · brand accent). */
export function Wordmark({ className = "text-2xl" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      <span style={{ color: "#034566" }}>investor</span>
      <span style={{ color: "var(--brand-accent)" }}>logical</span>
    </span>
  );
}

/** Navy terminal title bar with traffic-light dots and a mono title. */
export function CliTitleBar({ title }: { title: string }) {
  return (
    <div className="cli-title-bar rounded-t-[calc(0.5rem-2px)]">
      <div className="traffic-dots">
        <span className="traffic-dot dot-red" />
        <span className="traffic-dot dot-yellow" />
        <span className="traffic-dot dot-green" />
      </div>
      <span>{title}</span>
    </div>
  );
}

/** Orange [*] list marker (mono). */
export function Star() {
  return <span className="font-mono-cli text-il-orange">[*]</span>;
}

/** Muted `~ …` mono eyebrow line (static; use CliTyping for the animated one). */
export function CliEyebrow({ children }: { children: React.ReactNode }) {
  return <div className="font-mono-cli text-sm text-il-navy">~ {children}</div>;
}

/**
 * Shared authed-page header: wordmark home link, guest prompt, section nav.
 */
export function SiteHeader({ active }: { active?: "dashboard" | "reports" | "ops" }) {
  const link = (href: string, key: string, label: string) => (
    <Link
      href={href}
      className={`font-mono-cli text-sm ${
        active === key
          ? "text-il-orange"
          : "text-il-navy hover:text-il-orange"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <header className="border-b-2 border-border bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-baseline gap-4">
          <Link href="/dashboard">
            <Wordmark className="text-xl" />
          </Link>
          <span className="hidden font-mono-cli text-xs text-muted-foreground sm:inline">
            guest@investorlogical:~
          </span>
        </div>
        <nav className="flex items-center gap-5">
          {link("/dashboard", "dashboard", "dashboard")}
          {link("/reports", "reports", "reports")}
          {link("/dashboard/ops", "ops", "ops")}
        </nav>
      </div>
    </header>
  );
}

/**
 * Module accents — one saturated hue per agent pole (brand variable).
 * Used only as card top-stripes, hover borders and small glyphs, never fills.
 */
export const MODULE_COLORS: Record<AgentName, string> = {
  reaction: "#E2282C",
  dividend: "#6DCA9B",
  ipo: "#69C6F6",
  metals: "#E7D149",
  geopolitical: "#B161CF",
  energy: "#2D5AC7",
};
