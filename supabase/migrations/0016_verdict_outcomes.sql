-- ============================================================
-- 0016 — Verdict outcomes: the Reaction scorecard's data
--
-- Grades THE FRAMEWORK, not securities: for every classified reaction
-- report item, the security's forward return at t+1 / t+5 / t+20 trading
-- sessions from the screened close, and the EXCESS of that return over the
-- broad-universe median across the same window (raw forward returns would
-- credit every band with any market-wide bounce).
--
-- Rows are written by the Inngest scorecard job (service role) as each
-- window MATURES — t+20 exists only a month after the verdict. A window
-- that hasn't matured is NULL, and the UI renders it "pending", never 0
-- (missing ≠ zero applies to time too).
--
-- One row per report item; idempotent upserts fill windows as they arrive.
-- ============================================================

create table if not exists public.verdict_outcomes (
    id              uuid primary key default gen_random_uuid(),
    report_item_id  uuid not null unique references public.report_items(id) on delete cascade,
    security_id     uuid not null references public.securities(id),
    agent_name      text not null,
    classification  text not null,
    composite_score numeric,
    -- The close the run screened (latest close <= report generated_at).
    t0_date         date not null,
    t0_close        numeric not null,
    -- Forward returns from t0 over N TRADING sessions (fractional, e.g.
    -- 0.034 = +3.4%), and the same-window broad-universe median.
    r1              numeric,
    r5              numeric,
    r20             numeric,
    universe_r1     numeric,
    universe_r5     numeric,
    universe_r20    numeric,
    computed_at     timestamptz not null default now()
);

comment on table public.verdict_outcomes is
    'Forward-return outcomes per classified reaction verdict — how the framework''s calls resolved, excess-vs-universe. Written by the Inngest scorecard job; windows null until matured.';

create index if not exists verdict_outcomes_agent_class_idx
    on public.verdict_outcomes (agent_name, classification);
create index if not exists verdict_outcomes_t0_idx
    on public.verdict_outcomes (t0_date);

alter table public.verdict_outcomes enable row level security;

-- Derived analysis — same visibility as reports: entitled read, service write.
create policy "entitled read" on public.verdict_outcomes
    for select to authenticated using (public.is_app_user());
