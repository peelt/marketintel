import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { Disclaimer } from "@/components/disclaimer";
import { loadEditionIndex } from "@/lib/reports/edition-index";
import { latestEdition } from "@/lib/reports/editions";
import { ReportEdition } from "./report-edition";

export const dynamic = "force-dynamic";

/**
 * Reports opens ON the latest daily edition — not on a list with the edition
 * one click further in. This used to be an index: a "latest edition" card
 * that was only a link, above rows of near-identical clipped sentences. What
 * a reader comes here for is today's edition, so that is what the page is;
 * every other date is one step away in the navigator (reports layout).
 *
 * "Latest" means the latest DAILY edition: an on-demand single-name run or a
 * manual re-run files a report row too, and must not take the page over
 * (see buildEditionIndex).
 */
export default async function ReportsPage() {
  const { userId } = await getSessionContext();
  if (!userId) redirect("/login");

  // Shared with the layout's navigator — one read per request (cache()).
  const { indexes, primaryDesk } = await loadEditionIndex();
  const latest = primaryDesk ? latestEdition(indexes[primaryDesk]) : null;

  if (!latest) {
    return (
      <main>
        <div className="font-mono-cli text-base text-il-navy">~ filed by the desk</div>
        <h1 className="mt-1 text-3xl font-bold text-il-navy">Reports</h1>
        <p className="mt-6 max-w-3xl text-base leading-relaxed text-muted-foreground">
          No edition filed yet. The desk files automatically after each
          session&apos;s closing prices land; the first one can also be kicked
          off from Setup.
        </p>
        <Disclaimer />
      </main>
    );
  }

  return <ReportEdition reportId={latest.id} />;
}
