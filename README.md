# Investorlogical

*(repo name `marketintel` retained by decision — see CLAUDE.md)*

Glass-box investment research: scheduled specialist agents file ranked,
evidence-backed reports against scoring frameworks the user can see and
edit — with follow-up Q&A scoped to the evidence they cited.

## Status

Foundation hardened (3.5a security/scoring/CI + 3.5b typed data layer with
Finnhub primary / yfinance fallback). PR 4 delivers the first concrete pole:
the Dividend agent files a scheduled, evidence-backed report rendered in the
dashboard with an evidence viewer, price charts and the impersonal
disclaimer surface.

| Pole | Status | Cadence (UTC) |
|---|---|---|
| Dividend Intelligence | **live** (PR 4) | Fri 18:00 |
| Reaction Analyser *(hero)* | next — PR 5 | Tue + Fri 17:00 |
| IPO Evaluation | metadata only | Sun 18:00 |
| Geopolitical Scanner | metadata only | Sun 20:00 |
| Precious Metals | metadata only | Sat 12:00 |
| Energy Beneficiaries | deprioritized | — |

See `CLAUDE.md` for conventions and `docs/IMPLEMENTATION_PLAN.md` for the
authoritative build sequence.

## Stack

- Next.js 15 (App Router, React 19, strict TS, no `ignoreBuildErrors`)
- Tailwind v4
- Supabase (auth + Postgres + pgvector + RLS)
- Inngest (scheduling and long-running agent jobs)
- Anthropic SDK (tier-indirected: `routine` → Sonnet 5, `deep` → Opus 4.8; IDs pinned once in `lib/anthropic/client.ts`)
- Vercel for hosting

## Setup

```bash
# 1. Install
npm install

# 2. Env
cp .env.example .env.local
# Fill in Supabase, Anthropic, allowed email, etc.

# 3. Apply schema to your Supabase project
#    (use Supabase Studio SQL editor, or `supabase db push` if linked)
#    File: supabase/migrations/0001_initial_schema.sql

# 4. Run
npm run dev

# 5. (optional) Inngest dev server in a second terminal — required once
# agent functions are added in PR 3.
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

## Auth

Single-user. Magic link via Supabase Auth, gated on `AUTH_ALLOWED_EMAIL`.
Anyone else hitting `/login` gets a pretend-success message but no email.

## Data sources (v1)

Free tier only. Paid adapters scaffolded behind the same interfaces in
`lib/data-sources/{fmp,polygon,marketaux}.ts` — slot in via env flags later
without refactor.

| Adapter | Status | Provides |
|---|---|---|
| Finnhub | active (API key) — **primary** | prices, dividends, fundamentals snapshot |
| SEC EDGAR | active (UA required) | filings (S-1, 10-K, full-text search) |
| FRED | active (API key) | macro time series |
| yfinance | active — fallback | prices, dividends, fundamentals snapshot |
| LSE RNS (via Investegate) | active | UK announcements |
| Companies House | active (API key) | UK issuer detail |
| RSS news | active | financial news from FT/MW/SA/Yahoo |
| FMP | **stub** | clean quarterly financials, IPO calendar |
| Polygon | **stub** | upgrade path for prices |
| Marketaux | **stub** | tagged news with sentiment |

## Build plan

The authoritative sequence lives in `docs/IMPLEMENTATION_PLAN.md` (foundation
3.5a–c, then Dividend → Reaction → portfolio holdings → editable frameworks →
breadth). This README intentionally doesn't duplicate it.

## Conventions

- Strict TS, `ignoreBuildErrors: false` — fix at source, don't suppress.
- `getErrorMessage()` in `lib/errors.ts` for all `catch` blocks.
- Server actions and Inngest jobs only — no client-side Supabase queries that
  bypass RLS.
- Every score the LLM produces is persisted alongside the evidence rows it
  cited. The chat layer is constrained to those rows.
