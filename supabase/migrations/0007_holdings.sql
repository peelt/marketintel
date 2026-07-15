-- ============================================================
-- 0007_holdings.sql — Portfolio holdings (PR 6a)
-- ============================================================
--
-- The first genuinely PER-USER data in the product. Everything before this is
-- shared reference/analysis data gated by public.is_app_user(); holdings add a
-- second gate — user_id = auth.uid() — so one entitled user can never read or
-- write another's positions (forward-looking: the app is single-user today).
--
-- I2 (regulatory) is enforced by SCHEMA SHAPE, not just app code: purchase
-- price/quantity live ONLY on these user-scoped tables and are never joined
-- into scoring. A holder and a non-holder see byte-identical analysis for the
-- same security; the portfolio only *filters* which verdicts reach a user.
--
-- Manual step that pairs with this migration: nothing — RLS + the existing
-- app_users seed cover it. Re-runnable (idempotent guards throughout).

-- ------------------------------------------------------------
-- portfolios — one default per user, schema supports several
-- ------------------------------------------------------------
create table if not exists public.portfolios (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null default 'My Portfolio',
    base_currency text not null default 'GBP',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists portfolios_user_idx on public.portfolios (user_id);

-- ------------------------------------------------------------
-- holdings — one row PER LOT (repeat buys aggregate in the UI)
-- ------------------------------------------------------------
create table if not exists public.holdings (
    id uuid primary key default gen_random_uuid(),
    portfolio_id uuid not null references public.portfolios (id) on delete cascade,
    security_id uuid not null references public.securities (id) on delete restrict,
    quantity numeric not null check (quantity > 0),
    -- Cost basis is OPTIONAL by design: the add flow must never stall on a
    -- missing price, because the intel lens (the real value) works without it.
    purchase_price numeric check (purchase_price is null or purchase_price >= 0),
    purchase_currency text,
    purchase_date date,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists holdings_portfolio_idx on public.holdings (portfolio_id);
create index if not exists holdings_security_idx on public.holdings (security_id);

-- ------------------------------------------------------------
-- updated_at triggers (reuse public.set_updated_at from 0001)
-- ------------------------------------------------------------
drop trigger if exists portfolios_updated_at on public.portfolios;
create trigger portfolios_updated_at
    before update on public.portfolios
    for each row execute function public.set_updated_at();

drop trigger if exists holdings_updated_at on public.holdings;
create trigger holdings_updated_at
    before update on public.holdings
    for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- RLS — entitled AND owner. Mirrors the chat_sessions pattern (0003).
-- ------------------------------------------------------------
alter table public.portfolios enable row level security;
alter table public.holdings enable row level security;

-- portfolios: full CRUD on your own rows only
drop policy if exists "own portfolios r" on public.portfolios;
create policy "own portfolios r" on public.portfolios
    for select to authenticated
    using (public.is_app_user() and user_id = auth.uid());

drop policy if exists "own portfolios i" on public.portfolios;
create policy "own portfolios i" on public.portfolios
    for insert to authenticated
    with check (public.is_app_user() and user_id = auth.uid());

drop policy if exists "own portfolios u" on public.portfolios;
create policy "own portfolios u" on public.portfolios
    for update to authenticated
    using (public.is_app_user() and user_id = auth.uid())
    with check (public.is_app_user() and user_id = auth.uid());

drop policy if exists "own portfolios d" on public.portfolios;
create policy "own portfolios d" on public.portfolios
    for delete to authenticated
    using (public.is_app_user() and user_id = auth.uid());

-- holdings: reachable only through a portfolio you own
drop policy if exists "own holdings r" on public.holdings;
create policy "own holdings r" on public.holdings
    for select to authenticated
    using (
        public.is_app_user()
        and exists (
            select 1 from public.portfolios p
            where p.id = holdings.portfolio_id
              and p.user_id = auth.uid()
        )
    );

drop policy if exists "own holdings i" on public.holdings;
create policy "own holdings i" on public.holdings
    for insert to authenticated
    with check (
        public.is_app_user()
        and exists (
            select 1 from public.portfolios p
            where p.id = holdings.portfolio_id
              and p.user_id = auth.uid()
        )
    );

drop policy if exists "own holdings u" on public.holdings;
create policy "own holdings u" on public.holdings
    for update to authenticated
    using (
        public.is_app_user()
        and exists (
            select 1 from public.portfolios p
            where p.id = holdings.portfolio_id
              and p.user_id = auth.uid()
        )
    )
    with check (
        public.is_app_user()
        and exists (
            select 1 from public.portfolios p
            where p.id = holdings.portfolio_id
              and p.user_id = auth.uid()
        )
    );

drop policy if exists "own holdings d" on public.holdings;
create policy "own holdings d" on public.holdings
    for delete to authenticated
    using (
        public.is_app_user()
        and exists (
            select 1 from public.portfolios p
            where p.id = holdings.portfolio_id
              and p.user_id = auth.uid()
        )
    );
