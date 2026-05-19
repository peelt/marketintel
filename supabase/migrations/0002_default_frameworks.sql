-- ============================================================
-- marketintel — default scoring frameworks
--
-- PR 3 seeds only the dividend framework. The IPO, geopolitical,
-- energy and metals frameworks ship in their own PRs (4–7) so each
-- framework is designed alongside the agent that consumes it,
-- rather than committed speculatively here.
-- ============================================================

insert into public.scoring_frameworks (agent_name, version, criteria, notes, is_active)
values (
    'dividend',
    1,
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
              "weight": 0.4,
              "direction": "lower_better",
              "sourceQuery": "dividend.yield_zscore_24m"
            },
            {
              "key": "ocf_yoy_change",
              "weight": 0.3,
              "direction": "higher_better",
              "sourceQuery": "dividend.ocf_yoy_change"
            },
            {
              "key": "eps_revision_trend",
              "weight": 0.3,
              "direction": "higher_better",
              "sourceQuery": "dividend.eps_revision_trend"
            }
          ]
        }
      ]
    }'::jsonb,
    'Initial v1 framework. Weights chosen so coverage dominates (40%) and a yield-spike (zscore vs 24m) reads as a cut risk warning rather than a buy signal. Tune after first three weeks of reports.',
    true
);
