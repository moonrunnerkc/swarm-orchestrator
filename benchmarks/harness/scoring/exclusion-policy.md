# Exclusion Policy

## Rule

A run with a missing `session-state.json` is classified as
`INFRASTRUCTURE_FAILURE` and **counted** in all statistical
calculations with `rubric_score = 0` and `cost` equal to however many
premium requests were consumed before death (read from
`cost-attribution.json` if present, else 0).

## Rationale

Excluding failed infrastructure runs inflates success metrics. The
orchestrator's reliability is part of its value proposition, so
infrastructure failures must be reflected in the cost-per-rubric-point
and mean-rubric-score metrics.

## Implementation

`compute_ci.py` applies this rule by:

1. Scanning each run directory for `session-state.json`.
2. If missing, emitting a synthetic score record with `rubric_score = 0`
   and `cost = sum(cost-attribution.json.perStep[].actualPremiumRequests)`
   if available, else 0.
3. Logging a warning with the run directory.
4. Failing loudly if a run directory contains *neither*
   `session-state.json` *nor* `cost-attribution.json` — this indicates
   a corrupted collection, not an infrastructure failure.

No runs are silently excluded. No partial-inclusion logic.
