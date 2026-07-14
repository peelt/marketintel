-- ============================================================
-- 0006 — Reaction Analyser framework v1 (PR 5, the hero)
--
--   1. scoring_frameworks.params — agent tunables as DATA, not code.
--      The settled inclusion threshold (5d drawdown ≥12% OR 1d drop
--      ≥8%) lives here so it can be tuned from observed weeks without
--      a redeploy, and is version-pinned like the criteria.
--   2. reaction framework v1. The composite is calibrated as
--      "overshoot-ness": higher = the market's reaction looks more
--      disproportionate to the earned fundamental damage.
-- ============================================================

alter table public.scoring_frameworks
    add column if not exists params jsonb not null default '{}'::jsonb;

comment on column public.scoring_frameworks.params is
    'Agent-specific tunables (e.g. reaction inclusion thresholds). Version-pinned data, editable without redeploy.';

insert into public.scoring_frameworks (agent_name, version, criteria, params, notes, is_active)
values (
    'reaction',
    1,
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
              "weight": 0.6,
              "direction": "lower_better",
              "sourceQuery": "reaction.news_damage_grade",
              "normalisation": "absolute"
            },
            {
              "key": "leverage_fragility",
              "weight": 0.2,
              "direction": "lower_better",
              "sourceQuery": "reaction.debt_to_ebitda"
            },
            {
              "key": "cash_generation",
              "weight": 0.2,
              "direction": "higher_better",
              "sourceQuery": "reaction.fcf_yield"
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
    'v1. Composite reads as overshoot-ness. LLM grades (news damage, disproportion) are calibrated 0-100 and use absolute normalisation — rank-normalising them would destroy the calibration. Inclusion thresholds in params per the settled decision (tune from observed weeks). Verdict bands live in the agent (code) for v1.',
    true
);
