# Generated-check control and repair, 2026-10-18: protocol

Registered before the first model-powered launch of this work. Every launch, in order, goes in
[launches.md](launches.md), entered before it starts, failed starts and accidental launches
included. This file is not edited after the first launch; a change of plan is an amendment
appended below the line at the end, dated, before the launches it affects. The closed protocol of
[../../2026-10-17/repair-detection-live/](../../2026-10-17/repair-detection-live/protocol.md) and
its results stand unchanged; nothing here reinterprets them.

## Status

**Development records on an exposed task**, except the paired comparison in D. The mime task, its
retained faulty patch, both deletion-based repairs and the evaluator's audit are known to the
people developing Swarm, and the task is a public change that may be in the model's training
data. The development contract ([development-checks.mjs](development-checks.mjs)) was written by
those developers knowing all of that; it is engineered coverage, and a run that repairs against
it shows repair with supplied checks, never discovery. Known evaluator cases informed the
development analysis and are not "unseen" evidence.

## Allowance and accounting

- **At most eight model-powered launches, 15 minutes each end to end, and 120 agent-minutes in
  all**, whichever comes first. Agent minutes are the arm's own process wall, from spawn to exit
  or kill. Workspace preparation, builds and scoring are reported apart.
- One launch owner (the session that registered this protocol), one launch at a time, one model
  resident, and no test suite running beside a launch. A launch started by mistake and a launch
  attempt that fails before reaching a model are counted and entered.
- Local only: Ollama 0.32.14 at `http://127.0.0.1:11434/v1` serving `qwen3.6:35b-a3b` (digest
  `096fdbd02fe6`), already on the machine. No paid API and no model download.
- Thinking off in both arms: Swarm's `local_thinking = false`; OpenCode's model options as the
  comparison harness writes them (`reasoningEffort: "none"`, `enable_thinking: false` both ways,
  `top_p: 0.95`, output cap 8192). OpenCode 1.14.48, configured by
  `scripts/comparison/workspace.mjs` `writeArmConfiguration`, run as `opencodeArgv` runs it.
- The product build: the commit that registers this protocol, whose `src/` is the tree
  `36e4137ec` passed `npm run gates` on (462 files, 4448 tests passed, 29 skipped), built into
  `~/.cache/swarm-comparison/tools/swarm-<commit>` with `npm ci` and `npm run build`. Node 24.15.0.
- The task: mime at `953ae3ebc59c387064f3760b73085eff6760a7f6`, upstream fix
  `d7871f3bac120df5e4776e7c395b39d0d8e7b562` (evaluator only). The injected candidate is the
  retained faulty patch, `sha256:06282e598660d71a03abc2c7dd04df6da67674572d01430aa7f5a0a885071af2`.
- Resource limits: a 15-minute kill for every launch. Swarm runs with `--max-wall-minutes 14`,
  `--max-tokens 8000000` (a safety bound, not binding at this wall), `--install --lockfile
  package-lock.json`. OpenCode has no wall or token flag of its own and runs to the 15-minute kill;
  it gets no external correction. The arms are matched on the wall, not on tokens, and the
  records say so.

## Allocation

| launches | purpose | condition |
| --- | --- | --- |
| 2 | A: matched development repair, Swarm and OpenCode | none; both run whatever the first gives |
| 1 | B: autonomous seeded detection and repair | after A |
| 1 | C: ordinary run from the original base | B met |
| 2 | D: fresh paired comparison, Swarm and OpenCode | C met; its task and evaluator registered by amendment before either arm |
| 1 | development retry | after a launch whose trace names a concrete blocker, a product correction with its regression lands, and the ledger names both |
| 1 | infrastructure replacement | a launch invalid for an infrastructure reason, investigated and entered first |

These are ceilings. An unchanged build is never launched again for another draw, and a
conditional allocation is not spent when its condition is unmet.

## A: matched development repair

Both arms start from the same tree: the base, then a commit holding the visible check and the
three development checks, then the retained faulty patch's change to `src/Mime.ts` (Swarm's first
implementation loop is answered by the proxy with those files; OpenCode's working tree holds them
before it starts). Both get the task text and can read and run the same four checks by the same
commands; Swarm's supplied contract holds them, OpenCode's prompt names them
([run.mjs](run.mjs)). Neither is given the evaluator. Swarm runs without `--plan-checks`.

Validated with no model first ([development-contract-validation.json](development-contract-validation.json)):
the contract fails the base, the faulty candidate and both deletion repairs, and passes the
upstream fix.

Recorded for each arm: whether the delivered tree passes the four checks (the product's own final
verification for Swarm; the same commands on a fresh checkout of the exact patch for both), whether
the arm touched the checks, the project suite, and the evaluator's verdict on the exact final
patch ([score.mjs](../../2026-10-17/repair-trust-live/score.mjs)). This is a diagnostic comparison
on an exposed task: a difference can suggest where a problem lies; one pair cannot establish its
cause, and neither result is benchmark evidence.

## B: seeded detection and repair

`run.mjs --arm swarm --mode seeded`: the injected candidate, the ordinary visible check only, and
`--plan-checks`. The development checks are not supplied. Planner requests are scanned for
exposure (`../../2026-10-17/planned-check-live/scan-exposure.mjs`). Recorded apart, each yes or
no with its record: whether the planner produced a useful check; whether its program exercised the
intended behaviour; whether admission treated it correctly; whether it found the planted omission
(it rejects the faulty candidate and accepts the upstream fix, read by
`../../2026-10-17/planned-check-live/verify-checks.mjs`); whether repair made the correct change;
whether preserved behaviour stayed intact; whether the evaluator accepts the exact delivered patch.

Met when a generated check found the omission, repair fixed it, the product's final verification
passed the visible check and the project's tests, and the evaluator accepts the exact final patch.

## C: ordinary run

`run.mjs --arm swarm --mode ordinary`, only if B was met. Read by the same evaluator.

## D: fresh paired comparison

Only if C was met. Its task, a task not used to tune this work, and its evaluator are registered
by amendment before either arm, run through `scripts/comparison/` as its harness runs a pair.
Both results are reported, failures included.

---

## Amendments

### 1. 2026-10-18, after launch 3, before launch 4

- **The development-retry slot is spent on B once more**, on `2beb86532`, whose only change
  touching a run is in the planner's answers: while no relation is declared, the declaration and
  base-trial answers name `declare_planned_relation` for a rule that says one text behaves like
  another. Launch 3's trace names the blocker ([launches.md](launches.md)). The task, the injected
  candidate, the supplied visible check, the model and every setting stay as they were.
- **A was run as registered**: launch 1 (Swarm) delivered a patch the evaluator accepts; launch 2
  (OpenCode) ended on a rejected permission 34 s in. Neither is run again.
- C and D stay conditional on B. After launch 4 the remaining slot is the infrastructure
  replacement only.
