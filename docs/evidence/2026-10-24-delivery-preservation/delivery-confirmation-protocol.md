# Delivery confirmation on the feature task, registered before its first launch

October 24, 2026. This is not a fresh result. It tests one correction found by the mechanism
study, and it is not a further study of the review.

## What the mechanism study found

On `ufo-feature-filter-query`:
- seven repairs, in three of four launches, had brought lint down to the base's own finding;
- task acceptance passed on each of them;
- the ratchet rolled every one back, because the file-set gate failed on `README.md`.

The cause is the `build` gate. It runs the project's `automd && unbuild` in the workspace, and
automd writes the new function's documentation into `README.md`. The correction (commit
`d5a666588`) puts back whatever a check writes to the workspace, and names it on the gate's
record.

## Launches

- Task: `ufo-feature-filter-query`, unchanged.
- Arms: `swarm-control` (`--adaptive`) and `swarm` (`--adaptive --review executable`).
- Samples: one each, two launches, in that order.
- Conditions: the mechanism study's budgets, model and runner rules, on a build of `d5a666588`.
- Every launch runs, nothing changes between them, and only liveness is watched until both end.

## Reading

Per launch:
- whether any repair was rolled back for a file a check wrote;
- the hidden verdict and the stricter audit's reading;
- the product's verdict, and whether it is a correct accept, a correct refusal, a false accept or
  a false refusal;
- cost.

With one sample per arm this can show the defect gone or still present. It cannot show a rate.
