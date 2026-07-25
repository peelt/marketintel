import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { listAccessRequests } from "@/lib/auth/access-admin";
import { OpsPanel } from "./ops-panel";
import { AccessRequests } from "./access-requests";

export const dynamic = "force-dynamic";
// Ingest steps fan out to external APIs — give the server actions invoked
// from this page room to finish (Finnhub throttles to ~1 req/s).
export const maxDuration = 300;

/**
 * Ops panel — click-through setup and data refresh for non-developers.
 * Buttons run ordered steps via server actions; no secrets or console
 * involved. Same session-based authorization as the rest of the dashboard.
 */
export default async function OpsPage() {
  const supabase = await createClient();
  const { userId, isOwner } = await getSessionContext();
  if (!userId || !isOwner) redirect("/login");

  const accessRequests = await listAccessRequests();

  return (
    <>
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="font-mono-cli text-base text-il-navy">~ one-time setup</div>
        <h1 className="mt-1 text-3xl font-bold text-il-navy">Setup</h1>

        <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Run these top to bottom once, when the product is first stood up.
          After that <strong>everything runs itself</strong> — prices refresh
          every weekday evening and the desks file their reports on schedule.
          Come back here only to re-run a step manually. Each step reports
          exactly what it did, including which tickers failed and why.
        </p>

        <AccessRequests requests={accessRequests} />

        <OpsPanel />
      </main>
    </>
  );
}
