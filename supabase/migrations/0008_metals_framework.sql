-- ============================================================
-- 0008 — Precious Metals framework v1 (PR 9)
--
-- Scores the metals_buyhold_avoid names (gold/silver miners +
-- royalty/streamers; ETFs are excluded — they track the metal and
-- would be nonsense against a producer framework).
--
-- The anchor is COST POSITION: what it costs the company to produce
-- an ounce (AISC) versus what the metal sells for. A miner producing
-- at $1,100/oz with gold at $2,600 is a fundamentally different asset
-- from one producing at $2,300 — and generic screeners ignore this.
-- AISC isn't served by any free API; it is web-researched per name
-- from company reporting and graded 0–100 ABSOLUTE (calibrated across
-- producers and time), so normalisation is "absolute" — rank-
-- normalising a calibrated grade destroys the calibration.
--
-- Composite = "position strength": higher = stronger cost position,
-- balance sheet, and value vs own history. Classifications band it
-- impersonally (well_positioned / mixed / vulnerable) — never advice.
-- ============================================================

insert into public.scoring_frameworks (agent_name, version, criteria, params, notes, is_active)
values (
    'metals',
    1,
    '{
      "criteria": [
        {
          "key": "cost_position",
          "weight": 0.40,
          "subSignals": [
            {
              "key": "aisc_margin_grade",
              "weight": 1.0,
              "direction": "higher_better",
              "normalisation": "absolute",
              "sourceQuery": "metals.cost_margin_grade"
            }
          ]
        },
        {
          "key": "balance_sheet",
          "weight": 0.20,
          "subSignals": [
            {
              "key": "debt_to_ebitda_ttm",
              "weight": 0.5,
              "direction": "lower_better",
              "sourceQuery": "metals.debt_to_ebitda_ttm"
            },
            {
              "key": "fcf_yield_ttm",
              "weight": 0.5,
              "direction": "higher_better",
              "sourceQuery": "metals.fcf_yield_ttm"
            }
          ]
        },
        {
          "key": "valuation_vs_history",
          "weight": 0.25,
          "subSignals": [
            {
              "key": "discount_to_52w_high",
              "weight": 0.6,
              "direction": "higher_better",
              "sourceQuery": "metals.discount_to_52w_high"
            },
            {
              "key": "relative_strength_vs_gold_6m",
              "weight": 0.4,
              "direction": "lower_better",
              "sourceQuery": "metals.rs_vs_gold_6m"
            }
          ]
        },
        {
          "key": "shareholder_returns",
          "weight": 0.15,
          "subSignals": [
            {
              "key": "dividend_yield_ttm",
              "weight": 1.0,
              "direction": "higher_better",
              "sourceQuery": "metals.dividend_yield_ttm"
            }
          ]
        }
      ]
    }'::jsonb,
    '{}'::jsonb,
    'Metals v1: AISC-aware cost position (web-researched, absolute-calibrated) 40%, balance sheet 20%, valuation vs own history 25%, shareholder returns 15%. ETFs excluded from scoring.',
    true
)
on conflict do nothing;
