"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  requestDropAnalysis,
  type DropAnalysisState,
} from "@/app/dashboard/actions";

const INITIAL: DropAnalysisState = { status: "idle", message: "" };

/**
 * The hero interaction on the Reaction band: name a ticker, get it screened
 * now. Feedback stays in the mono voice of the rest of the desk; runs are
 * queued (Inngest), so the message sets the "report files in minutes"
 * expectation rather than pretending to be instant.
 */
export function ReactionAnalyseForm() {
  const [state, formAction, pending] = useActionState(
    requestDropAnalysis,
    INITIAL,
  );

  return (
    <div>
      <div className="font-mono-cli text-base text-il-navy">~ analyse a drop</div>
      <p className="mt-2 text-base leading-relaxed text-muted-foreground">
        Name a ticker and the desk screens it now. A qualifying fall gets the
        full treatment — news researched, damage graded, verdict filed with
        every source cited.
      </p>
      <form action={formAction} className="mt-3 flex gap-2">
        <input
          name="ticker"
          className="input-cli min-w-0 flex-1"
          placeholder="e.g. NVDA or NXT.L"
          maxLength={12}
          required
          aria-label="Ticker to analyse"
          disabled={pending}
        />
        <button type="submit" className="btn-cli" disabled={pending}>
          {pending ? "queuing…" : "analyse"}
        </button>
      </form>
      {state.status !== "idle" && (
        <p
          className="mt-2 font-mono-cli text-sm"
          style={{ color: state.status === "error" ? "#ee1d23" : undefined }}
          role="status"
        >
          {state.message}
          {state.reportId && (
            <>
              {" "}
              <Link
                href={`/reports/${state.reportId}`}
                className="text-il-accent"
              >
                open report →
              </Link>
            </>
          )}
        </p>
      )}
      <p className="mt-3 font-mono-cli text-xs text-muted-foreground">
        ~ screens the latest closes — a fall happening mid-session files after
        tonight&apos;s close
      </p>
    </div>
  );
}
