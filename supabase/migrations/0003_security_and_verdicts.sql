-- ------------------------------------------------------------
-- 0003 — Security floor + verdict plumbing (PR 3.5a)
--
-- Fixes the critical finding from the July 2026 audit: RLS previously granted
-- EVERY authenticated principal full read of all research tables and full
-- write on scoring_frameworks (`using (true)`), while the email allowlist
-- lived only in app code. Anyone who obtained a session directly against the
-- Supabase Auth endpoint (public anon key + signInWithOtp to their own inbox)
-- bypassed the allowlist entirely.
--
-- After this migration, authorization is enforced IN THE DATABASE via an
-- entitlement table. This is also the seam where paid subscriptions plug in
-- later (add a status/plan column; the policies don't change).
--
-- ⚠️ MANUAL STEPS THAT MUST ACCOMPANY THIS MIGRATION (Supabase dashboard):
--   1. Authentication → Sign In / Up → disable "Allow new users to sign up".
--   2. Seed the owner:  insert into public.app_users (email) values ('<owner-email>');
--      (Must match AUTH_ALLOWED_EMAIL. Without this row, the owner can log in
--      but will read zero rows.)
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Entitlements
-- ------------------------------------------------------------

create table public.app_users (
    email text primary key check (email = lower(email)),
    role text not null default 'owner' check (role in ('owner')),
    created_at timestamptz not null default now()
);

alter table public.app_users enable row level security;
-- No policies: not readable or writable by anon/authenticated. Service role
-- (dashboard / server) manages membership; is_app_user() reads it via
-- SECURITY DEFINER.

create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_app_user() from public;
grant execute on function public.is_app_user() to authenticated;

-- ------------------------------------------------------------
-- Replace the blanket read policies
-- ------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'securities','financials_snapshot','dividends','price_snapshots',
    'filings','filing_sections','news_articles','macro_indicators',
    'scoring_frameworks','agent_runs','reports','report_items','evidence'
  ]
  loop
    execute format('drop policy if exists "auth read" on public.%I', t);
    execute format(
      'create policy "entitled read" on public.%I for select to authenticated using (public.is_app_user())',
      t
    );
  end loop;
end$$;

-- Framework writes: entitled users only (was: any authenticated user).
drop policy if exists "auth write frameworks" on public.scoring_frameworks;
create policy "entitled write frameworks"
    on public.scoring_frameworks
    for all to authenticated
    using (public.is_app_user())
    with check (public.is_app_user());

-- Chat: drop the `user_id is null` allowance — sessions must belong to their
-- creator, and only entitled users participate.
drop policy if exists "own chat sessions r" on public.chat_sessions;
create policy "own chat sessions r" on public.chat_sessions
    for select to authenticated
    using (public.is_app_user() and user_id = auth.uid());

drop policy if exists "own chat sessions w" on public.chat_sessions;
create policy "own chat sessions w" on public.chat_sessions
    for insert to authenticated
    with check (public.is_app_user() and user_id = auth.uid());

drop policy if exists "own chat messages r" on public.chat_messages;
create policy "own chat messages r" on public.chat_messages
    for select to authenticated
    using (
        public.is_app_user()
        and exists (
            select 1 from public.chat_sessions s
            where s.id = chat_messages.session_id
              and s.user_id = auth.uid()
        )
    );

drop policy if exists "own chat messages w" on public.chat_messages;
create policy "own chat messages w" on public.chat_messages
    for insert to authenticated
    with check (
        public.is_app_user()
        and exists (
            select 1 from public.chat_sessions s
            where s.id = chat_messages.session_id
              and s.user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- Verdict plumbing + integrity
-- ------------------------------------------------------------

-- The Reaction Analyser needs its own vocabulary (STRONG_OVERSHOOT /
-- MILD_OVERSHOOT / PROPORTIONATE / UNDERREACTION); per-agent vocabularies are
-- validated at the app layer where the agent lives.
alter table public.report_items
    drop constraint if exists report_items_classification_check;

-- Evidence rows are matched to items by (report_id, rank) during persistence —
-- make that join safe against double-inserts.
alter table public.report_items
    add constraint report_items_report_rank_unique unique (report_id, rank);

-- The reports list orders by generated_at with no agent filter; the existing
-- (agent_name, generated_at) composite can't serve that.
create index reports_generated_idx on public.reports (generated_at desc);

-- scoring_frameworks is UI-editable: record when rows change.
alter table public.scoring_frameworks
    add column updated_at timestamptz not null default now();

create trigger scoring_frameworks_updated_at
    before update on public.scoring_frameworks
    for each row execute function public.set_updated_at();
