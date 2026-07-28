# CLAUDE.md — Investorlogical

Context for Claude Code (and any Claude session) working in this repo. Read this
in full before making changes. **Renamed from "marketintel"** — the product is
part of MXMG's `-logical` family; the GitHub repo is still `peelt/marketintel`
(rename deferred by decision).

Investorlogical is a **glass-box investment-research product**: when a stock
drops hard, an AI desk researches the news that evening and files a ranked,
evidence-backed overshoot verdict against a scoring framework the user can
see. Since the 2026-07 scope reduction the product IS the Reaction Analyser
(plus the holdings watch riding on it) — see "Where we are". Doc set:

| Doc | Owns |
|-----|------|
| `docs/POSITIONING.md` | What we're building and why (market, moats, poles, regulatory posture) |
| `docs/IMPLEMENTATION_PLAN.md` | How and in what order — the sequence a session picks up and follows |
| `docs/SPECIFICATION.md` | Architecture, data model, scoring engine, data sources |
| `docs/DESIGN.md` | House style — the "-logical" family Manifesto-White CLI language + Investorlogical's brand variables (indigo accent). Follow it for ALL UI work. |

**Where we are:** live on investorlogical.com. **2026-07-26 scope reduction
(settled, evidence-grounded — do not re-litigate without new evidence):** the
product is the Reaction Analyser; the weekly specialist desks are **retired**.
A live-data audit of every filed edition found: Reaction's two fundamentals
sub-signals null on 39/39 items in BOTH markets (Finnhub's basic-financials
payload has no absolute debt/EBITDA/OCF figures, so `financials_snapshot`'s
scoring columns were null in 100% of rows ever written); Dividend filing at
64% coverage (US) / 33% (LSE) with all three sustainability ratios null for
every name — strictly weaker than established dividend-safety services; IPO
grading 4 of 25 prospectuses (the rest `insufficient_data` at 0%), with no
holdings tie-in by design; Metals near-uniform 70% with the same dead
balance-sheet columns. Verdict-by-desk: **dividend, metals, ipo retired**
(dividend's re-entry condition: a fundamentals source that completes its
sustainability criterion for a defined universe — the US-listed + UK-ADR
universe was identified as viable); **geopolitical retired as a desk, its
macro read since rebuilt inside Reaction** (see "Macro layer" below — the desk
filed at 100% coverage but had 5/39 names in Reaction's screen and zero
co-filings ever, so as built it was a second product; the backdrop half was
the part intrinsic to Reaction's question, the per-name exposure grading stays
retired). Mechanics of retirement: registry
`status: "retired"`, Inngest functions + weekly fundamentals cron
unregistered, content withdrawn from every surface (reports list/detail,
dashboard, dossier, intel lens, marketing), DB rows and desk code kept —
revival is a status flip + re-registration. **Reaction framework v2**
(migration 0015) drops the two structurally-dead signals — effective weights
unchanged (the engine already redistributed them; every item filed at a
uniform 82%), coverage now reads honestly (100% when the news grade lands).
What remains live: the **Reaction band** (rolling 48h feed + **on-demand
per-ticker analysis**: `tickers` on `agent/run.requested` → scoped run that
keeps the FULL screened cohort for rank-normalisation context and
force-includes the requested name; non-qualifying names get a factual
"doesn't clear the screen" report; on-demand runs never trip the scheduled
same-day dedupe, which filters `trigger='scheduled'`), **holdings +
portfolio valuation** (6a), the **intel lens** (6b, now filtered to live
desks), and **email alerts** (Postmark; `report/generated` →
`holding-alerts` → intel-lens deltas; dedupe via `alert_emails`, migration
0013; fail-soft). **Framework-editing UI is DROPPED** (Peel: "I don't want
to have to do this"). A Monthly Brief is parked for the marketing era.
**The London fundamentals roadmap item is CLOSED** — the audit showed the gap
was cross-market and source-structural, not LSE-specific; with the
fundamentals-dependent desks retired, no live signal needs a fundamentals
feed, so no paid source is warranted. Remaining roadmap: on-demand resolution
of untracked tickers via Inngest, paid gate.

**Macro layer (live, in Reaction):** one web-research call per run
(`lib/agents/reaction/macro.ts`) establishes the themes currently *moving
equity prices*; those themes are injected into every per-name news call, which
additionally attributes the drop — `idiosyncratic` / `macro_amplified` /
`macro_driven` plus the theme. This is the rebuilt half of the retired
Geopolitical desk, reframed: that desk asked "which themes matter" to grade
standing exposure; Reaction asks "what is moving prices" to answer *why did
this name fall*. **Deliberately context, not a signal** — it informs the two
grades the news call already returns (a name that fell with its whole sector on
a policy shock, with nothing new of its own, is the classic overshoot) and adds
no framework weight, so there is no framework v3 and no migration. Design
rules: the read runs AFTER the screen (no drops → no call, so calm days cost
nothing); fail-soft null → names graded exactly as before the layer existed and
attribution recorded as `unattributed`, never as "company-specific"; an echoed
theme is matched back to a real one (`resolveMacroTheme`) so an invented theme
never reaches evidence; attribution rides in the news evidence text and the
report body, not in any score. The report emits the retired desk's `## Macro
read` markdown shape, so `lib/reports/macro-memo.ts` + `components/
macro-read.tsx` render it as theme accordions for free. Next step is an
audit of filed editions (what share attribute, and do macro-driven names'
disproportion grades actually separate) before any surface or weighting
follow-up.

**Intel lens (PR 6b, live):** pure delta engine in `lib/holdings/deltas.ts`
(per-classification concern rank; `computeDelta` → new/worsened/improved/
resolved/steady + `attention` on a fresh flag or worsening; `describeDelta`
stays security-scoped, never advice). `lib/holdings/intel.ts` loads each held
name's latest+previous verdict per LIVE desk (90-day window; retired desks'
verdicts are excluded — they'd link to withdrawn content) and diffs them.
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
- **Every authenticated route lives in `app/(app)/`** and inherits the shell
  (`app/(app)/layout.tsx` → `components/app-nav.tsx`). Pages must NOT render
  their own header — the shell stays mounted across navigations, which is what
  makes nav clicks feel instant. **Every dynamic route needs a `loading.tsx`**
  (skeletons from `components/skeleton.tsx`): without one the App Router blocks
  on the full server render and a click paints nothing at all. Read the session
  via `getSessionContext()` (`lib/auth/session.ts`, React `cache()`-deduped),
  never a second raw `supabase.auth.getUser()` — that's an extra network
  round-trip per component on the critical path.

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
  (migration 0003), which is the **live allowlist**. `AUTH_ALLOWED_EMAIL`
  (comma-separated) is now only the **OWNER list** — admins who can run Setup
  and approve users; it changes rarely. Entitlement = owner OR an `app_users`
  row (`lib/auth/entitlement.ts` `isEntitledEmail`, service-role read); owner
  admin = `lib/auth/allowlist.ts` `isOwnerEmail` (env). **Onboarding is one
  click:** a request-access submission lands in `access_requests`; the owner
  clicks Approve in Setup (`app/dashboard/ops`), which upserts an `app_users`
  row; login is DB-gated and `shouldCreateUser: true`, so the user is
  auto-provisioned in `auth.users` on first magic link — no env change, no
  redeploy, no SQL, no manual Supabase user creation.
- **Manual Supabase steps that pair with migration 0003:** disable public
  signups (Authentication settings) and seed the owner row in `app_users`.
- Public request-access form (login page) writes `access_requests` under the
  ANON role — the table is insert-only by RLS (migration 0014). Honeypot +
  DB-level shape checks; owner notified via Postmark; the owner approves each
  request with one click in Setup (writes `app_users`). Direct Supabase
  signups stay disabled — approval is the only path in.
- `/api/dev/ingest` is POST-only, and in production requires
  `DEV_INGEST_SECRET` via the `x-dev-ingest-secret` header.
- `/api/inngest` fails closed in production without `INNGEST_SIGNING_KEY`.

## Settled product decisions (do not re-litigate; see plan §5)

- **2026-07-26 scope reduction:** the product is the Reaction Analyser.
  Dividend, Metals and IPO desks retired; Geopolitical retired as a desk. The
  bar for a desk is *intrinsic to Reaction*, not merely unique or well-made.
  Rather reduce scope than run a broad-and-patchy information service.
  (Supersedes "weekly desks are the supporting newsroom — kept, never
  demoted".)
- **Macro layer is context, not a signal:** Reaction's macro read (the rebuilt
  half of the Geopolitical desk) informs the news call's existing grades and
  never adds framework weight. Any move to score it is a framework v3 and
  needs the same evidence bar v2 met — filed editions showing macro-driven
  names' grades actually separate. Don't add a sub-signal to "use" the layer.
- Dividend framework weights **25/40/15/20**; `eps_revision_trend` dropped,
  cut-risk rebalanced 0.5/0.5. (Historical — desk retired.)
- Reaction threshold **5d ≥12% OR 1d ≥8%** (stored as framework data);
  schedule **daily on weekdays, post-close** (superseded the original Tue+Fri
  17:00 — a drop is time-sensitive). Data-driven: reaction fires on the
  `ingest/refresh.completed`(prices) event so it runs the moment the evening
  price refresh lands; a weekday 22:00 UTC cron is the backstop; the two
  automatic paths dedupe on a same-day report. On-demand via
  `agent/run.requested` still runs unconditionally.
- **Twelve Data** primary price source. Finnhub's free tier turned out to
  paywall `/stock/candle` for *every* symbol class (US and LSE), and scraped
  Yahoo/Stooq block datacenter IPs (429 / JS proof-of-work) so are dead from
  Vercel — Twelve Data is a keyed REST API that serves US+LSE history from
  datacenter ranges (free tier 8 credits/min, 800/day). Chain is
  Twelve Data → Finnhub → yfinance (`getPriceSource`); Finnhub stays for
  fundamentals (`/stock/metric`) + fallback, yfinance is the floor only.
  Full-universe refresh runs via chunked Inngest, never inline (rate cap).
  **Freshness (audit fix):** the daily price refresh covers broad ∪ all desk
  universes + the GLD benchmark (kept after the desk retirement — curated
  names stay holdable, so their prices must stay fresh); the weekly
  fundamentals+dividends cron is UNREGISTERED (it fed only the retired
  dividend+metals desks); a 10-day price-staleness gate nulls price-dependent
  signals when a refresh has failed (honest low coverage, not a
  stale-but-confident number).
- Design-for-paid, no billing yet; **sell derived analysis only**; thin
  dashboard from PR 4; Reaction Analyser is the hero pole; Energy deprioritized.
- **Holdings (PR 6):** user-entered positions with *optional* purchase price →
  factual performance snapshot + "My Portfolio" intel lens (the priority).
  Purchase data never feeds scoring; filtering ≠ tailoring. SPECIFICATION §5.1.
- **Product hierarchy:** Reaction IS the product (dashboard band + marketing
  hero + on-demand per-ticker analysis); the weekly desks are retired per the
  2026-07-26 scope reduction above. Single-name runs must NEVER be scored
  alone: three of five reaction sub-signals (framework v2) are
  rank-normalised and a cohort of one scores 100 on every rank signal.
- **An overshoot claim presupposes the fall was REAL.** A corporate action in
  an unadjusted price series (split, consolidation, demerger, big special
  dividend) is the framework's maximum-disproportion shape by construction —
  a huge decline against near-zero news damage — so it tops the ranking unless
  it is excluded. The news call returns a structured `corporate_action` flag
  (`none`/`suspected`/`confirmed`); anything but `none` is classified
  `corporate_action`, demoted from ranking, and kept out of the 48h feed and
  desk roll-ups. Suspected counts: if the desk can't say the move was real, it
  can't call it disproportionate — same rule as a missing news grade
  (`cause_unconfirmed`). Live failure that produced this: CGT filed #1 strong
  overshoot at 98.4 on a 10-for-1 split, 27 Jul 2026.

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
