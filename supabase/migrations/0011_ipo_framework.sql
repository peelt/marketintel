-- ============================================================
-- 0011 — IPO framework v1 (PR 8)
--
-- The IPO desk evaluates fresh S-1/F-1 registrants from their own
-- prospectuses. Every sub-signal is an LLM-calibrated 0-100 grade
-- with normalisation "absolute" — the grade IS the score, comparable
-- across reports and time, and a composite of all-absolute signals
-- stays absolute (no rank contamination). Classifications derive
-- from absolute facts in code (the metals lesson), never from the
-- blended composite; the composite only ranks the league table.
--
--   business_quality  0.25  durability of the disclosed model
--   growth_prospects  0.25  disclosed trajectory, not TAM claims
--   risk_profile      0.20  higher = more manageable risk factors
--   governance        0.15  dual-class / control / related-party
--   offering_terms    0.15  proceeds clarity, selling holders, dilution
-- ============================================================

insert into public.scoring_frameworks (agent_name, version, criteria, params, notes, is_active)
values (
    'ipo',
    1,
    '{
      "criteria": [
        {
          "key": "business_quality",
          "weight": 0.25,
          "subSignals": [
            {
              "key": "business_quality_grade",
              "weight": 1.0,
              "direction": "higher_better",
              "normalisation": "absolute",
              "sourceQuery": "ipo.business_quality_grade"
            }
          ]
        },
        {
          "key": "growth_prospects",
          "weight": 0.25,
          "subSignals": [
            {
              "key": "growth_grade",
              "weight": 1.0,
              "direction": "higher_better",
              "normalisation": "absolute",
              "sourceQuery": "ipo.growth_grade"
            }
          ]
        },
        {
          "key": "risk_profile",
          "weight": 0.20,
          "subSignals": [
            {
              "key": "risk_grade",
              "weight": 1.0,
              "direction": "higher_better",
              "normalisation": "absolute",
              "sourceQuery": "ipo.risk_grade"
            }
          ]
        },
        {
          "key": "governance",
          "weight": 0.15,
          "subSignals": [
            {
              "key": "governance_grade",
              "weight": 1.0,
              "direction": "higher_better",
              "normalisation": "absolute",
              "sourceQuery": "ipo.governance_grade"
            }
          ]
        },
        {
          "key": "offering_terms",
          "weight": 0.15,
          "subSignals": [
            {
              "key": "offering_terms_grade",
              "weight": 1.0,
              "direction": "higher_better",
              "normalisation": "absolute",
              "sourceQuery": "ipo.offering_terms_grade"
            }
          ]
        }
      ]
    }'::jsonb,
    '{"windowDays": 30, "maxIssuers": 25}'::jsonb,
    'IPO v1: five prospectus-grounded absolute grades (business 25, growth 25, risk 20, governance 15, offering terms 15). Labels derive from absolute facts in code; shells/blank-checks are set aside, never graded as operating businesses.',
    true
)
on conflict do nothing;
