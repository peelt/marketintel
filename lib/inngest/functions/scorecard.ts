import { inngest } from "../client";
import { computeVerdictOutcomes } from "@/lib/scorecard/outcomes";

/**
 * Verdict scorecard — matures reaction outcomes as fresh closes land.
 *
 * Runs after the evening price refresh (the same data-ready event that fires
 * the reaction desk — the two are independent consumers), with a weekday cron
 * backstop later in the evening. Each run re-computes outcomes for verdicts
 * still inside the t+20 maturation window and upserts idempotently, so a
 * missed evening self-heals on the next one.
 */
export const verdictScorecard = inngest.createFunction(
  { id: "verdict-scorecard", retries: 1, concurrency: { limit: 1 } },
  [
    { event: "ingest/refresh.completed", if: "event.data.feed == 'prices'" },
    { cron: "30 22 * * 1-5" }, // backstop: weekdays 22:30 UTC, after reaction
  ],
  async ({ step }) => {
    const result = await step.run("compute-verdict-outcomes", () =>
      computeVerdictOutcomes(),
    );
    return result;
  },
);
