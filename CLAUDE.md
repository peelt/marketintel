# CLAUDE.md

Context for Claude sessions working on this repo.

## What this is

Personal investment research tool for Peel. Five scheduled agents:

1. **IPO Evaluation** — weekly league table of upcoming IPOs
2. **Dividend Intelligence** — Friday report of high-yield names
3. **Geopolitical Scanner** — macro/geopolitical memo
4. **Energy Beneficiaries** — upstream/midstream/equipment/industrials
5. **Precious Metals** — buy/hold/avoid across ETFs, royalties, miners

Single user (Peel only). Not productisable from day one — that's a deliberate
phasing decision to keep the auth path fast.

## Build plan

PR 1 (this) — scaffold
PR 2 — data source adapters + seed universe
PR 3 — agent base, scoring engine, evidence persistence, report page
PR 4 — Dividend agent
PR 5 — IPO agent
PR 6 — Energy + Metals agents
PR 7 — Geopolitical scanner + chat layer

## Data sources (v1)

Free only. Paid adapters scaffolded but unused.

- SEC EDGAR — S-1s, 10-Ks, full-text search (User-Agent header required)
- FRED — macro time series
- yfinance (unofficial; expect occasional breakage)
- LSE RNS, Companies House — UK
- Free RSS feeds for news (Marketaux is the paid upgrade in scope for v2)

Budget headroom (~£64/mo total estimated) is held back until v1 proves the
scoring framework actually produces useful output. Spending paid data money on
a framework that turns out to be thin is wasteful.

## Conventions

- Strict TS, `ignoreBuildErrors: false`. Fix at source.
- `getErrorMessage()` in `lib/errors.ts` for all `catch` blocks.
- No client-side Supabase queries that mutate or read sensitive data — server
  actions or Inngest functions only.
- Service role client (`lib/supabase/service.ts`) is for Inngest jobs only.
  Never expose to the browser.
- Every LLM-produced score gets persisted with the evidence rows it cited.
  The chat layer (PR 7) is constrained to those rows.
- Scoring frameworks are versioned, live in DB, editable from the UI without
  redeploys. Old reports retain the framework version they were scored against.

## Agent contract

See `lib/agents/types.ts`. Every agent implements `Agent` and exposes its
metadata via `agentRegistry` in `lib/agents/registry.ts`. The orchestrator
(PR 3) calls `agent.run(input)` and persists the returned `RankedReport`.

## Auth

Magic link via Supabase Auth. Allowlist enforced at `lib/auth/allowlist.ts` —
both before sending the OTP and again in the callback. Disallowed emails get
a fake-success message so the allowlist isn't probeable.

## Schedules (UTC)

Set in `lib/agents/registry.ts`. Friday 18:00 UTC = 19:00 BST / 18:00 GMT,
which gets the dividend report into Peel's hands before US close.

## Models

- `claude-sonnet-4-5` for routine scoring and structured output (Dividend,
  Energy, Metals)
- `claude-opus-4-7` for deep synthesis (IPO league table reasoning,
  Geopolitical memo)

Defaults in `lib/agents/registry.ts`; per-call override available via
`MODELS` in `lib/anthropic/client.ts`.

## What not to do

- Don't add a client-side Supabase query that reads from `agent_runs`,
  `evidence`, `filings`, or anything tied to scoring logic. Server side only.
- Don't bypass the evidence-persistence requirement to ship faster. The
  follow-up chat depends on it being honest.
- Don't introduce a paid data source without first checking whether the
  scoring framework is actually limited by data quality vs framework design.
