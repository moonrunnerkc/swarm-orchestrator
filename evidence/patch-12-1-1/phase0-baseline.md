# Patch 12.1.1, Phase 0: baseline

Date: 2026-07-22
HEAD: c1c394e1d3c68316a6e838731d8906f9e0455541 (main)
Tree: clean before any edit.

## Gate battery

| Gate | Result |
|---|---|
| npm ci | clean install |
| npm run build | pass (copy-non-ts-assets: 7 files) |
| npm run test:ci | 2338 passing, 45 pending, 0 failing |
| npm run typecheck | pass |
| npm run lint | pass |
| npm run badges:check | pass ("README badges are up to date") |
| npm run fp-registry:check | pass (1 entry, jeduden-mdsmith-232 NEUTRALIZED) |
| npm run promotions:check | pass (gate-eligible=0, advisory=10) |
| npm run block-policy:check | pass (block-eligible=8) |
| bash scripts/loc-budget-gate.sh | pass (48897 / budget 48897) |

## Notes

- DECISIONS.md does not exist anywhere in the repo at baseline. The
  contract instructs reading it and appending an entry for the
  builtin-exemption behavior change; the file will be created at the
  repo root with that entry in Phase 1.
- LOC budget is exactly at the ceiling (48897/48897); any src/ line
  growth in Phase 1 requires the ratchet update in Phase 5.
