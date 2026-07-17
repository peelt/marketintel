-- ============================================================
-- 0010 — Metals framework v2: rank on quality, valuation as tilt
--
-- v1's first live run mislabelled premier miners "vulnerable": the
-- 25% mean-reversion valuation criterion (distance below 52w high +
-- underperformance vs gold) dominated for names that had simply
-- performed well, and weight redistribution amplified it when
-- fundamentals were missing. Two-part correction:
--
--   1. (code) classifications now derive from ABSOLUTE facts — the
--      calibrated cost grade and hard balance-sheet numbers — never
--      the blended composite; valuation is factual context only.
--   2. (this migration) the RANKING composite reweights toward
--      quality so rank order and labels tell one story:
--         cost_position        0.40 → 0.45
--         balance_sheet        0.20 → 0.25
--         valuation_vs_history 0.25 → 0.15  (a tilt, not a driver)
--         shareholder_returns  0.15 → 0.15
--
-- v1 is deactivated, never mutated — the first report stays pinned
-- to it (I7).
-- ============================================================

update public.scoring_frameworks
    set is_active = false
    where agent_name = 'metals' and version = 1;

insert into public.scoring_frameworks (agent_name, version, criteria, params, notes, is_active)
values (
    'metals',
    2,
    '{
      "criteria": [
        {
          "key": "cost_position",
          "weight": 0.45,
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
          "weight": 0.25,
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
          "weight": 0.15,
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
    'Metals v2: rank on quality (cost 45, balance sheet 25), valuation demoted to a 15% tilt after v1 mislabelled strong performers. Classifications derive from absolute facts in code, not the composite.',
    true
)
on conflict do nothing;
