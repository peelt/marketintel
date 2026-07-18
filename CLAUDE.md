# CLAUDE.md — Investorlogical

Context for Claude Code (and any Claude session) working in this repo. Read this
in full before making changes. **Renamed from "marketintel"** — the product is
part of MXMG's `-logical` family; the GitHub repo is still `peelt/marketintel`
(rename deferred by decision).

Investorlogical is a **glass-box investment-research product**: scheduled
specialist agents file ranked, evidence-backed reports against a scoring
framework the user can see and edit. See the doc set:

| Doc | Owns |
|-----|------|
| `docs/POSITIONING.md` | What we're building and why (market, moats, poles, regulatory posture) |
| `docs/IMPLEMENTATION_PLAN.md` | How and in what order — the sequence a session picks up and follows |
| `docs/SPECIFICATION.md` | Architecture, data model, scoring engine, data sources |
| `docs/DESIGN.md` | House style — the "-logical" family Manifesto-White CLI language + Investorlogical's brand variables (indigo accent). Follow it for ALL UI work. |

**Where we are:** live on investorlogical.com. `main` carries PR 1–5 (Dividend
+ Reaction both filing real reports on live Twelve Data prices), the
verdict-first UX pass, PR 6a+6b (holdings + intel lens), PR 9 (Metals desk
— AISC-aware cost research; framework migrations 0008/0010; Sat 12:00 UTC
cron; classifications well_positioned/mixed/vulnerable from absolute facts;
ETFs excluded), and PR 8 (IPO desk — 30-day S-1/F-1 discovery via EDGAR
full-text search, each prospectus graded by one routine-tier structured call
with NO web search; framework migration 0011; Sun 18:00 UTC cron;
strong/mixed/weak_profile + shell_or_blank_check; issuers as exchange-"IPO"
securities keyed by CIK, excluded from holdings), and PR 10 (Geopolitical
desk — the last desk; a hybrid macro-read memo over a ranked table; one fresh
web-researched macro call per run grounds a routine-tier no-search grade per
name over the `geopolitical_exposed` universe; framework migration 0012; Sun
20:00 UTC cron; beneficiary/mixed/at_risk/insulated from absolute facts,
materiality-gated; uncached for weekly freshness). **All six desks are now
live.** With desk-building complete (no cross-desk score blending — settled),
**email alerts are in** (the deferred 6b piece; provider settled: **Postmark**,
the MXMG family standard — `report/generated` event → `holding-alerts` Inngest
function → intel-lens deltas → Postmark; dedupe via `alert_emails`, migration
0013; fail-soft: alerting never fails a run). **Framework-editing UI is
DROPPED** (Peel: "I don't want to have to do this" — bad labels get structural
fixes, never manual tuning; transparency ≠ editing). A Monthly Brief
(records/catalysts/concentration digest benchmarked against a human
newsletter) is analysed and parked for the marketing era. Remaining roadmap:
London fundamentals decision, on-demand tickers via Inngest, paid gate.

**Intel lens (PR 6b, live):** pure delta engine in `lib/holdings/deltas.ts`
(per-classification concern rank; `computeDelta` → new/worsened/improved/
resolved/steady + `attention` on a fresh flag or worsening; `describeDelta`
stays security-scoped, never advice). `lib/holdings/intel.ts` loads each held
name's latest+previous verdict per desk (90-day window) and diffs them.
Surfaces: a "what changed on your names" feed + portfolio-health roll-up on
`/portfolio`, and an attention-count alert on the dashboard strip. In-app only
for now; the highest-value event (email a holder when a scheduled run flags an
owned name) is the deferred piece above.

**Holdings (PR 6a, live):** `portfolios`/`holdings` tables (migration 0007,
`user_id = auth.uid()` RLS — the first per-user data); `/portfolio` page +
a dashboard summary section; pure valuation in `lib/holdings/valuation.ts`
(GBp-pence trap, base-currency FX via `lib/holdings/fx.ts` → Twelve Data
`/exchange_rate`, missing≠zero). Purchase price is display-only, never scored
(I2). **6a scopes holdings to already-tracked securities** (~900: S&P 500 +
FTSE 350 + curated) — on-demand resolution of untracked tickers would need a
service-role write on a request path, so it's deferred to a follow-up that
routes resolution through Inngest.

---

## How to work here

- **Workflow:** feature branch → PR → Peel reviews/merges via GitHub UI →
  Vercel deploys `main`. Peel has no local terminal; keep PRs self-contained.
- **Gates (CI-enforced):** `npx tsc --noEmit` clean, `next lint` clean,
  `npm test` green. `next.config.ts` sets `ignoreBuildErrors: false` on
  purpose — fix at source, never suppress.
- Work top-to-bottom through `docs/IMPLEMENTATION_PLAN.md`; every PR keeps the
  plan's §1 invariants.

## Conventions (do not drift)

- Strict TypeScript. No `any` escape hatches, no `@ts-ignore`.
- `getErrorMessage()` from `lib/errors.ts` in every `catch`.
- No client-side Supabase mutations or sensitive reads — server actions or
  Inngest jobs only. The service-role client (`lib/supabase/service.ts`) is
  server-only, never on a request-reachable path (Inngest/runAgent only).
- **Evidence-first:** every score persists with the source rows behind it.
  Never ship a scoring path that skips evidence — the chat layer depends on it.
- **Frameworks as data:** scoring frameworks are versioned rows in
  `scoring_frameworks`, editable without redeploy. Reports pin the framework
  version they were scored against; never mutate a historical framework.
- **Impersonal always** (regulatory): score securities, never the user's
  situation. Verdicts read as "the framework's classification + evidence",
  not directives. See POSITIONING §7.
- **Missing ≠ zero:** a null score means "no data" and must never render as 0.
  Coverage (share of framework weight with data) is persisted per candidate.

## Models

- Selection is by **tier**, not hardcoded ID: agents declare
  `modelTier: "routine" | "deep"`; IDs are pinned once in
  `lib/anthropic/client.ts` (`MODELS`) — currently `claude-sonnet-5` /
  `claude-opus-4-8`. A model migration is a one-file change.
- Sonnet 5 gotchas: adaptive thinking is on by default and shares
  `max_tokens` — set `output_config.effort` explicitly and leave headroom;
  non-default sampling params are rejected; use **structured outputs**
  (`output_config.format`), never prose-parsing.
- LLM-calibrated grades feed sub-signals with `normalisation: "absolute"` —
  rank-normalising a calibrated grade destroys the calibration.

## Scoring engine — semantics that matter

- Per-sub-signal `normalisation`: `"rank"` (relative percentile, default),
  `"zscore"`, `"absolute"` (calibrated 0–100 passthrough — comparable across
  reports and time).
- Nulls redistribute weight at BOTH levels (sub-signal within criterion,
  criterion within composite); `coverage` records how much weight had data.
- Evidence weight is the resolver's own 0–1 confidence — never multiplied by
  framework weights.
- Run lifecycle: `runAgent` resolves the framework once, creates the
  `agent_runs` row BEFORE executing, persists report artefacts, marks
  succeeded last. `/reports` filters on `agent_runs.status='succeeded'`.

## Security model

- Authorization is enforced **in the database**: RLS policies check
  `public.is_app_user()` against the `app_users` entitlement table
  (migration 0003). The env-var allowlist (`AUTH_ALLOWED_EMAIL`) is the
  app-layer half; both must agree.
- **Manual Supabase steps that pair with migration 0003:** disable public
  signups (Authentication settings) and seed the owner row in `app_users`.
- `/api/dev/ingest` is POST-only, and in production requires
  `DEV_INGEST_SECRET` via the `x-dev-ingest-secret` header.
- `/api/inngest` fails closed in production without `INNGEST_SIGNING_KEY`.

## Settled product decisions (do not re-litigate; see plan §5)

- Dividend framework weights **25/40/15/20**; `eps_revision_trend` dropped,
  cut-risk rebalanced 0.5/0.5.
- Reaction threshold **5d ≥12% OR 1d ≥8%** (stored as framework data);
  schedule **Tue + Fri 17:00 UTC**.
- **Twelve Data** primary price source. Finnhub's free tier turned out to
  paywall `/stock/candle` for *every* symbol class (US and LSE), and scraped
  Yahoo/Stooq block datacenter IPs (429 / JS proof-of-work) so are dead from
  Vercel — Twelve Data is a keyed REST API that serves US+LSE history from
  datacenter ranges (free tier 8 credits/min, 800/day). Chain is
  Twelve Data → Finnhub → yfinance (`getPriceSource`); Finnhub stays for
  fundamentals (`/stock/metric`) + fallback, yfinance is the floor only.
  Full-universe refresh runs via chunked Inngest, never inline (rate cap).
- Design-for-paid, no billing yet; **sell derived analysis only**; thin
  dashboard from PR 4; Reaction Analyser is the hero pole; Energy deprioritized.
- **Holdings (PR 6):** user-entered positions with *optional* purchase price →
  factual performance snapshot + "My Portfolio" intel lens (the priority).
  Purchase data never feeds scoring; filtering ≠ tailoring. SPECIFICATION §5.1.

## What not to do

- Don't read/write scoring-related tables from the browser. Server only.
- Don't bypass evidence persistence to ship faster.
- Don't personalize verdicts to a user's circumstances (regulatory tripwire).
- Don't hardcode model IDs outside `lib/anthropic/client.ts`.
- Don't introduce a paid data source without checking the framework is
  data-quality-limited rather than design-limited.
- Don't render a null score as zero.

## Secrets / environment

Never commit secrets. `.env.example` is the authoritative variable list —
Supabase (3), `AUTH_ALLOWED_EMAIL`, `ANTHROPIC_API_KEY`, Inngest (2),
`FINNHUB_API_KEY`, `SEC_EDGAR_USER_AGENT`, `FRED_API_KEY`,
`COMPANIES_HOUSE_API_KEY`, `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL`,
`DEV_INGEST_SECRET`. Set in `.env.local`, Vercel, and the Claude Code
environment settings (so agent sessions can run integration checks).
