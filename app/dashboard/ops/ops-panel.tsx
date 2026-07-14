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
      "Confirms which providers are configured, and probes whether Finnhub's free tier covers the London Stock Exchange.",
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
      "Queues the big price fetch through the background job system (Inngest must be connected). Runs in the background — no need to wait here.",
    eta: "queued; ~30-60 min in background",
  },
  {
    task: "run-reaction",
    title: "Run the Reaction Analyser",
    description:
      "Screens for sharp drops, researches the news behind each, and files overshoot verdicts with cited sources.",
    eta: "2-5 minutes",
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
          <section
            key={step.task}
            className="rounded-md border border-border bg-card px-4 py-3"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">
                  {index + 1} · {step.title}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {step.description}{" "}
                  <span className="whitespace-nowrap">Takes {step.eta}.</span>
                </div>
              </div>
              <button
                onClick={() => run(step.task)}
                disabled={state.phase === "running"}
                className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-50"
              >
                {state.phase === "running"
                  ? "Running…"
                  : state.phase === "done"
                    ? "Run again"
                    : "Run"}
              </button>
            </div>

            {state.phase === "running" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Working — leave this tab open. Longer steps can take a few
                minutes.
              </p>
            )}
            {state.phase === "error" && (
              <p className="mt-2 rounded bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                Failed: {state.message}
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
  return (
    <div className="mt-2 space-y-2">
      <p className="rounded bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        {summarise(task, r)}
      </p>
      <FailureList result={r} />
      {(task === "run-dividend" || task === "run-reaction") && typeof r.reportId === "string" && (
        <p className="text-xs">
          <Link href="/reports" className="text-accent hover:underline">
            Open the report →
          </Link>
        </p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Raw details</summary>
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted/30 p-2 text-[10px] leading-relaxed">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function summarise(task: string, r: Record<string, unknown>): string {
  if (task === "status") {
    const ready = Array.isArray(r.ready) ? (r.ready as string[]) : [];
    const lse = r.finnhubLseCoverage as
      | { covered: boolean; reason?: string }
      | undefined;
    const lseNote = lse?.covered
      ? "Finnhub covers the LSE — primary source confirmed."
      : `Finnhub LSE coverage not confirmed (${lse?.reason ?? "unknown"}) — UK names will use the Yahoo fallback, which is fine.`;
    return `Ready data sources: ${ready.join(", ") || "none"}. ${lseNote}`;
  }
  if (task === "seed-universe") {
    return `Universe loaded: ${num(r.inserted)} new securities, ${num(r.updated)} updated.`;
  }
  if (task === "run-dividend" || task === "run-reaction") {
    return "Report filed successfully.";
  }
  if (task === "seed-broad-universe") {
    return `Broad market loaded: ${num(r.fetched)} constituents fetched — ${num(r.inserted)} new, ${num(r.tagged)} already tracked.`;
  }
  if (task === "broad-prices") {
    return `Queued a background price fetch for ${num(r.queued)} names. ${typeof r.note === "string" ? r.note : ""}`;
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
    <div className="text-xs text-muted-foreground">
      {fallbackCount > 0 && (
        <p>
          {fallbackCount} request(s) fell back from the primary source to
          Yahoo — expected on free-tier limits.
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
