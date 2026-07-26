-- ============================================================
-- 0015 — Reaction framework v2: drop the structurally-dead
-- fundamentals signals (2026-07 scope reduction)
--
-- A live-data audit of every filed edition found earned_damage's two
-- fundamentals sub-signals null on 39/39 items, both markets:
--   - leverage_fragility read total_debt/ebitda and cash_generation read
--     free_cash_flow/market_cap from financials_snapshot — but Finnhub's
--     basic-financials payload carries no absolute debt/EBITDA/OCF figures,
--     so those columns were null in 100% of rows the source ever wrote.
--   - The engine already redistributed their weight (every item filed at a
--     uniform 82% coverage), so v2 changes no ranking — it makes the
--     framework honest: the desk now claims exactly the signals it can
--     resolve, and coverage reads 100% instead of a permanent 82%.
--
-- earned_damage keeps its 0.45 criterion weight with news_damage_severity
-- as its only sub-signal — the same effective weighting the redistribution
-- already produced. Params are unchanged (settled thresholds).
--
-- Historical reports stay pinned to v1 (frameworks are immutable data).
-- ============================================================

update public.scoring_frameworks
set is_active = false
where agent_name = 'reaction' and is_active;

insert into public.scoring_frameworks (agent_name, version, criteria, params, notes, is_active)
values (
    'reaction',
    2,
    '{
      "criteria": [
        {
          "key": "excess_decline",
          "weight": 0.25,
          "subSignals": [
            {
              "key": "drop_vs_universe_5d",
              "weight": 0.7,
              "direction": "higher_better",
              "sourceQuery": "reaction.excess_drop_5d"
            },
            {
              "key": "volume_spike",
              "weight": 0.3,
              "direction": "higher_better",
              "sourceQuery": "reaction.volume_spike"
            }
          ]
        },
        {
          "key": "earned_damage",
          "weight": 0.45,
          "subSignals": [
            {
              "key": "news_damage_severity",
              "weight": 1.0,
              "direction": "lower_better",
              "sourceQuery": "reaction.news_damage_grade",
              "normalisation": "absolute"
            }
          ]
        },
        {
          "key": "repricing_depth",
          "weight": 0.30,
          "subSignals": [
            {
              "key": "discount_to_52w_high",
              "weight": 0.5,
              "direction": "higher_better",
              "sourceQuery": "reaction.discount_to_52w_high"
            },
            {
              "key": "disproportion_grade",
              "weight": 0.5,
              "direction": "higher_better",
              "sourceQuery": "reaction.overshoot_grade",
              "normalisation": "absolute"
            }
          ]
        }
      ]
    }'::jsonb,
    '{
      "inclusion": { "drawdown5dPct": 12, "drop1dPct": 8 }
    }'::jsonb,
    'v2. Drops leverage_fragility + cash_generation: their financials_snapshot inputs (total_debt, ebitda, free_cash_flow) were null in every row the source ever produced, so both signals were null on every filed item and the engine redistributed their weight anyway — v2 pins that reality. Effective weights are unchanged; coverage now reads honestly (100% when the news grade lands). Composite still reads as overshoot-ness; LLM grades stay absolute-normalised.',
    true
);
