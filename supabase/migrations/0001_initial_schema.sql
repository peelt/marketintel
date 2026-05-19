-- ============================================================
-- marketintel — initial schema
-- PR 1: scaffold the universe, financial snapshots, filings,
-- news, macro indicators, agent runs, reports, evidence and
-- scoring frameworks. No agents wired up yet.
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ------------------------------------------------------------
-- Universe
-- ------------------------------------------------------------

create table public.securities (
    id uuid primary key default gen_random_uuid(),
    ticker text not null,
    exchange text not null,
    name text not null,
    country text,
    asset_class text not null default 'equity'
        check (asset_class in ('equity','etf','royalty','adr','reit','trust')),
    sector text,
    sub_sector text,
    currency text not null default 'USD',
    classifications jsonb not null default '{}'::jsonb,
    -- Free-form tags used by agents to scope their universe quickly
    -- (e.g. 'ipo_2025_11', 'gold_major', 'energy_upstream', 'high_yield').
    tags text[] not null default array[]::text[],
    listed_at date,
    delisted_at date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (ticker, exchange)
);

create index securities_tags_gin on public.securities using gin (tags);
create index securities_sector_idx on public.securities (sector);
create index securities_asset_class_idx on public.securities (asset_class);

-- ------------------------------------------------------------
-- Financial snapshots — per period (quarterly or annual)
-- ------------------------------------------------------------

create table public.financials_snapshot (
    id uuid primary key default gen_random_uuid(),
    security_id uuid not null references public.securities(id) on delete cascade,
    period_end date not null,
    period_type text not null check (period_type in ('q','y','ttm')),
    fiscal_period text,
    -- Income statement
    revenue numeric,
    gross_profit numeric,
    operating_income numeric,
    ebitda numeric,
    net_income numeric,
    eps_diluted numeric,
    -- Balance sheet
    total_assets numeric,
    total_debt numeric,
    cash_and_equivalents numeric,
    shareholders_equity numeric,
    -- Cash flow
    operating_cash_flow numeric,
    capex numeric,
    free_cash_flow numeric,
    dividends_paid numeric,
    -- Valuation snapshot
    market_cap numeric,
    enterprise_value numeric,
    shares_outstanding numeric,
    -- Source attribution
    source text not null,
    source_url text,
    raw jsonb,
    created_at timestamptz not null default now(),
    unique (security_id, period_end, period_type, source)
);

create index financials_security_period_idx
    on public.financials_snapshot (security_id, period_end desc);

-- ------------------------------------------------------------
-- Dividends — ex-date driven
-- ------------------------------------------------------------

create table public.dividends (
    id uuid primary key default gen_random_uuid(),
    security_id uuid not null references public.securities(id) on delete cascade,
    ex_date date not null,
    record_date date,
    pay_date date,
    amount numeric not null,
    currency text not null,
    frequency text check (frequency in ('annual','semi','quarterly','monthly','special')),
    source text not null,
    created_at timestamptz not null default now(),
    unique (security_id, ex_date, amount)
);

create index dividends_security_ex_date_idx
    on public.dividends (security_id, ex_date desc);
create index dividends_ex_date_idx on public.dividends (ex_date);

-- ------------------------------------------------------------
-- Price snapshots — daily close only at this resolution
-- ------------------------------------------------------------

create table public.price_snapshots (
    security_id uuid not null references public.securities(id) on delete cascade,
    snapshot_date date not null,
    open numeric,
    high numeric,
    low numeric,
    close numeric not null,
    adjusted_close numeric,
    volume numeric,
    source text not null,
    primary key (security_id, snapshot_date)
);

-- ------------------------------------------------------------
-- Filings — SEC EDGAR, LSE RNS, Companies House
-- ------------------------------------------------------------

create table public.filings (
    id uuid primary key default gen_random_uuid(),
    security_id uuid references public.securities(id) on delete set null,
    -- Some filings (S-1s) reference issuers not yet in the universe.
    issuer_name text,
    issuer_cik text,
    source text not null check (source in ('sec_edgar','lse_rns','companies_house','other')),
    filing_type text not null,
    filed_at timestamptz not null,
    period_end date,
    url text not null,
    accession_number text,
    raw_text text,
    fetched_at timestamptz not null default now(),
    unique (source, accession_number)
);

create index filings_security_idx on public.filings (security_id, filed_at desc);
create index filings_type_filed_idx on public.filings (filing_type, filed_at desc);

create table public.filing_sections (
    id uuid primary key default gen_random_uuid(),
    filing_id uuid not null references public.filings(id) on delete cascade,
    section_name text not null,
    content text not null,
    embedding vector(1536),
    created_at timestamptz not null default now()
);

create index filing_sections_filing_idx on public.filing_sections (filing_id);
create index filing_sections_embedding_idx
    on public.filing_sections using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- ------------------------------------------------------------
-- News articles
-- ------------------------------------------------------------

create table public.news_articles (
    id uuid primary key default gen_random_uuid(),
    source text not null,
    url text not null,
    title text not null,
    content text,
    summary text,
    published_at timestamptz not null,
    securities uuid[] not null default array[]::uuid[],
    -- Free-form classification, e.g. {"region":"EU","topic":"energy"}.
    tags jsonb not null default '{}'::jsonb,
    -- -1.0 to +1.0; computed at ingest time when supported by the source.
    sentiment numeric,
    fetched_at timestamptz not null default now(),
    unique (source, url)
);

create index news_published_at_idx on public.news_articles (published_at desc);
create index news_securities_gin on public.news_articles using gin (securities);

-- ------------------------------------------------------------
-- Macro indicators — FRED series and similar
-- ------------------------------------------------------------

create table public.macro_indicators (
    series_id text not null,
    source text not null,
    observed_at date not null,
    value numeric not null,
    units text,
    fetched_at timestamptz not null default now(),
    primary key (series_id, source, observed_at)
);

create index macro_indicators_series_idx
    on public.macro_indicators (series_id, observed_at desc);

-- ------------------------------------------------------------
-- Scoring frameworks — versioned, editable from UI
-- ------------------------------------------------------------

create table public.scoring_frameworks (
    id uuid primary key default gen_random_uuid(),
    agent_name text not null,
    version integer not null,
    criteria jsonb not null,
    notes text,
    is_active boolean not null default false,
    created_at timestamptz not null default now(),
    unique (agent_name, version)
);

create index scoring_frameworks_agent_active_idx
    on public.scoring_frameworks (agent_name)
    where is_active;

-- ------------------------------------------------------------
-- Agent runs, reports, ranked items, evidence
-- ------------------------------------------------------------

create table public.agent_runs (
    id uuid primary key default gen_random_uuid(),
    agent_name text not null,
    framework_id uuid references public.scoring_frameworks(id),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    status text not null default 'running'
        check (status in ('running','succeeded','failed','cancelled')),
    error text,
    trigger text not null default 'scheduled'
        check (trigger in ('scheduled','manual','event')),
    input_params jsonb not null default '{}'::jsonb
);

create index agent_runs_agent_started_idx
    on public.agent_runs (agent_name, started_at desc);

create table public.reports (
    id uuid primary key default gen_random_uuid(),
    agent_run_id uuid not null references public.agent_runs(id) on delete cascade,
    agent_name text not null,
    generated_at timestamptz not null default now(),
    summary_markdown text not null,
    body_markdown text not null,
    unique (agent_run_id)
);

create index reports_agent_generated_idx
    on public.reports (agent_name, generated_at desc);

create table public.report_items (
    id uuid primary key default gen_random_uuid(),
    report_id uuid not null references public.reports(id) on delete cascade,
    security_id uuid references public.securities(id) on delete set null,
    rank integer not null,
    composite_score numeric not null,
    scoring_breakdown jsonb not null,
    verdict text,
    -- For agents like Metals where the output is buy/hold/avoid.
    classification text check (classification in ('buy','hold','avoid','watch'))
);

create index report_items_report_rank_idx
    on public.report_items (report_id, rank);
create index report_items_security_idx on public.report_items (security_id);

create table public.evidence (
    id uuid primary key default gen_random_uuid(),
    report_item_id uuid not null references public.report_items(id) on delete cascade,
    evidence_type text not null
        check (evidence_type in (
            'filing_section','financial_snapshot','news_article',
            'macro_indicator','price_snapshot','dividend_record',
            'derived_metric'
        )),
    source_table text not null,
    source_id uuid,
    source_text text not null,
    weight numeric not null check (weight >= 0 and weight <= 1),
    created_at timestamptz not null default now()
);

create index evidence_report_item_idx on public.evidence (report_item_id);

-- ------------------------------------------------------------
-- Follow-up chat — scoped to a report
-- ------------------------------------------------------------

create table public.chat_sessions (
    id uuid primary key default gen_random_uuid(),
    report_id uuid not null references public.reports(id) on delete cascade,
    user_id uuid references auth.users(id) on delete set null,
    started_at timestamptz not null default now()
);

create index chat_sessions_report_idx on public.chat_sessions (report_id);

create table public.chat_messages (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.chat_sessions(id) on delete cascade,
    role text not null check (role in ('user','assistant','system','tool')),
    content text not null,
    evidence_refs jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create index chat_messages_session_idx
    on public.chat_messages (session_id, created_at);

-- ------------------------------------------------------------
-- updated_at trigger
-- ------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger securities_updated_at
    before update on public.securities
    for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Row Level Security
-- Single-user app; the authenticated user can read everything and the
-- service role (used by Inngest jobs) bypasses RLS entirely. We still
-- enable RLS on every table so anon callers get nothing.
-- ------------------------------------------------------------

alter table public.securities enable row level security;
alter table public.financials_snapshot enable row level security;
alter table public.dividends enable row level security;
alter table public.price_snapshots enable row level security;
alter table public.filings enable row level security;
alter table public.filing_sections enable row level security;
alter table public.news_articles enable row level security;
alter table public.macro_indicators enable row level security;
alter table public.scoring_frameworks enable row level security;
alter table public.agent_runs enable row level security;
alter table public.reports enable row level security;
alter table public.report_items enable row level security;
alter table public.evidence enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- Authenticated user can read all reference data.
do $$
declare t text;
begin
  foreach t in array array[
    'securities','financials_snapshot','dividends','price_snapshots',
    'filings','filing_sections','news_articles','macro_indicators',
    'scoring_frameworks','agent_runs','reports','report_items','evidence'
  ]
  loop
    execute format(
      'create policy "auth read" on public.%I for select to authenticated using (true)',
      t
    );
  end loop;
end$$;

-- Authenticated user can edit scoring frameworks (from settings UI).
create policy "auth write frameworks"
    on public.scoring_frameworks
    for all to authenticated
    using (true) with check (true);

-- Chat: the authenticated user can read and write their own sessions.
create policy "own chat sessions r" on public.chat_sessions
    for select to authenticated
    using (user_id = auth.uid() or user_id is null);

create policy "own chat sessions w" on public.chat_sessions
    for insert to authenticated
    with check (user_id = auth.uid());

create policy "own chat messages r" on public.chat_messages
    for select to authenticated
    using (
        exists (
            select 1 from public.chat_sessions s
            where s.id = chat_messages.session_id
              and (s.user_id = auth.uid() or s.user_id is null)
        )
    );

create policy "own chat messages w" on public.chat_messages
    for insert to authenticated
    with check (
        exists (
            select 1 from public.chat_sessions s
            where s.id = chat_messages.session_id
              and s.user_id = auth.uid()
        )
    );
