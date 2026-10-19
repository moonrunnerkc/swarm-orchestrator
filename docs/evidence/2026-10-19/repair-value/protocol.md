# Repair value and ordinary completion, 2026-10-19: protocol

Registered before the first model-powered launch of this work. Every launch, in order, goes in
[launches.md](launches.md), entered before it starts, failed starts and accidental launches
included. This file is not edited after the first launch; a change of plan is an amendment
appended below the line at the end, dated, before the launches it affects. The closed protocols of
[../../2026-10-18/checking-semantics/](../../2026-10-18/checking-semantics/protocol.md) and the
ones before it, and their results, stand unchanged; nothing here reinterprets them.

## Status

The ordinary runs are **development records on an exposed task** (mime): the task, its retained
faulty patch, the earlier launches' candidates and both evaluators are known to the people
developing Swarm, and the change is public and may be in the model's training data. Two passing
runs would be two bounded observations of one frozen build, never proof of general completion. A
paired comparison, if it runs, is one task from another repository; it can show a difference on
that task, not superiority.

## Allowance and accounting

- **At most five model-powered launches, 15 minutes each end to end, and 75 agent-minutes in
  all**, whichever comes first. Agent minutes are the arm's own process wall, from spawn to exit
  or kill. Workspace preparation, builds and scoring are reported apart.
- One launch owner (the session that registered this protocol), one launch at a time, one model
  resident, and no test suite or other heavy job running beside a launch. A launch started by
  mistake and a launch attempt that fails before reaching a model are counted and entered.
- Local only: Ollama 0.32.14 at `http://127.0.0.1:11434/v1` serving `qwen3.6:35b-a3b` (digest
  `096fdbd02fe6`), already on the machine. No paid API and no model download. Thinking off:
  Swarm's `local_thinking = false`, written by the driver's `swarmConfigurationText`; for a
  comparison's OpenCode arm, the comparison harness's own configuration (`writeArmConfiguration`).
- **The product build:** the commit that registers this protocol, whose `src/`, `scripts/` and
  lockfile are the tree of `a1e6c9608` (on which `npm run gates` ran, in a clean full-history clone;
  its result is in [verification.md](verification.md)), cloned into
  `~/.cache/swarm-comparison/tools/swarm-<commit>` and built there with `npm ci` and
  `npm run build`. Node 24.15.0. Before the first launch, the deterministic O1 replay and the
  relation-limit scenario are run through that built `dist/cli.js` and recorded.
- **The driver:** `../../2026-10-18/generated-check-control/run.mjs` unchanged
  (`sha256:3d2061e7f73154dd091254fe5b55ff534a11501993a9d58497336e31eabb92c6`), `--arm swarm
  --mode ordinary`: a clean clone of the original base with the visible check committed, nothing
  injected, the supplied contract holding the visible check only, `--plan-checks`, `--install
  --lockfile package-lock.json`, `--max-wall-minutes 14`, `--max-tokens 8000000` (a safety bound),
  and a 15-minute kill. It closes the arm's stdin and records every exchange through its proxy.
- **The task:** mime at `953ae3ebc59c387064f3760b73085eff6760a7f6`, the task text and visible check
  of `scripts/pilot/tasks-2026-10-17.mjs`, unchanged, as O1 and O2 ran it.
- **Model-visible inputs:** the task text, the repository at its base with the visible check, and
  what the product itself says. No development or audit check, evaluator file, reference patch,
  earlier candidate or external score is in a workspace or a request; planner requests are scanned
  for exposure (`../../2026-10-17/planned-check-live/scan-exposure.mjs`).

## The evaluation, frozen before the first launch

All of it runs after a launch has finished, apart, on fresh checkouts of the original base, and
none of it is given to the product or decides what the product delivered.

1. **The delivered patch:** the frozen evaluator (`../../2026-10-17/repair-trust-live/score.mjs
   --task mime`, `sha256:f05f798bf045...`: hidden tests, project tests and the 113-case audit) and
   the expanded audit (`../../2026-10-18/checking-semantics/validate-expanded-audit.mjs --patch`,
   `sha256:264b9daca769...`, with `expanded-audit.mjs` `sha256:46b94e35e460...`). A run **passes
   the expanded external evaluation** only if the frozen evaluator passes and the custom-extension
   check passes; the development contract and the relation-bound probe are reported beside it and
   decide nothing.
2. **Every candidate:** [score-launch.mjs](score-launch.mjs) rebuilds the first implementation and
   every repair's candidate from the launch's own records, keeps a rebuild only where its tree is
   the tree the product's checks pinned for that candidate, and scores each kept one by (1). A
   candidate it cannot rebuild exactly is reported as not recovered and is not scored. It reports
   first-candidate and delivered-candidate correctness, incorrect-to-correct and
   correct-to-incorrect transitions, repairs that changed no relevant result, and the model calls,
   tokens and time the repairs spent. This is a within-run reading of what repair did, not a
   comparison with any other agent.

**Ordinary completion is demonstrated** only if both ordinary runs pass the expanded external
evaluation. An individual pass, the two-run criterion and comparative benefit are reported apart.

## Allocation

| launches | purpose | condition |
| --- | --- | --- |
| 2 | R1, R2: ordinary runs, pre-registered repetitions of one build and configuration | none; both run, whatever the first gives |
| 2 | C: one fresh paired comparison, Swarm and OpenCode | R1 and R2 both pass; registered by amendment before either arm |
| 1 | infrastructure replacement | a launch invalid for an infrastructure reason, investigated and entered first |

These are ceilings. The product is not changed between R1 and R2, nothing is injected into either,
both are counted and reported, and neither is selected over the other. A valid failure is never
replaced. If either ordinary run fails, C is not run: the first concrete failure in that run's
trace is identified and recorded, and nothing else is launched under this protocol.

**The comparison, if its condition is met:** the task is `marked-bugfix-www-case` of
`scripts/comparison/tasks.mjs`, the first task in that file, from a repository (markedjs/marked)
not used to develop or tune this work, fixed here before any launch. Both arms get the task text,
the repository at its base and the visible check, the same model and configuration, and matched
15-minute limits; Swarm runs its ordinary workflow (`--plan-checks`), OpenCode its own. The
evaluator is that task's frozen hidden oracle through `hiddenVerdict`. Both outcomes are reported.

## Records

For each launch: the summary, the supplied contract, the generated checks and coverage review as
the planning chain recorded them, the exact final patch, the raw exchanges, stdout and stderr,
every ledger and blob of its sessions, the exposure scan, the evaluator's verdict, the expanded
audit's reading and the per-candidate scoring. Streams, ledgers and blobs are packed losslessly
(`scripts/evidence-pack.mjs`) and their restoration verified before the record is committed.

---

## Amendments

### 1. 2026-10-19, after R2 and before either arm of C: the comparison

R1 and R2 both passed the expanded external evaluation (R1 reported `accepted`, R2 `unresolved`
with a correct patch delivered; [launches.md](launches.md)), so C's condition is met. C is two
launches, run with the comparison runner unchanged (`scripts/comparison/run.mjs --manifest`, its
harness digest recorded in the manifest) on a manifest frozen by
[freeze-comparison.mjs](freeze-comparison.mjs) before either arm:

- **Task:** `marked-bugfix-www-case` (markedjs/marked at its frozen base), as registered above.
  Both arms get the task text, the repository at its base with the visible check, and nothing
  else; the upstream commit and the hidden tests are sealed from both.
- **Arms, in the runner's own order rule** (`launches`, seeded): Swarm first, then OpenCode.
- **Pins:** `qwen3.6:35b-a3b` at `http://127.0.0.1:11434/v1` for both; Swarm's frozen build
  `e2b0fe77c` (`~/.cache/swarm-comparison/tools/swarm-e2b0fe77c/dist/cli.js`, its bytes digested)
  with its ordinary workflow flag `--plan-checks` and the supplied contract holding the visible
  check only (`swarmContract`); OpenCode 1.14.48 configured by the runner (`writeArmConfiguration`).
- **Matched limits:** 14 minutes per invocation and a 1-minute grace, so each arm is killed at
  15 minutes; Swarm's wall ends one minute earlier for its final verification, as stage A of
  2026-10-16 froze it; no scripted correction for either arm (`maxCorrections: 0`), so each arm
  runs once, unattended. Swarm's 8,000,000-token bound is a safety bound; OpenCode has none.
- **Evaluation:** the task's frozen hidden oracle through the runner's own `hiddenVerdict`, on a
  fresh checkout, for each arm's delivered patch. Where the Swarm arm repairs, each of its
  candidates recovered by the per-candidate rebuild is scored by the same oracle; that is a
  within-run reading, not part of the comparison.
- **What it can show:** each arm's result on one task from a repository not used to develop this
  work. One task cannot show superiority; a difference is reported as that, on that task.
