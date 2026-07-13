# Investorlogical — Implementation Plan

**Status:** Active build plan. Reads on top of `docs/POSITIONING.md` (the *what and why*)
and `docs/SPECIFICATION.md` (architecture / data model). This document owns *how and in what
order* — it is the sequence a session can pick up and follow.

**How to use this:** work top-to-bottom. Each PR has a Definition of Done (DoD) that gates the
next. Do not start a concrete agent until the foundation phase (§3, PR 3.5a–c) is merged and CI is
green. Keep every change inside the invariants in §1.

---

## 0. North star — the final goal

> A **glass-box investment-research product for the sophisticated self-directed investor**: a
> newsroom of scheduled specialist agents that file **ranked, evidence-backed reports** against a
> **scoring framework the user can see and edit**, anchored on the names the user actually holds,
> surfacing **what changed** since last run — built on hardened, tested, licensing-clean,
> paid-ready foundations, with the **Reaction Analyser as the hero** and UK-inclusive coverage as
> the wedge.

**v1 is "done" when all of these are true:**

- The **Reaction Analyser** produces a scheduled report ranking recently-dropped names by
  overshoot-vs-earned-damage, each verdict backed by the evidence rows it cited.
- A **Dividend** report exists as the credibility pole.
- A user can **see the scoring framework, edit its weights, and re-score**; old reports stay pinned
  to the version that scored them.
- The user can **anchor a watchlist** and receive **"what changed"** deltas on those names.
- Every score in the UI is **defensible from its cited evidence** via the evidence viewer (and, by
  PR 10, an evidence-scoped chat).
- The whole thing runs on foundations that are **secure** (identity-enforced at the DB), **tested**
  (Vitest + CI green), **licensing-clean for derived output**, and **paid-ready** (identity-aware,
  billing deferred but not blocked).

Everything below is in service of that paragraph. If a task doesn't advance it, it waits.

---

## 1. Invariants — hold across every PR

| # | Invariant | Practical meaning |
|---|-----------|-------------------|
| I1 | **Evidence-first** | No score persists without the source rows it cited. Never ship a scoring path that skips evidence. |
| I2 | **Impersonal** (regulatory) | Score *securities*, never the user's situation. Anchor/alert on owned names; never tailor a verdict to objectives or circumstances. Verdicts read as "the framework's classification + evidence," not directives. |
| I3 | **Derived-analysis-only** | Sell/expose our scores, rankings, evidence-summaries. Raw third-party values are owner-only. The redistributable-vs-owner-only boundary lives in the schema. |
| I4 | **Glass-box** | The framework and the evidence are product surfaces, not admin settings. "Defend this rank from its evidence" is the signature interaction. |
| I5 | **Correct-by-gate** | Strict TS (`ignoreBuildErrors: false`), `getErrorMessage()` in every catch, and from PR 3.5a onward **CI must be green** (tsc + lint + tests) before merge. |
| I6 | **Design-for-paid** | Make the reversible-cheap-now choices (identity-aware RLS, model/tier indirection, derived-vs-raw boundary). Do **not** build billing/multi-tenant UI yet. |
| I7 | **Frameworks-as-data** | Scoring frameworks are versioned DB rows, editable without redeploy; historical reports never re-scored. |
| I8 | **Server-only sensitive data** | No client-side Supabase mutation or sensitive read. Service-role client is Inngest/server-only. |

---

## 2. Milestones — outcome-oriented

| Milestone | Outcome (what's demoable) | PRs |
|-----------|---------------------------|-----|
| **M1 · Solid ground** | Foundations hardened; CI green; the fundamentals data path is actually alive; a non-allowlisted session reads nothing. | 3.5a, 3.5b, (3.5c) |
| **M2 · First cited report** | A Dividend report renders in a real dashboard with a working evidence viewer. First glass-box artifact. | 4 |
| **M3 · The hero** | Reaction Analyser live: drop → overshoot-vs-earned verdict, evidence-backed. The wedge. | 5 |
| **M4 · My analyst** | Watchlist anchoring + "what changed" alerts. It stops feeling like a magazine. | 6 |
| **M5 · You own the model** | Framework-editing UI: edit weights, re-score, versions pinned. The headline moat, visible. | 7 |
| **M6 · Breadth** | IPO, Metals, then Geopolitical + evidence-scoped chat. | 8, 9, 10 |
| **Paid gate** | After M5: decide US-first paid launch, legal review, then billing. | (post-M5) |

**First externally-meaningful demo is M3.** Everything before it is credibility and plumbing;
M3 is the thing that earns the first paying user.

---

## 3. Phased PR plan

### Foundation phase (no new agent — pure correctness so the hero is built on solid ground)

#### PR 3.5a — Correctness, security floor, and the test/CI gate
- **Goal:** close the security hole, fix the scoring semantics that every agent inherits, and stand
  up the safety net.
- **Advances:** I2, I4, I5, I6 · unblocks all downstream.
- **Depends on:** nothing.
- **Scope (files):** `supabase/migrations/*` (new RLS + `updated_at` on frameworks), `lib/auth/*`,
  `app/login`, `app/auth/callback`, `middleware.ts`, `app/api/dev/ingest`, `lib/anthropic/client.ts`,
  `lib/agents/types.ts`, `lib/scoring/{engine,normalise,types,llm-scorer}.ts`,
  `lib/agents/{persist-report,base,run}.ts`, `app/reports/*`, new `vitest.config.ts`, new
  `.github/workflows/ci.yml`.
- **Key tasks:**
  - **Security:** disable Supabase public signups; add identity-aware RLS (email/entitlement
    predicate) so an anonymous-key session reads nothing; remove blanket `using(true)` writes on
    `scoring_frameworks`. Convert `/api/dev/ingest` to a non-production / secret-gated POST (or move
    it into Inngest). Stop using the service-role client in the request-reachable diagnostics page.
  - **Model layer:** replace the hardcoded `claude-sonnet-4-5` / `claude-opus-4-7` in the three
    call-sites with a **tier indirection** (`routine`/`deep`) resolved once; set IDs to
    `claude-sonnet-5` / `claude-opus-4-8`. In `llm-scorer.ts`, adopt **structured outputs** and set
    `thinking`/`effort` explicitly (Sonnet 5 shares `max_tokens` with adaptive thinking — the current
    `max_tokens: 400` shape truncates).
  - **Scoring semantics:** add a per-sub-signal `normalisation: "rank" | "zscore" | "absolute"`
    field (fixes both the relative-only caveat *and* the currently-unreachable z-score path).
  - **Verdict/classification** threaded through `ScoredCandidate` → `persistReport` (Metals + Reaction
    need it). Relax the `report_items.classification` CHECK (migration) for Reaction's vocabulary.
  - **Persistence order:** create the `agent_runs` row **first**, insert `reports` **last**, mark
    `succeeded` at the end — fixes orphan/partial reports leaking to `/reports` *and* the
    invisible-failure gap (agent throwing before any row exists). Filter the reports list on
    `agent_runs.status='succeeded'`.
  - **Missing ≠ zero:** stop mapping absent signals to `0` in the persisted breakdown; track and
    persist a per-candidate **data-coverage %**.
  - **Tests/CI:** Vitest with golden tests for engine / normalise / persist-mapping (pure functions);
    GitHub Actions running `tsc --noEmit`, lint, tests on every PR.
  - **Docs hygiene:** commit the revival `SPECIFICATION.md` and refresh `CLAUDE.md` so the docs set is
    internally consistent (POSITIONING.md already references SPECIFICATION.md).
- **DoD:** CI green. A session authenticated with only the anon key reads **zero** rows from
  `reports`/`evidence`/etc. `llm-scorer` returns a parsed grade via structured outputs on
  `claude-sonnet-5`. A run that fails mid-persist does **not** appear in `/reports`. An `absolute`
  sub-signal passes 0–100 straight through with no re-ranking. Golden tests cover the engine.
- **Verify:** run the app; attempt a raw anon-key read; force a persist failure and confirm the
  report is absent; unit-test an absolute-mode framework.

#### PR 3.5b — Data layer & sourcing (make the data real and licensing-clean)
- **Goal:** a stable, typed, failover-capable data layer whose *derived* output is safe to sell.
- **Advances:** I1, I3 · unblocks PR 4/5 (dividend + reaction need live fundamentals + prices).
- **Depends on:** 3.5a.
- **Scope:** `lib/data-sources/*` (new `PriceSource` interface + Twelve Data/Finnhub adapter),
  `lib/ingest/*`, `supabase/migrations/*` (currency column; evidence redistributable flag; dedupe
  keys), `lib/data-sources/universes/*`.
- **Key tasks:**
  - Define a callable **`PriceSource` interface** (canonical `from`/`to`, typed errors, honest
    readiness = implemented **and** configured). Add **Twelve Data or Finnhub** as primary,
    **yfinance as fallback** — this revives the dead fundamentals path (Yahoo `quoteSummary` 401s
    without cookie+crumb).
  - **Zod-validate every network response**; throw typed errors (SchemaChanged / NotFound /
    RateLimited / Blocked) so schema drift is distinguishable from a delisting or a throttle.
  - Fix data-integrity keys: drop `amount` from the dividends unique key; give RNS filings a real
    dedupe key; add a **`currency`** column to `price_snapshots` (GBp vs USD is a latent 100× error);
    in-batch dedupe before upserts.
  - **Per-run failure report** (which tickers/feeds failed and why) instead of silent per-ticker
    catches.
  - Refresh seed universes (drop delisted names).
  - Add the **redistributable-vs-owner-only** flag on evidence/source rows (I3 boundary in schema).
- **DoD:** a fundamentals fetch returns real data via the primary adapter with yfinance fallback on
  failure; a forced schema change surfaces a typed `SchemaChanged`, not a silent zero; prices carry
  currency; a run emits a failure report listing any skipped names.
- **Verify:** point the resolver at the new adapter, ingest a handful of US + UK tickers, confirm
  currency + coverage + failure report.

#### PR 3.5c — Scale & batching (land the interface in 3.5a; implement just before the hero)
- **Goal:** survive the Reaction Analyser's ~500–800-name universe and the LLM fan-out.
- **Advances:** M3 readiness.
- **Depends on:** 3.5a (interface), 3.5b.
- **Key tasks:** batch-resolver interface (resolve one sub-signal for all candidates in one
  round-trip) + bounded-concurrency `Promise.all`; **Anthropic Batch API** for LLM signals; negative
  caching + bulk lookup in `resolveSecurityId`; move ingest into **chunked Inngest steps** (single
  route handler will time out on 800 tickers).
- **DoD:** an 800-candidate dry run completes within Inngest step limits; LLM signals go through the
  Batch API; untracked tickers don't re-run three queries each.

> **Note:** 3.5c's *interface* must exist in 3.5a so agents build against it; its *implementation*
> can land just-in-time before PR 5.

---

### Product phase (build the concept, in defensibility order)

#### PR 4 — Dividend agent + the first dashboard slice
- **Goal:** first concrete pole (credibility) **and** the first real investor-facing surface.
- **Advances:** M2 · I1, I2, I4.
- **Depends on:** 3.5a/b.
- **Key tasks:**
  - Dividend resolvers against `financials_snapshot` + prices; cut-risk callouts; framework v1
    seeded (weights per the pending decision — see §5). Fri 18:00 UTC Inngest cron wired.
  - **Thin dashboard:** report view + **evidence viewer** (the architecture's whole point, currently
    invisible) + one chart (yield/price history).
  - **Disclaimer surface:** impersonal framing, "information/probability, not personal advice," per I2.
- **DoD:** a scheduled Dividend report renders with a ranked table, each row's evidence viewable,
  one chart, and a visible disclaimer. Cron fires on schedule in a test trigger.
- **Blocking input:** dividend weights + `eps_revision_trend` handling (see §5).

#### PR 5 — Reaction Analyser (the hero)
- **Goal:** ship the differentiator — drop-detection fused with a fundamental overshoot-vs-earned
  verdict, evidence-backed.
- **Advances:** M3 · the wedge.
- **Depends on:** 3.5c, PR 4 (dashboard/evidence surface to render into).
- **Key tasks:** broad-market universe (S&P 500 + FTSE 350) seed + daily price-refresh job;
  inclusion threshold + Tue/Fri schedule (pending decision, §5); `reaction` framework v1 with verdict
  bands (STRONG_OVERSHOOT / MILD_OVERSHOOT / PROPORTIONATE / UNDERREACTION) via migration 0003;
  **native `web_search`/`web_fetch`** news layer + **structured-outputs** sentiment grading. Renders
  through the PR-4 dashboard + evidence viewer.
- **DoD:** a scheduled run screens the universe for large drops, scores each on overshoot, emits a
  banded verdict with cited evidence, and renders in the dashboard. This is the demo.
- **Blocking input:** inclusion threshold + schedule (§5).

#### PR 6 — Portfolio/watchlist anchoring + "what changed" alerting (table-stakes)
- **Goal:** make it feel like *the user's* analyst without crossing into personal advice.
- **Advances:** M4 · I2.
- **Key tasks:** per-user watchlist model (RLS, `user_id = auth.uid()`); manual holdings entry first;
  **delta engine** comparing successive runs for watched names; alert delivery (email via existing
  infra / in-app). Strictly impersonal: alert on owned securities, never tailor the verdict.
- **DoD:** a user adds names, and after a run receives a "what changed" summary for exactly those
  names; no personalized recommendation is generated.

#### PR 7 — Editable framework UI (the headline moat, made visible)
- **Goal:** turn frameworks-as-data into a product surface.
- **Advances:** M5 · I4, I7.
- **Key tasks:** UI to view/edit criteria, weights, sub-signals, and normalisation mode without
  redeploy; weight-sum validation; version surfaced; historical reports pinned to their version and
  never re-scored.
- **DoD:** a user re-weights a framework, re-scores, sees a new version; an old report still shows
  its original framework version and scores.

#### PR 8 — IPO agent
- Genuine gap, episodic demand — after the hero is proven. **Must first fix the audited EDGAR issues**
  (full-text search returns only first page; the section-splitter regex can't match "Item 1A." and
  S-1s have no Item headings) or the agent scores cover pages instead of Risk Factors/MD&A.

#### PR 9 — Precious Metals agent
- Buy/hold/avoid across ETFs/royalties/miners via the verdict path (I2 language discipline). Niche
  but differentiated.

#### PR 10 — Geopolitical scanner + evidence-scoped chat
- The house-view memo, **plus** the evidence-scoped chat generalized across all poles — "ask the
  report why," fenced to cited rows. This is the moat interaction (I1/I4) at its fullest. Watch the
  advice-framing on the geo memo.

> **Energy Beneficiaries** is deprioritized (least differentiated). Fold in later or drop.

---

## 4. Cross-cutting workstreams

- **Testing/CI** — established in 3.5a; every subsequent PR adds tests for its own logic; CI stays
  green as a merge gate.
- **Observability & audit** — `agent_runs` status/error exists; add an **auth audit log** and, as the
  paid gate approaches, **per-user usage metering** (needed to bill and to enforce plan limits).
- **Compliance surface** — disclaimer components (PR 4 onward); keep verdict language impersonal;
  let the persisted evidence trail double as the compliance story.
- **Paid-readiness** (design-only until the gate) — identity-aware RLS (3.5a), derived-vs-raw
  boundary (3.5b), entitlement seam where the allowlist lives today. **No Stripe/billing build** until
  the charging decision.
- **Docs hygiene** — keep `POSITIONING.md`, `SPECIFICATION.md`, `CLAUDE.md`, and this plan consistent
  as decisions land.

---

## 5. Inputs still required (blocking specific PRs)

These were opened at kickoff and never settled (the session pivoted to strategy). They **block the
PRs noted** and should be answered before those start — do not guess them.

| Input | Blocks | Note |
|-------|--------|------|
| Dividend framework weights (default 25/40/15/20?) | PR 4 | Keep or adjust. |
| `eps_revision_trend` handling | PR 4 | yfinance has no revisions — drop & rebalance (recommended), proxy via price reaction, or LLM-grade via web search. |
| Reaction inclusion threshold | PR 5 | Proposed: 5d drawdown ≥12% OR 1d drop ≥8%. |
| Reaction schedule | PR 5 | Proposed: Tue + Fri 17:00 UTC. |
| Primary price-source choice | PR 3.5b | Twelve Data vs Finnhub (need the API key). |
| Paid geography + legal review | Paid gate | US-first vs UK-sophisticated-gated; FCA-competent advice before any UK paid launch. |
| Repo rename to `peelt/investorlogical` | any time | Optional; deferred by prior decision. |

---

## 6. Sequencing rationale & the paid gate

- **Foundation before hero:** the RLS hole, the dead fundamentals path, and the missing test net all
  compound if an agent is built on top of them. 3.5a/b are non-negotiable pre-work; 3.5c can land
  just-in-time before PR 5.
- **Dividend before Reaction, but Reaction is the hero:** Dividend is built first for data-availability
  and credibility, but the *marketing and demo* lead with Reaction. Sequence, don't conflate.
- **Table-stakes (PR 6) before breadth (8–10):** anchoring + alerts turn the tool from a magazine into
  an analyst; that matters more than a fourth or fifth pole.
- **Paid gate after M5:** once "you own the model" is visible and the hero is proven, decide US-first
  paid launch, take legal advice, then build billing. Not before.

---

## 7. How each PR is worked (checklist template)

For every PR above:

1. Branch from latest `main`; keep the PR self-contained and small enough to review in the GitHub UI.
2. Implement inside the §1 invariants.
3. `npm install` → `npx tsc --noEmit` clean; lint clean; tests added and green.
4. Verify behavior by driving the actual flow (not just types) — the DoD's "Verify" line.
5. Open a **draft PR** against `main` with a body that states goal, scope, DoD, and how it was
   verified; subscribe to its activity.
6. Merge only on green CI + owner review (Peel merges via the GitHub UI).
7. Update this plan and the docs set if a decision or sequence changed.
