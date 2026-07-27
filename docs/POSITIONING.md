# Investorlogical — Product Positioning & Concept Revision

**Status:** Positioning baseline, PARTIALLY SUPERSEDED by the 26 Jul 2026 scope reduction
(IMPLEMENTATION_PLAN §5, CLAUDE.md "Where we are"): the product is now the Reaction Analyser
alone — the "newsroom of specialist agents" described below is retired (dividend/metals/ipo) or
retired as a desk (geopolitical — its macro read was later rebuilt inside Reaction as the
drop-attribution backdrop). The moats analysis, regulatory posture and Reaction-hero framing below
still stand; read every multi-desk passage as historical context. Pairs with
`docs/SPECIFICATION.md` (architecture / data model / build status) — this document owns *what we
are building and why*, the spec owns *how*.

**One-line summary:** the engine is sound; the concept was leading with the wrong hand. Reposition
around what no competitor offers — an editable scoring framework, a newsroom of specialist agents,
and an evidence trail honest enough to defend a ranking — and make the Reaction Analyser the hero.

This baseline is grounded in a scan of 20+ commercial products across three tiers (enterprise
research AI, retail scoring/dashboards, scheduled "AI analyst" tools) plus UK/US regulatory sources.
Pricing figures below are indicative (vendor- or review-site-sourced); performance claims are
vendor-stated and unaudited.

---

## 1. Positioning thesis

Everything Investorlogical currently foregrounds — an AI that reads filings, cites its sources,
and generates a research note — the market has already commoditized. Sentence-level citations are
table stakes (AlphaSense, Fintool, Hebbia, Perplexity all ship them). Autonomous note-generation is
a weekend project. That layer is being swallowed from above (Microsoft folded Fintool into Office)
and undercut from below (Perplexity gives scheduled finance "Tasks" away free).

The durable value is not "the AI can read a 10-K." It is **whether the user can trust — and change
— the opinion the tool renders.** Three things do that, and all three already live in the
architecture as plumbing rather than as product:

- a **user-editable, versioned scoring framework**;
- a **newsroom of specialist agents**, each filing on its own mandate and cadence;
- an **evidence trail** that can defend a *ranking* ("why does this name top the table this week?")
  from only the rows a score cited — no roaming, no fresh invention.

Lead with those. They are what no competitor occupies.

---

## 2. Who it's for

The **sophisticated, self-directed investor** who distrusts black-box ratings and wants to see —
and set — the methodology. This is a niche-depth play, not a mass-market one: the retail market
demonstrably tolerates black boxes (TipRanks, Danelfin sell fine), so editability appeals to the
sub-segment that cares. That sub-segment is exactly the persona the tool was built for.

Product voice: **glass-box research**, positioned explicitly against the black boxes.

---

## 3. Where it sits in the market

The field splits into two camps with an empty band between them. Investorlogical targets the band.

| Camp | What they are | Examples (indicative price) | Why they don't own the band |
|------|---------------|-----------------------------|-----------------------------|
| **A — Enterprise** | Deep, cited synthesis / agentic workflows | Bloomberg (~$32k/seat), AlphaSense (~$10–40k), Hebbia (~$3–10k), Rogo (7-figure), Brightwave (enterprise) | Sold to firms; render neutral synthesis or banker workflows, never a transparent editable ranked verdict a person can own |
| **B — Retail** | Cheap, public pricing | Perplexity ($20/mo), Fiscal.ai ($39/mo), Simply Wall St ($10–20), Danelfin ($28–79), Seeking Alpha ($299–499/yr), Stockopedia (£295/yr), Simply Safe Dividends ($499/yr) | Either answer questions without taking a position, or hand down a score whose weighting you can't see, let alone change |
| **The band** | Institutional-style ranked, evidence-backed research at a retail price, against a framework the user controls | *(unoccupied)* | — |

Fiscal.ai proves individuals pay ~$39/mo for AI research; Perplexity's free Tasks prove retail
demand for scheduled research. Neither renders a defensible ranked verdict against a user-controlled
methodology. **Anchor pricing at $20–50/mo.**

---

## 4. What we compete on — four uncontested moats

Verified as unclaimed in the public positioning of every product surveyed.

1. **You own and edit the scoring framework.** Rivals hide the weights (TipRanks, Danelfin) or show
   sub-scores but freeze the weighting (Seeking Alpha, Stockopedia, Simply Wall St). None lets you
   re-weight the rubric and re-score, with old reports pinned to the version that scored them. This
   is the single clearest whitespace.
2. **A newsroom, not a score.** Incumbents ship one score or one digest. We ship a team of
   specialist analysts on distinct cadences by mandate. The orchestration is the product; the model
   is the executor.
3. **Evidence that defends the ranking.** Citations defend an *answer*; we defend a *rank*, answered
   only from the evidence rows the score cited. A sharper, more honest promise than generic
   "no hallucination."
4. **Real UK depth.** The field is overwhelmingly US-centric (Danelfin, Alpha Picks, TipRanks,
   Robinhood Cortex). Genuine LSE / RNS / Companies House coverage is thin — an accidental moat
   worth making deliberate. (It is also where regulatory friction is highest — see §7.)

---

## 5. What we must add — table-stakes

Not differentiators; the price of being taken seriously. Every credible incumbent has both; we
currently have neither.

- **Portfolio / watchlist anchoring.** Seeking Alpha, Simply Wall St, Morningstar, Stockopedia and
  Simply Safe Dividends all anchor on the user's holdings. A tool that scores a universe but doesn't
  know what you own reads as a magazine, not an analyst. Decided 2026-07: holdings entry includes an
  *optional* purchase price — enough for a factual performance snapshot (value, day change,
  unrealised P/L), while the primary payoff is the whole service curated to held names. Full
  performance accounting (IRR, dividends, tax) stays out of scope — that's Sharesight's product;
  ours is the intel lens. See SPECIFICATION §5.1.
- **"What changed" alerting.** The scheduled-agent architecture is *already* a delta engine; it just
  frames output as reports on a universe rather than changes to names the user cares about. Reframe
  it. The versioned framework tells a trust story no black box can: your holding's score moved
  because *the facts moved*, not because someone quietly re-tuned the model.

> **The personalization tripwire (load-bearing).** "You happen to own this security we scored" is
> generic research. "Given your situation, sell this" is regulated personal advice. Anchor and alert
> on generically-scored securities; never tailor the verdict to the user's objectives or
> circumstances. See §7.

---

## 6. The six poles, re-ranked by defensibility

The original line-up read as a grab-bag aimed at no single customer. Ranked by differentiation
against what already exists:

| # | Pole | Role | Rationale |
|---|------|------|-----------|
| 1 | **Reaction Analyser** | **Hero** | The most novel pole by far. No retail product fuses drop-detection with a *fundamental* earned-vs-overshoot verdict — existing tools are technical dip-detectors (RSI, "dip hunter"). Targets a recurring, emotional, high-engagement moment ("my stock fell 15% — trap or bounce?") and demos the evidence thesis best. |
| 2 | **Dividend Intelligence** | Table-stakes / credibility | Crowded. Simply Safe Dividends (~$499/yr, entrenched, semi-transparent) owns yield + cut-risk + alerts + portfolio. Keep for credibility; compete only on editable weights and cross-pole integration, not novelty. |
| 3 | **IPO Evaluation** | Genuine gap | No affordable transparent pre-IPO scorer exists for retail (IPO Intelligence ~$39k/yr, institutional-only). Real whitespace, but episodic demand. Keep; don't lead. |
| 4 | **Precious Metals** | Gap · narrow | No consumer service scores buy/hold/avoid across ETFs, royalties and miners as a set. Differentiated but niche. |
| 5 | **Geopolitical Scanner** | House view | Narrative glue and a "house view," but the hardest to make evidence-rigorous and closest to opinion/advice framing. Handle its language with regulatory care. |
| 6 | **Energy Beneficiaries** | Deprioritize | Least differentiated — sector-exposure screens are widely available and commoditized. Fold in later or drop. |

**Directive:** lead with Reaction; keep Dividend for credibility; treat the rest as supporting desks
in the newsroom, not co-equal launches.

---

## 7. Regulatory posture

*Orientation, not legal advice. Any UK paid/public launch must be run past an FCA-competent adviser.*

The verdict framing that makes the product saleable is the same thing that trips UK promotion rules.
The US and UK answers genuinely diverge.

- **United States — workable.** The publisher's exemption (*Lowe v. SEC*; reaffirmed by the 2024
  Seeking Alpha dismissal) covers impersonal, regularly-circulated, bona-fide, disinterested
  research on securities generally — exactly what scheduled ranked reports are. Even filtered email
  alerts survived, as they surface generally-available content. **Tripwire:** personalization to a
  specific subscriber's portfolio or objectives.
- **United Kingdom — take advice first.** The binding constraint is not the advice perimeter
  (impersonal research generally isn't "advising on investments") but the **s21 financial-promotions
  regime**. A "buy" / "Strong Buy" league table plausibly reads as an *inducement*, and the
  newspaper exemption likely **fails its principal-purpose test** because steering buy/sell decisions
  is the product's whole purpose. **Route:** keep v1 private and single-user (low exposure); before
  any paid/public UK launch, obtain FCA-competent advice and choose a lawful path — HNW/sophisticated
  gating, or authorisation / an approved promoter.

**Product implications (do these regardless of geography):**

- Present buy/hold/avoid as *the framework's classification of the security, plus its cited
  evidence* — not a directive to the reader.
- Keep every report impersonal: score securities, not the user's portfolio.
- Copy incumbent disclaimer discipline: information / probability, not personal advice; the user is
  solely responsible; past and backtested performance ≠ future results; seek independent regulated
  advice. Disclose any conflicts / holdings.
- Let the persisted evidence trail double as the compliance story (it reinforces "impersonal,
  factual research").

The cleanest paid path is **US-first, or UK-gated to certified sophisticated investors.**

---

## 8. Decisions taken

Settled with the product owner; treat as fixed unless explicitly revisited.

| Decision | Choice |
|----------|--------|
| Commercial intent | Design for a paid product now; don't build billing/multi-tenancy yet. Make the reversible-cheap-now foundations (identity-aware RLS, model/tier indirection, redistributable-vs-owner-only evidence flag). |
| Data-sourcing posture | **Sell derived analysis only** — show raw third-party values to the owner; sell our own scores/rankings/evidence-summaries. Shrinks the redistribution surface so cheaper sources stay usable. Bake the owner-only-vs-redistributable boundary into the schema. |
| Dashboard timing | Build a thin investor-facing slice (report view + evidence viewer + one chart) from PR 4, extend per agent — not last. |
| Foundation work | Full hardening before concrete agents (security/correctness/tests + data layer + scale), tracked separately in the engineering plan. |

The data-sourcing choice and the regulatory posture reinforce each other: impersonal,
evidence-backed *derived* output is both the defensible IP and the framing that stays on the safe
side of the promotions line.

---

## 9. What this changes about the build order

- **Reaction Analyser moves up** to the flagship concrete agent — it earns the first paying users
  and best exercises the evidence path. (Dividend remains the credibility pole and a natural
  first-built for data-availability reasons; sequence the two deliberately.)
- **Portfolio/watchlist + "what changed" become first-class features**, not a post-launch addition.
  The scheduled-agent architecture already does the hard part.
- **The editable framework and the evidence viewer become product surfaces**, not admin settings.
  "Defend this rank from its cited evidence" is the signature interaction and the demo moment.
- **UK depth is treated as the beachhead moat**, paired with a deliberate call on paid geography
  given the s21 constraint.

---

## 10. Anti-goals

- **Don't sell "AI reads filings."** It's commoditized and being absorbed by distribution giants.
  The moat is orchestration, framework-ownership, evidence honesty, and UK depth.
- **Don't out-terminal Koyfin / Bloomberg** on data breadth or charting flexibility. Differentiate
  on the opinionated, defensible verdict they deliberately lack.
- **Don't chase mass-market retail.** The editable-framework value serves the sophisticated
  sub-segment; that's the audience and the price band.
- **Don't personalize the verdict.** Personalization is both the US publisher's-exemption tripwire
  and the UK advice tripwire. Anchoring on holdings is fine; tailoring the recommendation is not.

---

## 11. Longer-horizon platform card

Frameworks-as-data can become a community layer — publish, fork and subscribe to scoring rubrics,
the way TradingView did for scripts. Not v1, but the architecture already supports it, and it
deepens the one moat no incumbent has. Hold it in reserve; don't scope it yet.
