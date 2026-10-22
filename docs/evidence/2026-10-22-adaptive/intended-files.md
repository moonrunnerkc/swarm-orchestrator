# Intended files, adaptive problem-solving stage

Declared on October 22, 2026, before any source edit of this stage, on the branch of draft
PR 95 (`feat/execution-guided-delivery-2026-10-22`, head `4544df018`). Additional files are
recorded below as dated amendments before they are edited.

## Product

- `src/core/working-state.ts`, `src/core/working-state.test.ts`: compact working state derived
  from recorded tool calls and results (pure, no ambient inputs).
- `src/core/loop.ts`, `src/core/loop.test.ts`: one injected decision point per loop, charged to
  that loop's own step, token and wall allowance.
- `src/agent-decision-point.ts`, `src/agent-decision-point.test.ts`: the decision policy,
  deterministic retrieval, the bounded focused diagnosis, harness-run distinguishing executions
  and the decision records.
- `src/agent-run.ts`, `src/agent-run.test.ts`: wiring, and the working state carried into repair
  and continuation briefs.
- `src/cli.ts`, `src/cli-options.ts`, `src/cli-options.test.ts`, `src/cli-verify-options.ts`:
  the experimental `--adaptive` option.

## Experiment harness

- `scripts/comparison/launch-config.mjs`, `scripts/comparison/launch-config.test.mjs`: one launch
  builder for every arm, with pinned absolute executables, digest-resolved inputs, the shared
  execution sandbox profile and zero-inference setup validation.
- `scripts/comparison/arms.mjs`, `scripts/comparison/arms.test.mjs`: the internal-ablation arm and
  the frozen `--adaptive` flag.
- `scripts/comparison/run.mjs`, `scripts/comparison/run.test.mjs`: use of the launch builder,
  setup-failure records and bounded setup retry, external task modules, per-manifest correction
  allowance.
- `scripts/comparison/schema.mjs`, `scripts/comparison/validate.mjs`: the schema and validation
  support those require.

## Documentation and evidence

- `docs/adaptive-problem-solving.md`: experimental behavior and limitations.
- `docs/capability-study-2026-10-22.md`: appended continuation.
- `README.md`: one short link.
- `docs/evidence/2026-10-22-adaptive/`: protocol, selection rule, records, scores and report.
