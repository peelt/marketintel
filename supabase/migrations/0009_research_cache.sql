-- ============================================================
-- 0009 — Research cache (cost control)
--
-- Web-researched grades (the deep API calls) cached per security. The
-- first consumer is the Metals desk's AISC/cost research: AISC changes
-- QUARTERLY, so re-researching 23 companies every Saturday is pure
-- waste — a ~30-day cache turns the weekly run from ~23 paid research
-- calls into ~0-2. Reaction news grades are deliberately NOT cached
-- (a drop's cause must be researched fresh).
--
-- Server-only table: written and read exclusively by agent runs
-- (service-role client via Inngest). RLS is enabled with NO policies,
-- so the anon/authenticated roles can't touch it at all.
-- ============================================================

create table if not exists public.research_cache (
    id uuid primary key default gen_random_uuid(),
    security_id uuid not null references public.securities (id) on delete cascade,
    -- What kind of research this row caches (e.g. 'metals_cost').
    kind text not null,
    payload jsonb not null,
    graded_at timestamptz not null default now(),
    unique (security_id, kind)
);

create index if not exists research_cache_kind_idx on public.research_cache (kind);

alter table public.research_cache enable row level security;
-- No policies on purpose: service-role only.
