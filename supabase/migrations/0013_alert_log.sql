-- ============================================================
-- 0013 — Alert email log (email alerts, the deferred 6b piece)
--
-- One row per (report, user) email actually attempted — the dedupe
-- guard that makes alert delivery idempotent: Inngest retries a
-- failed function run, and without this a retry after a successful
-- send would email the holder twice. Insert-first with a unique
-- constraint; only the run that wins the insert sends.
--
-- Service-role only: RLS enabled with NO policies (same posture as
-- research_cache) — this is plumbing, not user data surface.
-- ============================================================

create table public.alert_emails (
    id uuid primary key default gen_random_uuid(),
    report_id uuid not null references public.reports(id) on delete cascade,
    user_id uuid not null,
    item_count int not null,
    sent_at timestamptz not null default now(),
    unique (report_id, user_id)
);

alter table public.alert_emails enable row level security;
-- No policies: anon/authenticated cannot touch it; the service role bypasses.
