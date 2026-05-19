# marketintel

Five scheduled investment-research agents that produce ranked reports with
follow-up Q&A scoped to the evidence they cited.

## Status

PR 1 — scaffold. Next.js 15, Supabase (schema + auth), Inngest (no functions
yet), Anthropic SDK wired, agent registry declared with metadata only.

| Pole | Status | Cadence (UTC) |
|---|---|---|
| IPO Evaluation | metadata only | Sun 18:00 |
| Dividend Intelligence | metadata only | Fri 18:00 |
| Geopolitical Scanner | metadata only | Sun 20:00 |
| Energy Beneficiaries | metadata only | Sat 10:00 |
| Precious Metals | metadata only | Sat 12:00 |

See `CLAUDE.md` for the build plan and conventions.

## Stack

- Next.js 15 (App Router, React 19, strict TS, no `ignoreBuildErrors`)
- Tailwind v4
- Supabase (auth + Postgres + pgvector + RLS)
- Inngest (scheduling and long-running agent jobs)
- Anthropic SDK (Claude Sonnet 4.5 default, Opus 4.7 for deep synthesis)
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

Free tier only. Paid adapters (FMP, Polygon, Marketaux) will be scaffolded
behind the same interfaces in PR 2 but unused in v1 — they slot in via env
flags later without refactor.

- SEC EDGAR — S-1s, 10-Ks, full-text search
- FRED — Fed and macro time series
- yfinance (unofficial, prices and dividends)
- LSE RNS feed — UK filings
- Companies House — UK issuer detail

## Build plan

1. **PR 1** — scaffold (this PR)
2. **PR 2** — data source adapters with normalised return shapes + seed universe
3. **PR 3** — agent base, scoring engine, evidence persistence, report rendering
4. **PR 4** — Dividend agent (first concrete pole)
5. **PR 5** — IPO agent
6. **PR 6** — Energy + Metals agents
7. **PR 7** — Geopolitical scanner + chat layer

## Conventions

- Strict TS, `ignoreBuildErrors: false` — fix at source, don't suppress.
- `getErrorMessage()` in `lib/errors.ts` for all `catch` blocks.
- Server actions and Inngest jobs only — no client-side Supabase queries that
  bypass RLS.
- Every score the LLM produces is persisted alongside the evidence rows it
  cited. The chat layer is constrained to those rows.
