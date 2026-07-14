import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { OpsPanel } from "./ops-panel";
import { SiteHeader } from "@/components/cli";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) redirect("/login");

  return (
    <>
      <SiteHeader active="ops" />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="font-mono-cli text-sm text-il-navy">~ setup &amp; data refresh</div>
        <h1 className="mt-1 text-3xl font-bold text-il-navy">Ops</h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Run these top to bottom on first setup. After that, re-run individual
          steps whenever you want fresh data. Each step reports exactly what it
          did — including which tickers failed and why.
        </p>

        <OpsPanel />
      </main>
    </>
  );
}
