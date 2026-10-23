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

## Amendment 1, October 22, before editing these files

The existing two-arm campaign runner (`scripts/comparison/run.mjs`) and its historical protocols
are left unchanged; the three-arm study gets its own runner over the shared modules instead of
`run.mjs` changes. Added:

- `scripts/comparison/study.mjs`, `scripts/comparison/study.test.mjs`: the study runner (freeze,
  setup-failure records and bounded setup retry, retention after inference, scoring, exposure scan).
- `scripts/comparison/checks.mjs`, `scripts/comparison/checks.test.mjs`: a delivered-tree static
  verdict (project lint on the base and on the candidate).
- `scripts/comparison/workspace.mjs`, `scripts/comparison/workspace.test.mjs`: the internal-ablation
  arm writes Swarm's configuration, not OpenCode's.
- `scripts/comparison/fixtures/neutral-smoke.mjs`: the neutral edit-and-test smoke task and its local
  repository, run through the study runner's own launch builder.

`run.mjs`, `run.test.mjs`, `arms.mjs`, `schema.mjs` and `validate.mjs` from the original
declaration are no longer intended edits.

## Amendment 2, October 22, after the held-out block's last launch was scored

The branch's additions left the tracked tree 0.2 MB short of the 6.0 MB headroom the weight check
requires, before any held-out evidence. Added:

- `campaign/corpus/local-mlx/`: the finished corpus, whose payloads were already outside the
  repository and which no code reads, packed whole into `packed-derived/local-mlx-corpus` exactly as
  the local-ollama and fixed-cli corpora were, with a README naming the pack.
- `docs/evidence/2026-10-22-adaptive/test-sensitivity.mjs` and `evaluator-audit.mjs`: scoring tools
  under the declared evidence directory, named here because they were written after the hidden
  results were read.

## Amendment 3, October 23, before editing these files

CI on the branch head hung twice at a 60 s test limit in the "gates after a loop that spent its
wall" tests. Cause, measured: Node's timers can fire up to 1 ms before `Date.now()` shows the full
interval (4 of 4,000 in a local trial), and the loop's per-call deadline aborted only when the
injected clock showed the whole interval elapsed, so an early timer dropped the deadline and a
model call that never returns held the run. Added:

- `src/core/clock.ts`: the contract states that `sleep` resolves no earlier than `now()` plus the
  interval.
- `src/cli-runtime-inputs.ts` and a new `src/cli-runtime-inputs.test.ts`: the system clock keeps
  that contract by re-arming for the remainder, with its timer and time source injectable for the
  test.
- `src/core/loop.ts`, `src/core/loop.test.ts`: the per-call deadline re-arms for the remainder if
  a sleep resolves early, rather than being dropped.
