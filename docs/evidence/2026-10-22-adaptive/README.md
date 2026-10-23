# Adaptive decision point and held-out block 1, October 22, 2026

This stage continues the [execution-guided delivery study](../../capability-study-2026-10-22.md).
It adds a compact working state and a bounded decision point to Swarm's controller
(`--adaptive`, experimental; [description](../../adaptive-problem-solving.md)), makes the study
setup dependable, tries the mechanism in a development study, and runs one registered held-out
block of four fresh tasks. Everything ran on `qwen3.6:35b-a3b` through local Ollama; paid
inference $0.

**Bottom line.** Both components are implemented and were exercised live. Over the whole stage
they changed one delivered artifact, a development task, and no held-out artifact. On the
held-out block revised Swarm completed 1 of 4 tasks, the same as its own control and its internal
ablation. OpenCode completed 2 of 4 (3 of 4 after an evaluator audit). Swarm's product verdict
was right on 10 of its 12 launches and falsely accepted 2. Four tasks and single samples support
counts only. This is not a superiority result, and it is not a finished product objective.

## What was built

1. **Working state** (`src/core/working-state.ts`). It is derived from recorded tool calls and
   results, never from prose, and holds:
   - the task and the checks still required;
   - the candidate's digest;
   - landed and refused edits, reads, and searches that matched nothing;
   - the last executions, each with its exit status, record digest and the tree generation it
     ran on;
   - hypotheses, labelled as model claims.

   Observations that predate the current tree are named as such. Repair and continuation briefs
   carry the previous loop's working state.
2. **Decision point** (`src/agent-decision-point.ts`, rule `adaptive-decision-v1`). It fires once
   per loop, at 40 percent of the loop's steps or wall, and chooses one of five actions:
   - continue, at no cost;
   - harness retrieval of code-like names that searches missed, with no model call;
   - one fresh read-only diagnosis, of at most 5 steps, inside the loop's own allowance;
   - a distinguishing execution through the worker's chokepoint, with predictions recorded as
     held or failed;
   - a different implementation, admissible only after two failing edited trees.

   An unverifiable answer is discarded. The gates, acceptance, scope and verification reserve are
   untouched. The deterministic tests are listed in the description.

## Setup dependability

- **Launch configurations.** `scripts/comparison/launch-config.mjs` builds each one, and
  `validateLaunch` checks it before dispatch: pinned executables and build-tree digest, a built
  PATH, a fresh home, and an access probe run inside the arm's own Seatbelt profile.
- **Neutral smoke.** The smoke exercises that same builder for all four arms. Smoke-7, on the
  held-out build, passed every criterion.
- **PR #95's two setup failures.** The wrong patch root and the missing pinned-OpenCode PATH now
  have regression tests (`launch-config.test.mjs`).
- **Zero-inference setup failures.** These are recorded apart, as `*.setup-N.json`, and retried at
  most twice after a recorded correction:
  - development run 1: the gate-plan check left files in the arm's home;
  - held-out: no base lockfile, which meant Swarm could not install in its own fresh checkout;
  - held-out: a TMPDIR too long for a macOS socket path.

  Each was corrected in the harness and committed with a test. Once inference began, no outcome
  was retried.
- **Equal permissions.** Every arm ran under one profile that denies the hidden material,
  mirrors, other launches and the project checkouts. Each arm's own probe showed the canary and
  other launches unreadable and the workspace writable. The network was unrestricted for every
  arm alike, and the exposure scan found no hits.
- **Evaluator validation.** The evaluator author, a separate agent working only in the sealed
  directory, validated every evaluator against the base, the reference, at least two faulty
  controls and one correct alternative, with preservation cases beyond the task text
  ([`heldout/sealed/validation-log.jsonl`](heldout/sealed/validation-log.jsonl)).

## Development study (exposed tasks; development material only)

Details are in [development-launches.md](development-launches.md).

- Run 1 stopped after three launches on two harness and product defects.
- Run 2 delivered no notice: every diagnosis answer was refused for its shape.
- Run 3 paired against run 2's controls gave 1 win (sinon v2) and 3 ties. On sinon the notice
  reached the worker at step 16, before any edit, with three locations the harness had read, and
  the launch delivered a complete change whose 8 added tests fail on base source.

That is the one artifact the mechanism plausibly changed. It is a single sample, and no causal
claim is made.

## Held-out block 1

Selection, evaluator preparation and registration came before the first launch:
[selection rule](heldout-selection-rule.md), [protocol](heldout-protocol.md) and
[launch log with both setup corrections](heldout-launches.md). Hidden results were read only
after the sixteenth launch was scored. Resources were 720.5 s of launch wall per launch for every
arm, with 60 s of that as Swarm's verification reserve.

Columns: complete delivery as registered, the hidden evaluator, the visible check plus project
tests, the number of sensitive tests (fail on base source, pass on delivered source; `n/a` where
no added tests are scored), and the product's own verdict.

| Task | Arm | Complete | Hidden | Visible + project tests | Sensitive tests | Product verdict | Wall | Tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| p-queue compatibility | `swarm` | no | pass | fail | n/a | not acceptable | 517 s | 2,617,259 |
| p-queue compatibility | `swarm-control` | no | fail | fail | n/a | not acceptable | 661 s | 2,185,021 |
| p-queue compatibility | `swarm-direct` | no | fail | fail | n/a | not acceptable | 311 s | 1,254,094 |
| p-queue compatibility | `opencode` | no | fail | fail | n/a | none | 720 s | 5,545,190 |
| fastify refactor | `swarm` | no | fail | fail | n/a | not acceptable | 601 s | 855,622 |
| fastify refactor | `swarm-control` | no | fail | fail | n/a | not acceptable | 602 s | 2,823,082 |
| fastify refactor | `swarm-direct` | no | fail | fail | n/a | not acceptable | 224 s | 1,207,026 |
| fastify refactor | `opencode` | no (audited: yes) | fail | pass | n/a | none | 282 s | 1,911,860 |
| p-limit bug fix | `swarm` | no | fail | pass | 6 | acceptable | 411 s | 1,984,729 |
| p-limit bug fix | `swarm-control` | **yes** | pass | pass | 6 | acceptable | 279 s | 1,048,345 |
| p-limit bug fix | `swarm-direct` | **yes** | pass | pass | 5 | acceptable | 158 s | 829,912 |
| p-limit bug fix | `opencode` | **yes** | pass | pass | 5 | none | 301 s | 1,586,415 |
| p-limit feature | `swarm` | **yes** | pass | pass | 5 | acceptable | 445 s | 2,207,431 |
| p-limit feature | `swarm-control` | no | fail | pass | 0 | acceptable | 399 s | 1,751,043 |
| p-limit feature | `swarm-direct` | no | fail | fail | 0 | not acceptable | 266 s | 746,428 |
| p-limit feature | `opencode` | **yes** | pass | pass | 3 | none | 261 s | 1,618,095 |

What failed where:

- **p-queue.** The `swarm` change passes every hidden check, but one xo lint error in its own
  `test/basic.ts` fails `npm test`; the product refused it for that reason. OpenCode's change
  leaves an unused `TimeoutError` import that fails `tsc`, and it was killed at the deadline.
- **fastify.** No Swarm arm finished the rename inside the wall. The `swarm` arm read files for
  38 steps and never edited; the other two edited partly. OpenCode's only hidden failure is
  discussed under the evaluator audit.
- **p-limit bug fix.** The `swarm` change lets a synchronous throw escape uncaught instead of
  rejecting the call, which is a preservation case the task text names.
- **p-limit feature.** The `swarm-control` change added no tests and fails the rejecting path
  (`entry[1][2] is not a function`).

**Pairs on complete delivery.** Registered evaluator first; the audited reading changes only the
fastify-versus-OpenCode cells:

| Pair | Registered: W / L / T | Audited: W / L / T |
| --- | --- | --- |
| `swarm` vs `swarm-control` | 1 / 1 / 2 | 1 / 1 / 2 |
| `swarm` vs `swarm-direct` (internal ablation) | 1 / 1 / 2 | 1 / 1 / 2 |
| `swarm` vs `opencode` | 0 / 1 / 3 | 0 / 2 / 2 |
| `swarm-control` vs `swarm-direct` | 0 / 0 / 4 | 0 / 0 / 4 |
| `swarm-control` vs `opencode` | 0 / 1 / 3 | 0 / 2 / 2 |
| `swarm-direct` vs `opencode` | 0 / 1 / 3 | 0 / 2 / 2 |

- Wins: the `swarm` arm on p-limit feature, against both other Swarm arms.
- Losses: the `swarm` arm on p-limit bug fix, against all three other arms.
- There were no incomplete pairs and no infrastructure failures after inference.

**What the decision point did on held-out tasks.** It reached 7 decisions; see
[`heldout/decision-accounts/`](heldout/decision-accounts/).

- In 6 it chose continue, because edits had landed and no check had failed at the current tree.
  These came in the task and first repair loops of p-queue and both p-limit tasks; each cost no
  model call, about 60 ms, and gave no notice.
- In 1 it chose retrieval: on fastify at step 16, with no edit yet, it ran whole-word searches for
  three old names the loop had missed (255 ms, 0 tokens) and gave a notice. No edit followed
  before the wall.
- No held-out diagnosis ran, so no held-out artifact was changed by a notice.

The `swarm` arm's repair briefs carried the previous loop's working state. With one sample, the
p-limit win and loss against the control cannot be attributed to that, as against sampling.

**Initial versus delivered candidate.** Four Swarm launches have a rebuilt first checked
candidate ([`heldout/initial-scores/`](heldout/initial-scores/)):

- **p-limit feature, `swarm`.** The initial candidate failed hidden and visible; the delivered
  one is complete. This is a repair gain.
- **p-limit bug fix, `swarm-control`.** The initial candidate passed hidden but failed the
  project tests; the delivered one is complete. This is a repair gain.
- **p-limit bug fix, `swarm`.** The initial candidate failed `tsd` and the project tests. Repair
  made both pass, but the synchronous-throw regression was already in the initial candidate (a
  [probe](heldout/initial-scores/p-limit-bugfix-limit-function-clear-queue.swarm.preservation-probe.json)
  confirms it). Repair turned a refused candidate into a falsely accepted one; it caused no damage.
- **p-limit feature, `swarm-control`.** Two max-steps loops left the delivered candidate equal to
  the initial one.

The remaining eight Swarm launches do not have a rebuilt initial candidate. Five delivered their
first candidate: every `swarm-direct` launch, by design, plus the fastify `swarm` launch, which
never edited. For three, the brief truncated the diff, so the first candidate cannot be rebuilt.
No repair damage was observed where it could be measured.

**Verdict accuracy.** Swarm's verdict matched complete delivery on 10 of 12 launches, with 0
false refusals and 2 false accepts:

- p-limit bug fix, `swarm`: no gate exercises the synchronous-throw case;
- p-limit feature, `swarm-control`: no requested tests were added, and the rejecting path is
  wrong while the visible check passes.

OpenCode reports no verdict. It claimed success on 3 launches, of which 2 are complete
(registered) or 3 (audited).

**Usage, wall and verification.**

| Arm | Wall, total | Tokens, total | Unknown-usage calls |
| --- | --- | --- | --- |
| `swarm` | 1,974 s | 7,665,041 | 1 |
| `swarm-control` | 1,942 s | 7,807,491 | 2 |
| `swarm-direct` | 960 s | 4,037,460 | 0 |
| `opencode` | 1,563 s | 10,661,560 | 0 |

Swarm's time outside its worker loops covers goal setup, gates, independent verification and
repair setup. It ranged from 46 s to 401 s per launch, a median of about 115 s; the largest was
p-queue control, whose suite takes about 35 s per run. There was no human intervention during any
launch. The two setup corrections were made between launches, before the affected cells'
inference.

**Evaluator audit, after the block** ([`evaluator-audit.mjs`](evaluator-audit.mjs),
[result](heldout/audit/fastify-rule-audit.json)). The fastify rule "nothing still points at an
old file name" counts a quoted old name anywhere. OpenCode's added test asserts
`existsSync(join(base, 'types', 'serverFactory.d.ts'))` is `false`, which checks that the old file
is gone, and that line was its only hidden failure. Under a rule amended to ignore a match inside
`existsSync(`, the verdicts are:

- the reference: pass;
- the correct alternative: pass;
- all four faulty controls: fail;
- the three Swarm deliveries: unchanged;
- OpenCode's delivery: pass.

The registered verdict stands in the primary table, and the audited one is reported beside it.

## Evidence

- **Records.**
  - Held-out: [`heldout/packed-derived/records`](heldout/packed-derived/records).
  - Development runs 1 to 3: `development/run-*/packed-derived/records`.
  - Smoke: `smoke-7/packed-derived/records`.

  Each stage has its frozen manifest beside it. Restore with
  `node scripts/evidence-pack.mjs restore <pack>`.
- **Scored outputs.**
  - Held-out delivered patches, decision accounts, test sensitivity, initial candidates and their
    scores: [`heldout/`](heldout/).
  - Registered results computed from the records: [`heldout/results.json`](heldout/results.json),
    by [`heldout-results.mjs`](heldout-results.mjs).
  - Released evaluators, references and controls: [`heldout/sealed/`](heldout/sealed/).
- **Sessions.** Every Swarm session ledger and blob, every OpenCode event stream (its stdout,
  kept as a command-log blob) and every command log of the stage, together with the evaluator
  author's validation blobs, is on the branch
  `evidence/2026-10-22-adaptive-sessions` as
  `docs/evidence/2026-10-22-adaptive/sessions/adaptive-stage-sessions.tar.xz`:
  - 5,922,956 bytes, sha256 `52411347d4e2e3645f016c93389072464f016a7b73ea140f82853ffae20ae965`;
  - the study root without the canary file;
  - kept off this tree to hold the weight headroom.

## Before any superiority claim

- More samples. Each held-out cell ran once on a sampled model, and the within-Swarm differences
  arose where the decision point did nothing visible.
- A larger, sealed portfolio. The [preparation note](portfolio-preparation.md) sets out three
  separate studies (same-model orchestration, product comparison, local-model adapters) and a
  computed ceiling of about 19 agent-hours.
- Two capability gaps the block exposed:
  - large mechanical edits run out of wall;
  - the product accepts changes whose preservation cases or requested tests no gate exercises.
- Evaluator audits before launch, including an absence-assertion control.
