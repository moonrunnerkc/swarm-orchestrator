# Falsification Corpus Benchmark

This directory contains the benchmark infrastructure for the v7 falsification battery.

## Contents

- `schema.ts` defines corpus entries and ground-truth labels.
- `loader.ts` loads agent-authored verification-run patches from `verification-runs/`.
- `harness.ts` runs the five battery layers against one labeled entry.
- `label-store.ts` and `cli/label.ts` support hand-labeling agent-authored patches.
- `cli/run-benchmark.ts` runs the agent corpus once labels exist.
- `synthetic/` contains the adversarial calibration corpus source and generator.
- `cli/run-synthetic-calibration.ts` runs the synthetic layer-calibration report.

## Agent Corpus

Agent-authored patches require hand labels before benchmark execution:

```bash
node dist/benchmarks/falsification-corpus/cli/label-status.js \
  --corpus verification-runs \
  --labels benchmarks/falsification-corpus/labels
```

Labeling rules are documented in [LABELING.md](LABELING.md).

## Synthetic Calibration

Synthetic patches are generated from tracked TypeScript specs, then materialized as local git repos under `synthetic/<category>/<id>/repo`. The generated repos are ignored by Git because nested `.git` directories are not portable source artifacts.

Run:

```bash
node dist/benchmarks/falsification-corpus/cli/run-synthetic-calibration.js \
  --output benchmarks/falsification-corpus/results/synthetic-calibration-<run-id>
```

Synthetic reports calibrate layer behavior. They are not averaged into agent-authored catch-rate claims.

## CI Contract

The synthetic corpus is a regression fixture for verification-layer behavior. CI runs the regular synthetic categories plus the `under-tested` mutation category and fails unless all 21 broken patches are caught and all 21 clean controls clear without target-layer false positives.

If a verification layer is intentionally relaxed or a new pattern is added, update the synthetic corpus in the same PR and keep the CI assertion at 100%.
