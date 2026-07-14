-- ============================================================
-- 0004 — Data layer integrity (plan §3.5b)
--
--   1. price_snapshots.currency — GBp vs USD is a latent 100× error
--   2. dividends dedupe: (security_id, ex_date), amount out of the key
--   3. filings dedupe: accession_number always populated (URL fallback)
--   4. evidence.redistributable — the I3 derived-vs-raw boundary in schema
-- ============================================================

-- ------------------------------------------------------------
-- 1. Currency on price snapshots
-- ------------------------------------------------------------
-- Stored AS REPORTED by the provider (LSE arrives in pence as "GBp").
-- Nullable: pre-0004 rows have no recorded currency and guessing one here
-- would launder uncertainty into fake precision. Consumers must treat null
-- as "unknown — re-ingest before converting".

alter table public.price_snapshots
    add column if not exists currency text;

comment on column public.price_snapshots.currency is
    'Provider-reported currency, verbatim (e.g. USD, GBp = pence). Null = ingested before 0004; re-ingest before any cross-currency arithmetic.';

-- ------------------------------------------------------------
-- 2. Dividends: dedupe on (security_id, ex_date)
-- ------------------------------------------------------------
-- The old key included amount, so the same dividend re-reported with amount
-- jitter (rounding, adjusted vs declared, source switch) inserted duplicate
-- rows and inflated every payout-history signal. One row per security per
-- ex-date; the most recently ingested amount wins.

delete from public.dividends a
using public.dividends b
where a.security_id = b.security_id
  and a.ex_date = b.ex_date
  and a.id <> b.id
  and (a.created_at, a.id) < (b.created_at, b.id);

alter table public.dividends
    drop constraint if exists dividends_security_id_ex_date_amount_key;

alter table public.dividends
    add constraint dividends_security_id_ex_date_key
    unique (security_id, ex_date);

-- ------------------------------------------------------------
-- 3. Filings: a real dedupe key for every source
-- ------------------------------------------------------------
-- unique (source, accession_number) never fired for RNS/Companies House rows
-- because their accession_number was null and Postgres treats nulls as
-- distinct — every refresh re-inserted the whole feed. The URL is the stable
-- per-item identity for sources without accession numbers; ingest now always
-- supplies it, and the column becomes not-null so the constraint is honest.

update public.filings
set accession_number = url
where accession_number is null;

delete from public.filings a
using public.filings b
where a.source = b.source
  and a.accession_number = b.accession_number
  and a.id <> b.id
  and (a.fetched_at, a.id) < (b.fetched_at, b.id);

alter table public.filings
    alter column accession_number set not null;

comment on column public.filings.accession_number is
    'Dedupe identity: EDGAR accession number where one exists, otherwise the canonical document URL.';

-- ------------------------------------------------------------
-- 4. Evidence: the redistributable-vs-owner-only boundary (I3)
-- ------------------------------------------------------------
-- Derived analysis (our scores, summaries, computed metrics) may be exposed
-- or sold; raw third-party values are owner-only. Default false = owner-only,
-- so anything that forgets to set the flag fails safe.

alter table public.evidence
    add column if not exists redistributable boolean not null default false;

update public.evidence
set redistributable = true
where evidence_type = 'derived_metric';

comment on column public.evidence.redistributable is
    'I3 boundary: true = derived analysis safe to expose beyond the owner; false = raw third-party value, owner-only. Defaults false (fail safe).';
