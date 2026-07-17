"use client";

import { useState } from "react";
import Link from "next/link";
import { runOpsTask } from "./actions";

/**
 * Click-through ops steps. Each button invokes a server action and renders a
 * plain-English summary of the result — raw JSON stays behind a disclosure
 * for the curious.
 */

interface StepDef {
  task: string;
  title: string;
  description: string;
  eta: string;
}

const STEPS: StepDef[] = [
  {
    task: "status",
    title: "Check data sources",
    description:
      "Confirms which providers are configured and which one is serving prices.",
    eta: "a few seconds",
  },
  {
    task: "seed-universe",
    title: "Load the security universe",
    description:
      "Fills the securities table from the curated dividend, metals and energy lists. Safe to re-run.",
    eta: "~10 seconds",
  },
  {
    task: "prices",
    title: "Fetch price history",
    description: "About a year of daily prices for every seeded name.",
    eta: "1–3 minutes",
  },
  {
    task: "dividends",
    title: "Fetch dividend history",
    description: "Five years of dividend payments per name.",
    eta: "1–3 minutes",
  },
  {
    task: "fundamentals",
    title: "Fetch fundamentals",
    description:
      "Trailing-twelve-month financials (cash flow, debt, payout) per name.",
    eta: "1–3 minutes",
  },
  {
    task: "run-dividend",
    title: "Run the Dividend agent",
    description:
      "Scores the universe against the framework and files the first evidence-backed report.",
    eta: "~30 seconds",
  },
  {
    task: "seed-broad-universe",
    title: "Load the broad market (Reaction)",
    description:
      "Adds the S&P 500 and FTSE 350 to the screening universe for the Reaction Analyser.",
    eta: "~30 seconds",
  },
  {
    task: "broad-prices",
    title: "Fetch broad-market prices (Reaction)",
    description:
      "Queues the big price fetch through the background job system (Inngest). Watch it finish in the Inngest dashboard before running the Reaction Analyser.",
    eta: "queued; ~5–10 minutes in background",
  },
  {
    task: "run-reaction",
    title: "Run the Reaction Analyser",
    description:
      "Screens for sharp drops, researches the news behind each, and files overshoot verdicts with cited sources.",
    eta: "2-5 minutes",
  },
  {
    task: "run-metals",
    title: "Run the Precious Metals desk",
    description:
      "Researches each producer's cost position (AISC vs the metal price) and files position verdicts with cited sources.",
    eta: "3-6 minutes",
  },
];

type StepState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; result: unknown }
  | { phase: "error"; message: string };

export function OpsPanel() {
  const [states, setStates] = useState<Record<string, StepState>>({});

  async function run(task: string) {
    setStates((s) => ({ ...s, [task]: { phase: "running" } }));
    try {
      const response = await runOpsTask(task);
      setStates((s) => ({
        ...s,
        [task]: response.ok
          ? { phase: "done", result: response.result }
          : { phase: "error", message: response.error ?? "unknown error" },
      }));
    } catch (err) {
      setStates((s) => ({
        ...s,
        [task]: {
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  }

  return (
    <div className="mt-8 space-y-3">
      {STEPS.map((step, index) => {
        const state = states[step.task] ?? { phase: "idle" };
        return (
          <section key={step.task} className="card-cli px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-base font-bold text-il-navy">
                  <span className="font-mono-cli text-il-orange">
                    [{index + 1}]
                  </span>{" "}
                  {step.title}
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {step.description}{" "}
                  <span className="whitespace-nowrap">Takes {step.eta}.</span>
                </div>
              </div>
              <button
                onClick={() => run(step.task)}
                disabled={state.phase === "running"}
                className="btn-cli btn-cli-sm shrink-0"
              >
                {state.phase === "running"
                  ? "running…"
                  : state.phase === "done"
                    ? "run again"
                    : "run"}
              </button>
            </div>

            {state.phase === "running" && (
              <p className="mt-2 font-mono-cli text-sm text-muted-foreground">
                ~ working — leave this tab open; longer steps take a few
                minutes <span className="cursor-blink" />
              </p>
            )}
            {state.phase === "error" && (
              <p
                className="mt-2 border-l-2 py-1 pl-3 font-mono-cli text-sm"
                style={{ borderColor: "#EE1D23", color: "#EE1D23" }}
              >
                ~ failed: {state.message}
              </p>
            )}
            {state.phase === "done" && (
              <ResultSummary task={step.task} result={state.result} />
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------- friendly result rendering ----------

function ResultSummary({ task, result }: { task: string; result: unknown }) {
  const r = (result ?? {}) as Record<string, unknown>;
  const report = r.report as
    | { attempted?: number; succeeded?: number; failed?: number }
    | undefined;
  // A run that fetched nothing is a failure, not a success with a green tick.
  const attempted = report?.attempted ?? 0;
  const succeeded = report?.succeeded ?? 0;
  const failed = report?.failed ?? 0;
  const outcome: "ok" | "partial" | "failed" =
    attempted > 0 && succeeded === 0
      ? "failed"
      : failed > 0
        ? "partial"
        : "ok";
  const tone =
    outcome === "failed"
      ? { border: "#EE1D23", glyph: "✗", glyphColor: "#EE1D23" }
      : outcome === "partial"
        ? { border: "#F6881C", glyph: "△", glyphColor: "#F6881C" }
        : { border: "#22a87b", glyph: "✓", glyphColor: "#22a87b" };
  return (
    <div className="mt-2 space-y-2">
      <p
        className="border-l-2 py-1 pl-3 text-sm"
        style={{ borderColor: tone.border, color: "#1a1a1a" }}
      >
        <span style={{ color: tone.glyphColor }}>{tone.glyph}</span>{" "}
        {outcome === "failed" ? "Nothing was fetched. " : ""}
        {summarise(task, r)}
      </p>
      <FailureList result={r} />
      {(task === "run-dividend" || task === "run-reaction" || task === "run-metals") && typeof r.reportId === "string" && (
        <p className="text-sm">
          <Link href="/reports" className="font-mono-cli text-il-accent hover:text-il-orange">
            ~ open the report →
          </Link>
        </p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-mono-cli">~ raw details</summary>
        <pre className="bg-il-tint mt-1 max-h-64 overflow-auto rounded border border-border p-2 font-mono-cli text-[10px] leading-relaxed">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function summarise(task: string, r: Record<string, unknown>): string {
  if (task === "status") {
    const ready = Array.isArray(r.ready) ? (r.ready as string[]) : [];
    const pricePrimary = typeof r.pricePrimary === "string" ? r.pricePrimary : "";
    const lseNote = pricePrimary.startsWith("twelvedata")
      ? "Price primary: Twelve Data — US + LSE (LSE needs the Grow plan)."
      : pricePrimary.startsWith("finnhub")
        ? "Price primary: Finnhub — US only (its tier has no LSE candles). Add a Twelve Data key for London."
        : "No price primary configured — add TWELVEDATA_API_KEY. (yfinance is a fallback only and blocks datacenter IPs.)";
    const stubbed = Array.isArray(r.stubbed)
      ? (r.stubbed as { reason?: string }[])
      : [];
    const missingKeys = [
      ...new Set(
        stubbed
          .map((x) => /^([A-Z0-9_]+) not set$/.exec(x.reason ?? "")?.[1])
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    const missingNote = missingKeys.length
      ? ` Missing keys (add in Vercel → Settings → Environment Variables, then redeploy): ${missingKeys.join(", ")}.`
      : "";
    return `Ready data sources: ${ready.join(", ") || "none"}. ${lseNote}${missingNote}`;
  }
  if (task === "seed-universe") {
    const untagged = num(r.untagged);
    return `Universe loaded: ${num(r.inserted)} new securities, ${num(r.updated)} updated.${untagged > 0 ? ` ${untagged} removed from curated watchlists.` : ""}`;
  }
  if (
    (task === "run-dividend" || task === "run-reaction" || task === "run-metals") &&
    typeof r.queued !== "number"
  ) {
    return "Report filed successfully.";
  }
  if (task === "seed-broad-universe") {
    return `Broad market loaded: ${num(r.fetched)} constituents fetched — ${num(r.inserted)} new, ${num(r.tagged)} already tracked.`;
  }
  if (task === "broad-prices") {
    return `Queued a background price fetch for ${num(r.queued)} names. ${typeof r.note === "string" ? r.note : ""}`;
  }
  // prices/dividends/fundamentals queue to Inngest on a slow (free-tier) plan.
  if (typeof r.queued === "number" && typeof r.note === "string") {
    return `Queued a background fetch for ${num(r.queued)} names. ${r.note}`;
  }
  const report = r.report as
    | { attempted?: number; succeeded?: number; failed?: number }
    | undefined;
  const base = `Pulled ${num(r.pulled)} rows; saved ${num(r.inserted)}.`;
  if (report && num(report.failed) > 0) {
    return `${base} ${num(report.succeeded)}/${num(report.attempted)} names succeeded — ${num(report.failed)} failed (details below).`;
  }
  if (report) {
    return `${base} All ${num(report.attempted)} names succeeded.`;
  }
  return base;
}

function FailureList({ result }: { result: Record<string, unknown> }) {
  const report = result.report as
    | {
        failures?: { ticker?: string; kind?: string; reason?: string }[];
        fallbacks?: { ticker?: string }[];
      }
    | undefined;
  const failures = report?.failures ?? [];
  const fallbackCount = report?.fallbacks?.length ?? 0;
  if (failures.length === 0 && fallbackCount === 0) return null;
  return (
    <div className="text-sm text-muted-foreground">
      {fallbackCount > 0 && (
        <p>
          {fallbackCount} request(s) fell back from the primary source to a
          backup provider — details in the raw JSON below.
        </p>
      )}
      {failures.length > 0 && (
        <ul className="mt-1 list-inside list-disc">
          {failures.slice(0, 10).map((f, i) => (
            <li key={i}>
              <span className="font-mono">{f.ticker ?? "?"}</span> — {f.kind}
            </li>
          ))}
          {failures.length > 10 && <li>…and {failures.length - 10} more.</li>}
        </ul>
      )}
    </div>
  );
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
