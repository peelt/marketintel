import Link from "next/link";
import Image from "next/image";
import type { AgentName } from "@/lib/agents/types";

/**
 * Manifesto-White CLI building blocks (family design language).
 * Server-safe pieces live here; CliTyping (client) is in cli-typing.tsx.
 */

/**
 * The official logo (public/brand/): logomark + investor (cyan #00B5E2) ·
 * logical (deep navy #08325a). Sized by height, w-auto — never squashed
 * (family rule). `size` is the rendered height class.
 */
export function Wordmark({ size = "h-8" }: { size?: string }) {
  return (
    <Image
      src="/brand/investorlogical-logo@2x.png"
      alt="investorlogical"
      width={3200}
      height={711}
      priority
      className={`${size} w-auto`}
    />
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
            <Wordmark size="h-10" />
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
