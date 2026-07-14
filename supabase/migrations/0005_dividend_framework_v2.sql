-- ============================================================
-- 0005 — Dividend framework v2 (settled decisions, plan §5)
--
-- Decisions applied (13 Jul 2026, product owner):
--   * criterion weights KEPT at 25/40/15/20 — safety-first: a yield
--     spike reads as cut risk, not a buy signal
--   * eps_revision_trend DROPPED (no reliable free source; possibly
--     reinstated later via Finnhub analyst data), remaining cut-risk
--     sub-signals rebalanced to 0.5 / 0.5
--
-- Frameworks are versioned data: v1 stays untouched (historical
-- reports pin it); v2 becomes the single active version.
-- ============================================================

update public.scoring_frameworks
set is_active = false
where agent_name = 'dividend' and is_active = true;

insert into public.scoring_frameworks (agent_name, version, criteria, notes, is_active)
values (
    'dividend',
    2,
    '{
      "criteria": [
        {
          "key": "yield_attractiveness",
          "weight": 0.25,
          "subSignals": [
            {
              "key": "yield_ttm_vs_sector_median",
              "weight": 1.0,
              "direction": "higher_better",
              "sourceQuery": "dividend.yield_ttm_vs_sector"
            }
          ]
        },
        {
          "key": "coverage_and_sustainability",
          "weight": 0.40,
          "subSignals": [
            {
              "key": "payout_ratio_ttm",
              "weight": 0.35,
              "direction": "lower_better",
              "sourceQuery": "dividend.payout_ratio_ttm"
            },
            {
              "key": "fcf_dividend_cover_ttm",
              "weight": 0.40,
              "direction": "higher_better",
              "sourceQuery": "dividend.fcf_cover_ttm"
            },
            {
              "key": "debt_to_ebitda_ttm",
              "weight": 0.25,
              "direction": "lower_better",
              "sourceQuery": "dividend.debt_to_ebitda_ttm"
            }
          ]
        },
        {
          "key": "track_record",
          "weight": 0.15,
          "subSignals": [
            {
              "key": "dividend_growth_5y_cagr",
              "weight": 0.6,
              "direction": "higher_better",
              "sourceQuery": "dividend.growth_5y_cagr"
            },
            {
              "key": "years_without_cut",
              "weight": 0.4,
              "direction": "higher_better",
              "sourceQuery": "dividend.years_without_cut"
            }
          ]
        },
        {
          "key": "cut_risk_signals",
          "weight": 0.20,
          "subSignals": [
            {
              "key": "yield_z_score_24m",
              "weight": 0.5,
              "direction": "lower_better",
              "sourceQuery": "dividend.yield_zscore_24m"
            },
            {
              "key": "ocf_yoy_change",
              "weight": 0.5,
              "direction": "higher_better",
              "sourceQuery": "dividend.ocf_yoy_change"
            }
          ]
        }
      ]
    }'::jsonb,
    'v2 per settled decisions (plan §5): weights kept 25/40/15/20; eps_revision_trend dropped, cut-risk rebalanced 0.5/0.5. Editable via PR 7 UI later.',
    true
);
