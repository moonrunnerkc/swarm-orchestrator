# Checking semantics, 2026-10-18: protocol

Registered before the first model-powered launch of this work. Every launch, in order, goes in
[launches.md](launches.md), entered before it starts, failed starts and accidental launches
included. This file is not edited after the first launch; a change of plan is an amendment
appended below the line at the end, dated, before the launches it affects. The closed protocols
of [../generated-check-control/](../generated-check-control/protocol.md) and
[../../2026-10-17/repair-detection-live/](../../2026-10-17/repair-detection-live/protocol.md) and
their results stand unchanged; nothing here reinterprets them.

## Status

The two ordinary runs are **development records on an exposed task** (mime): the task, its
retained faulty patch, the deletion-based repairs, launch 4's space normalization and both
evaluators are known to the people developing Swarm, and the task is a public change that may be
in the model's training data. Two passing runs would be two bounded observations of one frozen
build, never proof of general completion or superiority. The paired comparison, if it runs, is
on a task registered by amendment from another repository, not used to develop this work.

## Allowance and accounting

- **At most five model-powered launches, 15 minutes each end to end, and 75 agent-minutes in
  all**, whichever comes first. Agent minutes are the arm's own process wall, from spawn to exit
  or kill. Workspace preparation, builds and scoring are reported apart.
- One launch owner (the session that registered this protocol), one launch at a time, one model
  resident, and no test suite running beside a launch. A launch started by mistake and a launch
  attempt that fails before reaching a model are counted and entered.
- Local only: Ollama 0.32.14 at `http://127.0.0.1:11434/v1` serving `qwen3.6:35b-a3b` (digest
  `096fdbd02fe6`), already on the machine. No paid API and no model download.
- Thinking off: Swarm's `local_thinking = false`, written by the driver's
  `swarmConfigurationText`. For the comparison's OpenCode arm, the comparison harness's own
  configuration (`writeArmConfiguration`), as 2026-10-18's protocol states it.
- **The product build:** the commit that registers this protocol, whose `src/`, `scripts/` and
  lockfile are the tree `7e802a360` passed `npm run gates` on (checks with 15.4 MB of the 6.0 MB
  required headroom, typecheck, lint with 28 warnings that predate this work, 4473 tests passed and
  29 skipped), cloned into `~/.cache/swarm-comparison/tools/swarm-<commit>` and built there with
  `npm ci` and `npm run build`. Node 24.15.0.
- **The driver:** `../generated-check-control/run.mjs` unchanged
  (`sha256:3d2061e7f73154dd091254fe5b55ff534a11501993a9d58497336e31eabb92c6`), `--arm swarm
  --mode ordinary`: a clean clone of the original base with the visible check committed, nothing
  injected, the supplied contract holding the visible check only, `--plan-checks`, `--install
  --lockfile package-lock.json`, `--max-wall-minutes 14`, `--max-tokens 8000000` (a safety bound),
  and a 15-minute kill. The driver closes the arm's stdin and records every exchange through its
  proxy.
- **The task:** mime at `953ae3ebc59c387064f3760b73085eff6760a7f6`, the task text and visible
  check of `scripts/pilot/tasks-2026-10-17.mjs`, unchanged.
- **Model-visible inputs:** the task text, the repository at its base with the visible check, and
  what the product itself says. No development check, audit control, evaluator file, reference
  patch or earlier candidate is in a workspace or a request; planner requests are scanned for
  exposure (`../../2026-10-17/planned-check-live/scan-exposure.mjs`).

## The evaluation, frozen before the first launch

Each delivered patch is read apart, on a fresh checkout of the original base, by:

1. **The frozen evaluator**: `../../2026-10-17/repair-trust-live/score.mjs --task mime`
   (`sha256:f05f798bf045...`), the
   task's hidden tests, the project tests and the 113-case audit, exactly as every earlier launch
   was scored. Its verdict is reported as it comes.
2. **The expanded audit**: `validate-expanded-audit.mjs --patch` (`sha256:264b9daca769...`, with
   [expanded-audit.mjs](expanded-audit.mjs) `sha256:46b94e35e460...`), which runs the original
   development contract (counterexample, relation, preserved behaviour, visible check) and the
   custom-extension check ([expanded-audit.mjs](expanded-audit.mjs)) on the exact patch.

A run **passes the expanded external evaluation** only if the frozen evaluator passes and the
custom-extension check passes. The development contract and the relation-bound probe are reported
beside it and decide nothing. Ordinary completion is **demonstrated** only if both ordinary runs
pass.

## Allocation

| launches | purpose | condition |
| --- | --- | --- |
| 2 | O1, O2: ordinary runs, pre-registered repetitions of one build and configuration | none; both run, whatever the first gives |
| 2 | C: fresh paired comparison, Swarm and OpenCode | O1 and O2 both pass; its task and evaluator registered by amendment before either arm |
| 1 | infrastructure replacement | a launch invalid for an infrastructure reason, investigated and entered first |

These are ceilings. The product is not changed between O1 and O2, both are counted and reported,
and neither is selected over the other. An unchanged build is never launched again for another
draw, and a conditional allocation is not spent when its condition is unmet. If either ordinary
run fails, C is not run: the first concrete failure in that run's trace is identified and
recorded, and no further campaign starts under this protocol.

## Records

For each launch: the summary, the supplied contract, the generated checks and the coverage review
as the planning chain recorded them, the exact final patch, the raw exchanges, stdout and stderr,
every ledger and every blob of its sessions, the exposure scan, the frozen evaluator's verdict and
the expanded audit's reading. Streams, ledgers and blobs are packed losslessly
(`scripts/evidence-pack.mjs`) and their restoration verified before the record is committed.

---

## Amendments
