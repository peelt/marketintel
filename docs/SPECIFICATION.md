# Investorlogical — Technical Specification

**Version:** 2.1
**Status:** PR 1–3 merged to `main`; PR 3.5a (foundation hardening) applied.
Owns *architecture, data model, scoring semantics, data sources*. For what
we're building and why, see `docs/POSITIONING.md`; for sequence and per-PR
scope, `docs/IMPLEMENTATION_PLAN.md` (authoritative build order).

---

## 1. Purpose

A research tool that runs scheduled "research agents", each producing a ranked
report backed by the evidence it was scored on. It is a **research aid that
surfaces candidates worth a closer look — not a signal generator and not an
advice engine.** Every score is persisted with the cited source rows behind
it, so a follow-up chat can defend or interrogate any ranking without
inventing fresh facts.

Built by Peel (MXMG Ltd), working entirely through Claude + the GitHub UI, no
local terminal. Feature branches → PR → Vercel auto-deploy on merge.

### Design goals
- **Evidence-first.** No score exists without the rows that produced it.
- **Glass-box.** The scoring framework is visible and user-editable;
  versioned; old reports pin the version that scored them.
- **Free-tier-first, derived-output-only.** Prove the frameworks on free data;
  the product's sellable output is our own derived analysis (scores,
  rankings, evidence summaries), never redistributed raw third-party data.
- **Impersonal.** Securities are scored; the user's situation never is
  (regulatory posture — POSITIONING §7).
- **Single user today, paid-ready by design.** Identity-aware RLS and the
  entitlement seam exist now; billing/multi-tenant UI deliberately do not.

---

## 2. Research poles

Six poles, ranked by defensibility in POSITIONING §6. The **Reaction
Analyser is the hero**; Dividend is the credibility pole; Energy is
deprioritized.

| # | Pole | Job | Cadence (UTC) | Tier |
|---|------|-----|---------------|------|
| 1 | **Reaction Analyser** *(hero)* | Finds sharp drops and judges overshoot vs earned fundamental damage | Tue + Fri 17:00 *(settled)* | deep |
| 2 | **Dividend Intelligence** | High-yield names with sustainability + cut-probability flagging | Fri 18:00 | routine |
| 3 | **IPO Evaluation** | League table of upcoming IPOs | Sun 18:00 | deep |
| 4 | **Precious Metals** | Buy/hold/avoid across ETFs, royalties, majors, juniors | Sat 12:00 | routine |
| 5 | **Geopolitical Scanner** | Macro/geopolitical memo with confidence levels | Sun 20:00 | deep |
| 6 | **Energy Beneficiaries** *(deprioritized)* | Sector exposure ranking | Sat 10:00 | routine |

### 2.1 Reaction Analyser (detail)

The only pole that **discovers** a universe rather than ranking a fixed one:
screens ~500–800 names (S&P 500 + FTSE 350) for large recent drawdowns, then
scores how much of the drop looks like sentiment overshoot versus earned
fundamental damage.

**Settled parameters:** inclusion threshold **5d drawdown ≥12% OR 1d drop
≥8%**, stored as framework data (editable without redeploy); schedule
**Tue + Fri 17:00 UTC**.

**Honest framing:** large drops mean-revert *in aggregate*, but a meaningful
fraction are value traps. The framework weights fundamental damage heavily so
a genuinely-earned drop scores as *proportionate*. Output is a shortlist to
investigate, never a buy signal.

**Framework sketch — `reaction` v1** (composite = "degree of overshoot"):

| Criterion | Weight | Sub-signals |
|-----------|-------:|-------------|
| Drop magnitude | 15% | 1d return vs 60d vol (40%); 5d drawdown vs 90d max-DD (60%) |
| Fundamental damage | 30% | guidance-change flag (35%); latest EPS surprise (25%); TTM FCF trajectory (20%); debt/EBITDA delta (20%) |
| News sentiment intensity | 20% | LLM-graded headline emotion vs impact (60%, `absolute`); negative-article volume vs significance (40%) |
| Historical recovery | 15% | median 30d return after past >10% drops (60%); recovery hit-rate (40%) |
| Sector context | 10% | drop vs sector peers same window |
| Management/structural | 10% | C-suite turnover flag (50%); pivot/guidance-withdrawal flag (50%) |

**Verdict bands** (via the `classify` hook → `report_items.verdict`):
STRONG_OVERSHOOT (>75), MILD_OVERSHOOT (60–75), PROPORTIONATE (40–60),
UNDERREACTION (<40).

---

## 3. Architecture

```
Scheduled trigger (Inngest cron)
        │
        ▼
  runAgent(agent)                                  [lib/agents/run.ts]
        ├─ resolve framework ONCE (pin id — no mid-run version race)
        ├─ create agent_runs row (status=running)  ← BEFORE execution
        ├─ agent.run(input)                        [BaseAgent lifecycle]
        │      ├─ collectCandidates()   (per-agent universe)
        │      ├─ getResolver()          (source_query → value + evidence;
        │      │                          batch path for large universes)
        │      ├─ scoreCandidates()      (engine: normalise, weight, aggregate)
        │      ├─ classify()             (optional verdict/classification hook)
        │      └─ composeReport()        (markdown body)
        ├─ persistReport(runId)  ──►  reports + report_items + evidence
        │                             (orphans cleaned up on partial failure)
        └─ mark run succeeded LAST
        │
        ▼
  /reports UI (filtered to succeeded runs)  ──►  [PR 10] evidence-scoped chat
```

**Key contracts:**
- `Agent` (`lib/agents/types.ts`) — every pole implements `meta` + `run()`.
- `BaseAgent` (`lib/agents/base.ts`) — shared lifecycle; concrete agents
  override `collectCandidates` / `getResolver` / `composeReport`, optionally
  `classify`.
- `SignalResolverRegistry` (`lib/scoring/types.ts`) — `resolve` (one
  candidate) and optional `resolveBatch` (all candidates, one round-trip —
  required in practice for Reaction's universe).
- Scoring engine (`lib/scoring/engine.ts`) — pure aggregation, no LLM calls.
  Qualitative scoring is `scoreWithLlm()` plugged in through a resolver.

**Boundaries that must hold:**
- Service-role Supabase client: Inngest jobs / `runAgent` only. Never on a
  request-reachable path, never in the browser.
- No client-side Supabase mutations or sensitive reads.

---

## 4. Technology stack

| Layer | Current | Notes |
|-------|---------|-------|
| Framework | Next.js 15.5.x | 15.x EOL 21 Oct 2026 — plan the 16.x bump while the codebase is small |
| Models | tier-indirected: `routine` → `claude-sonnet-5`, `deep` → `claude-opus-4-8` | Pinned once in `lib/anthropic/client.ts`; agents declare tiers |
| Anthropic SDK | `^0.111` | Structured outputs (`output_config.format`) in use; no prose-parsing |
| LLM batch | Anthropic Batch API | 3.5c — for Reaction's LLM fan-out |
| News (Geo/Reaction) | native `web_search` / `web_fetch` server tools | PR 5+; RSS kept only where structured feeds help |
| Price/fundamentals | **Finnhub primary** (settled, provisional) · yfinance fallback | `PriceSource` interface since 3.5b; yfinance fundamentals revived via cookie+crumb |
| Auth/DB | Supabase (magic link, Postgres, RLS, pgvector) | RLS entitlement-gated since migration 0003 |
| Scheduling | Inngest | Fails closed in prod without signing key. Do NOT replace with the Agent SDK |
| Hosting | Vercel | Deploys `main` |
| Tests/CI | Vitest + GitHub Actions | tsc + lint + tests gate every PR |

---

## 5. Data model

Postgres (Supabase), `pgcrypto` + `vector`. RLS on every table.

**Authorization (since 0003):** policies check `public.is_app_user()` — a
SECURITY DEFINER lookup against the `app_users` entitlement table. An
authenticated session whose email isn't seeded reads **nothing**. This is the
seam where paid entitlements later plug in (status/plan column; policies
unchanged). Manual steps paired with 0003: disable public signups; seed the
owner email.

**Reference / ingested:** `securities`, `financials_snapshot`, `dividends`,
`price_snapshots`, `filings`, `filing_sections` (pgvector), `news_articles`,
`macro_indicators`. (3.5b adds: currency on prices; fixed dedupe keys for
dividends/RNS; redistributable-vs-owner-only evidence flag.)

**Scoring / output:**
- `scoring_frameworks` — versioned; one active per agent; `criteria` JSONB
  (per-sub-signal `normalisation` mode included); `updated_at` audited.
- `agent_runs` — created before execution; status running/succeeded/failed/
  cancelled; failures always leave a row.
- `reports` — one per run (unique); list UI joins runs and filters succeeded.
- `report_items` — rank (unique per report), composite, breakdown JSONB
  `{ coverage, criteria }`, `verdict` (free text), `classification`
  (per-agent vocabulary, validated app-side — DB CHECK dropped in 0003).
- `evidence` — per item; typed source rows, 0–1 resolver-confidence weight.
- `chat_sessions` / `chat_messages` — owner-scoped (`user_id = auth.uid()`).
- `app_users` — entitlements; service-role managed; no client policies.

### 5.1 Portfolio & holdings (PR 6)

The user enters their own share holdings — with an *optional* purchase
price — which powers two surfaces: a factual performance view, and (the
strategic one) a **"My Portfolio" lens over the entire intel service**:
every report, verdict, delta, and alert filtered to the names actually held.

**Tables (both `user_id = auth.uid()`-scoped via RLS — the first genuinely
per-user data):**

- `portfolios` — `id`, `user_id`, `name`, `base_currency` (default GBP),
  timestamps. One default portfolio is auto-created on first use; the schema
  supports several (Stockopedia-style folios) without change.
- `holdings` — `id`, `portfolio_id` FK, `security_id` FK, `quantity`,
  `purchase_price` *(nullable)*, `purchase_currency` *(nullable)*,
  `purchase_date` *(nullable)*, `notes`, timestamps. **Each row is a lot** —
  repeat purchases of the same name are separate rows, aggregated in the UI.
  Purchase fields are optional by design: the add flow must never stall on a
  missing cost basis, because the intel lens (the real value) works without it.

**On-demand security resolution:** holdings are NOT limited to the seed
universes. Ticker search hits `securities` first; a miss resolves through
the active `PriceSource` (profile lookup) and inserts the row. Held names
automatically join the daily price-refresh set.

**Surface 1 — performance (factual arithmetic only):** current value
(latest close × quantity, normalised to the portfolio base currency — GBp
pence ÷ 100 handled via `price_snapshots.currency`), day change, unrealised
P/L and simple return vs cost basis where a purchase price was given.
Deliberately *not* Sharesight: no IRR/TWR, no dividend-adjusted returns, no
DRIP, no tax reports in v1. Our differentiation is intel, not accounting —
say so in the UI rather than half-building it.

**Surface 2 — portfolio-filtered intel (the point):** `report_items` joined
on held `security_id`s gives: latest classification + framework scores per
holding with its evidence one click away; a portfolio-scoped **"what
changed"** feed (PR 6 delta engine); alerts when a new agent run cites a
holding (a cut-risk flag on a name you own is the single highest-value
event the product can emit). Aggregate view: a coverage-weighted framework
snapshot of the whole portfolio — the glass-box answer to Simply Wall St's
portfolio "snowflake".

**I2 discipline (hard constraints, regulatory):**
- Quantity, purchase price, and P/L **never feed scoring** or verdict text.
  Scoring stays security-scoped; a holder and a non-holder see byte-identical
  analysis for the same security. Filtering is not tailoring.
- Performance figures are arithmetic, presented as fact, never judgment. No
  "you should…" anywhere; disclaimers carry over from PR 4.

**UX (prior-art informed — Simply Wall St, Seeking Alpha, Sharesight,
Stockopedia):**
- **Add flow:** one search box (ticker/name autocomplete over `securities` +
  provider lookup), then quantity + optional price/date inline, "add
  another" loop. Target: first holding added < 30 seconds, no mandatory
  fields beyond ticker + quantity. CSV import later; broker linking
  (Plaid/TrueLayer) explicitly deferred to the paid phase.
- **My Portfolio page:** holdings table (name, qty, value, day Δ, P/L,
  latest classification badge + coverage %) with an intel feed rail
  filtered to held names. Becomes the default landing page once ≥1 holding
  exists — the product opens on *your* names, magazine view one click away.
- **Missing ≠ zero everywhere:** a holding without price data reads "no
  data", never 0; P/L renders blank without a cost basis; coverage % shows
  how much of the framework had data for each holding.

---

## 6. Scoring engine — semantics

The engine resolves every sub-signal for every candidate (batch path
preferred), normalises **per the sub-signal's declared mode**, weights within
criterion, then criteria into a 0–100 composite.

**Normalisation modes** (`ScoringCriterion.subSignals[].normalisation`):
- `rank` (default) — percentile across the candidate set. RELATIVE: fine for
  screening within one report; the worst candidate reads 0 regardless of
  merit.
- `zscore` — z-score mapped to 0–100. Still relative; respects tails.
- `absolute` — the raw value already IS a calibrated 0–100 score, passed
  through (clamped; inverted for `lower_better`). **Use for LLM grades and
  absolute-threshold signals.** This is what makes scores comparable across
  reports and over time — the composite of an all-absolute framework is an
  absolute quality grade, not a peer ranking.

**Null semantics — consistent at every level:** a null signal redistributes
its weight within the criterion; a fully-null criterion redistributes its
weight within the composite (it is NOT scored as zero); per-candidate
`coverage` (0–1, share of framework weight with data) is persisted so a thin
composite is visibly thin. **The UI must never render a null as 0.**

**Evidence weights** are the resolver's own 0–1 confidence, clamped — never
multiplied by framework weights.

`scoreWithLlm()` (`lib/scoring/llm-scorer.ts`) returns calibrated 0–100
grades via structured outputs (schema-enforced; no prose parsing; explicit
`effort`, headroom for Sonnet 5's default-on adaptive thinking) and must feed
`absolute`-mode sub-signals.

---

## 7. Data sources

Free-tier-first; normalised `Raw*` shapes; adapters expose `capabilities`
with a `readinessCheck()`. **Commercial posture:** raw third-party values are
owner-only; only derived analysis is ever sellable (POSITIONING §8).

| Adapter | Tier | Status |
|---------|------|--------|
| **Finnhub** | free (key) | **Primary from 3.5b** (settled; confirm LSE coverage in the readiness check). Also carries analyst data that may reinstate the eps-revision signal. |
| SEC EDGAR | free (UA) | Active. Known issues before the IPO agent: full-text search unpaginated (first ~10 hits); section splitter can't handle "Item 1A."/S-1s. |
| FRED | free (key) | Active. Some curated series are third-party licensed (LBMA/ICE/Cboe) — inputs only, never redistribute values. |
| yfinance | free (scraped) | **Fallback only.** Fundamentals work via the cookie+crumb dance (fragile by nature). Non-viable commercially. |
| LSE RNS (Investegate), Companies House | free | Active; RNS dedupes on announcement URL since 3.5b. |
| RSS news | free | Superseded for Geo/Reaction by native web search. Redistribution-restricted — discovery signals only. |
| FMP / Polygon(massive.com) / Marketaux | paid stubs | Scaffolded, inactive. Stub readiness must mean implemented AND configured (3.5b). |

Seed universes (curated JSON, Zod-validated): metals 32, energy 37,
dividend 26 — reviewed 2026-07-14 (delistings/renames dropped); broad-market
universe added for Reaction in PR 5.

---

## 8. Known issues & remaining work

**Fixed in 3.5a** *(for the record)*: relative-only scoring (per-signal
normalisation incl. absolute); verdict/classification threading; orphan/
partial reports leaking to `/reports`; classification CHECK blocking
Reaction; evidence weight crushing; invisible failed runs; framework
mid-run race; stale model IDs/SDK; manual JSON parsing; RLS `using(true)`;
CSRF-able mutating GET; service-role on a request path; allowlist timing
oracle; missing-as-zero persistence; no tests/CI.

**Fixed in 3.5b** *(for the record)*: callable `PriceSource` interface +
Finnhub adapter with yfinance fallback; Zod validation on price-source
responses with typed errors (SchemaChanged/NotFound/RateLimited/Blocked);
yfinance fundamentals revived (cookie+crumb); currency column on prices
(GBp/USD 100× trap); dividends dedupe on (security, ex-date); RNS dedupe on
announcement URL; in-batch dedupe before upserts; per-run failure reports
instead of silent catches; universe refresh (2026-07-14); redistributable-
vs-owner-only evidence flag; body-read timeouts + SEC 403 retry handling.
Finnhub LSE coverage probe exposed via `/api/dev/ingest?task=status` — run
it on the live key before treating Finnhub as locked in (plan §5).

**Open — 3.5c (scale):** bounded-concurrency batch resolution; Anthropic
Batch API for LLM signals; negative caching + bulk `resolveSecurityId`;
ingest moved into chunked Inngest steps (route-handler ingest times out at
Reaction scale).

**Open — product phase:** see `docs/IMPLEMENTATION_PLAN.md` §3 (PR 4–10).

---

## 9. Inputs still open

| Input | When needed |
|-------|-------------|
| Supabase project + keys; dashboard steps (disable signups, seed `app_users`) | before live verification of 3.5a |
| `FINNHUB_API_KEY`, `FRED_API_KEY`, `COMPANIES_HOUSE_API_KEY` | 3.5b |
| Inngest keys | PR 4 |
| Confirm `AUTH_ALLOWED_EMAIL` value | before first login |
| Paid geography + FCA-competent legal review | paid gate (post-M5) |

---

*End of specification.*
