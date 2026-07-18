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
  return <div className="font-mono-cli text-base text-il-navy">~ {children}</div>;
}

/**
 * Shared authed-page header: wordmark home link, guest prompt, section nav.
 */
export function SiteHeader({
  active,
}: {
  active?: "dashboard" | "reports" | "ops" | "portfolio";
}) {
  const link = (href: string, key: string, label: string) => (
    <Link
      href={href}
      className={`font-mono-cli text-base ${
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
          <span className="hidden font-mono-cli text-sm text-muted-foreground sm:inline">
            guest@investorlogical:~
          </span>
        </div>
        <nav className="flex items-center gap-5">
          {link("/dashboard", "dashboard", "dashboard")}
          {link("/portfolio", "portfolio", "portfolio")}
          {link("/reports", "reports", "reports")}
          {link("/dashboard/ops", "ops", "setup")}
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

/**
 * Classification vocabulary → chip colour. Tinted background + coloured text
 * (never a solid fill — family rule). Unknown values fall back to neutral so
 * a new agent vocabulary degrades gracefully instead of crashing the page.
 */
const CLASSIFICATION_COLORS: Record<string, string> = {
  // dividend vocabulary
  resilient: "#22a87b",
  watch: "#f6881c",
  elevated_cut_risk: "#ee1d23",
  // reaction vocabulary
  strong_overshoot: "#e2282c",
  mild_overshoot: "#f6881c",
  proportionate: "#034566",
  underreaction: "#6b7280",
  cause_unconfirmed: "#6b7280",
  // metals vocabulary
  well_positioned: "#22a87b",
  mixed: "#f6881c",
  vulnerable: "#ee1d23",
  // ipo vocabulary
  strong_profile: "#22a87b",
  mixed_profile: "#f6881c",
  weak_profile: "#ee1d23",
  shell_or_blank_check: "#6b7280",
  // geopolitical vocabulary
  beneficiary: "#22a87b",
  at_risk: "#ee1d23",
  insulated: "#034566",
  // shared (mixed reused by metals + geopolitical)
  insufficient_data: "#9ca3af",
};

/**
 * Coloured classification pill ("elevated cut risk", "resilient", …) — THE
 * traffic-light component, used identically wherever a classification
 * appears (reports, dashboard, portfolio, feeds). The leading dot makes the
 * colour legible even at a glance or with impaired colour vision.
 */
export function ClassificationChip({ classification }: { classification: string }) {
  const color = CLASSIFICATION_COLORS[classification] ?? "#6b7280";
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono-cli text-sm"
      style={{ color, backgroundColor: `${color}1a` }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {classification.replace(/_/g, " ")}
    </span>
  );
}

/**
 * Coverage as a small bar + number — "how much of the framework had data for
 * this name". A bar reads instantly where a naked percentage doesn't.
 */
export function CoverageBar({ coverage }: { coverage: number }) {
  const pct = Math.round(coverage * 100);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-2 w-16 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: pct >= 65 ? "#22a87b" : pct >= 35 ? "#f6881c" : "#9ca3af",
          }}
        />
      </span>
      <span className="font-mono-cli text-sm text-muted-foreground">{pct}%</span>
    </span>
  );
}
