-- ============================================================
-- 0012 — Geopolitical framework v1 (PR 10, the last desk)
--
-- The Geopolitical desk grades how each name in a curated,
-- cross-sector universe is POSITIONED for the current geopolitical
-- backdrop. A fresh weekly macro read (web-researched, with
-- confidence per theme) grounds three LLM-calibrated 0-100 grades
-- per name; all sub-signals are "absolute" (the grade IS the score,
-- comparable across reports and time — and a composite of
-- all-absolute signals stays absolute, no rank contamination).
-- Classifications derive from absolute facts in code (the metals
-- lesson); the composite only ranks the league table.
--
--   positioning  0.55  beneficiary (high) vs. threatened (low)
--   resilience   0.35  how insulated (diversification, hedging)
--   materiality  0.10  how much geopolitics bears on it at all
-- ============================================================

insert into public.scoring_frameworks (agent_name, version, criteria, params, notes, is_active)
values (
    'geopolitical',
    1,
    '{
      "criteria": [
        {
          "key": "positioning",
          "weight": 0.55,
          "subSignals": [
            {
              "key": "positioning_grade",
              "weight": 1.0,
              "direction": "higher_better",
              "normalisation": "absolute",
              "sourceQuery": "geopolitical.positioning_grade"
            }
          ]
        },
        {
          "key": "resilience",
          "weight": 0.35,
          "subSignals": [
            {
              "key": "resilience_grade",
              "weight": 1.0,
              "direction": "higher_better",
              "normalisation": "absolute",
              "sourceQuery": "geopolitical.resilience_grade"
            }
          ]
        },
        {
          "key": "materiality",
          "weight": 0.10,
          "subSignals": [
            {
              "key": "materiality_grade",
              "weight": 1.0,
              "direction": "higher_better",
              "normalisation": "absolute",
              "sourceQuery": "geopolitical.materiality_grade"
            }
          ]
        }
      ]
    }'::jsonb,
    '{}'::jsonb,
    'Geopolitical v1: three prospectus-free absolute grades (positioning 55, resilience 35, materiality 10) against a fresh weekly macro read. Labels (beneficiary/mixed/at_risk/insulated) derive from absolute facts in code; low-materiality names are marked insulated, never forced into a call.',
    true
)
on conflict do nothing;
