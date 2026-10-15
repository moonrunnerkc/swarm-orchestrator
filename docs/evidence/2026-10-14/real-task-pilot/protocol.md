# Real-task pilot, registered 2026-10-14: does the tool work usefully on small real tasks?

A bounded pilot, not a benchmark: four fresh real repository tasks, each run once under Swarm
Orchestrator and once under OpenCode on the same local model, then, only if a frozen gate holds,
the bug-fix and feature tasks repeated once per arm. Its question is whether the results justify
a larger comparison. It is separate from the exploratory comparison of 2026-10-11
([protocol](../../2026-10-11/comparison/protocol.md), whose pass 5 is untouched) and from the
registered campaign of 2026-09-29; it pools with neither. Everything below is frozen before the
first launch; the stage A manifest carries this file's digest.

## Instrument

The proved comparison runner, unchanged: `scripts/comparison/run.mjs --manifest <file>` with the
stop controls of amendment 4 of the comparison protocol, whose fault-suite proof
([comparison-stop-controls](../../comparison-stop-controls/README.md)) is re-verified against
this tree before freeze. The pilot adds only read-only helpers under `scripts/pilot/`: the task
set, a manifest generator that pins the pilot's own identity, a validator that uses the
comparison's scorer, an analyzer and a publisher. None of them is on the launch path; the
manifest records their digests beside the harness digest.

- Swarm: built in isolation from the tested revision into its own directory; the manifest pins
  the CLI path, its bytes and a digest over the whole built tree.
- OpenCode: the installed version, pinned by `opencode --version`.
- Model: `qwen3.8:27b` served by rapid-mlx at `http://127.0.0.1:8000/v1`, thinking off in both
  arms, the same 8192-token per-call output cap, the server's default sampling. The arms'
  request settings are taken from retained evidence (amendment 3's proxy capture for OpenCode,
  the provider source at the tested revision for Swarm), not from a new generation request.
- One model request stream at a time on this host; no other inference workload during launches.

## Tasks

Four tasks across at least three public repositories, each a historical, maintainer-authored
change mined for this pilot: one bug fix, one feature, one refactor, one dependency upgrade. No
task, repository commit or smoke fixture previously run or repaired against in this repository
is reused; a repository previously used is allowed only with a genuinely new change, and that
narrower sense of "fresh" is disclosed where it applies. The task definitions, the visible
checks both arms see, the hidden oracles and the deliberately wrong implementations are in
`scripts/pilot/tasks.mjs`; the candidates considered and the reasons for excluding the others
are in [candidates.md](candidates.md).

For every task, before either arm runs and with no model: full base and reference commit ids
are pinned; the base installs from its committed lockfile and its own tests run; the base with
the visible check committed fails the visible check and the hidden oracle; the reference passes
both; the visible check does not fail the project's lint where lint passes without it; and one
deliberately wrong or partial implementation is rejected by the hidden oracle. The output is
[validation.json](validation.json). Hidden tests and the reference live only in the sealed
mirror; each arm works in a shallow clone of the base with the remote removed, and every Swarm
evidence directory is scanned afterwards for the sealed commit id and the mirror path.

Both arms receive identical task text, the same visible check in the tree, the same install and
test commands and the same workspace. Swarm seals the visible check as its contract, as the
product does.

Stage B is fixed now as the bug-fix task and the feature task of stage A, repeated unchanged
under the ids with suffix `-rep` in a second manifest, so no cell can be read as already
recorded. Launch order within a stage is the comparison's frozen order (seeded hash, the first
arm alternating by position), which balances which arm goes first; it is written in each
manifest and recorded in the results.

## Budgets

| budget | value |
| --- | --- |
| launches | stage A 8 (4 tasks, 2 arms); stage B 4; maximum 12 scored |
| agent execution per launch | one deadline of 19 minutes per launch covering the initial invocation and every scripted correction; the runner starts a correction with at least one minute, so a launch's agent time stays under 20 minutes; termination grace of 60 s after the deadline is cleanup, tracked separately |
| scripted corrections | at most two per launch, each a re-invocation with the visible failure output only, inside the launch deadline |
| Swarm token cap | 600,000 per invocation, the runner's constant; it may bind, and whether it did is reported. OpenCode has no native equivalent and runs to the wall only. The arms are not budget-matched on tokens |
| agent minutes, whole pilot | at most 240; 12 launches at 19 minutes is 228 |
| preparation before the first scored launch | at most 90 minutes from the recorded start |
| whole assignment | at most 6 hours from the recorded start; analysis and reporting time is reserved |
| preflight | none, unless the merged code makes the retained live smoke inapplicable; then one task through both arms at most 5 minutes each, counted in the 240 |

No replacement launches: a failed or invalid attempt stays as it is. No `--recover` and no
restart in this pilot: a halt ends it.

## Supervision

The comparison's rule, applied identically to both arms by the launcher: after each invocation
the supervisor measures the visible verdict in a fresh checkout; on failure it re-invokes the
same arm in the same workspace with the failing output appended, at most twice, within the
launch deadline. No manual edits, hints, hidden-test feedback or selected retries. Any human
involvement is recorded as such.

## Stops, read after every completed pair and before the next dispatch

- **Invalid experiment**: endpoint loss or replacement, configuration drift, broken preparation
  or scoring, missing or corrupt evidence, an interruption, or unconfirmed cleanup. The runner's
  halt is final for this pilot; the attempt is kept and the result is BLOCKED.
- **Legitimate agent failure**: wrong or incomplete code, an ordinary refusal, a stall or a spent
  budget under a healthy setup. A valid outcome; the pilot continues while the gate below is
  still attainable.
- **Pilot futility**: a verified false completion claim by Swarm, an exposed oracle, a failed
  Swarm delivery of the bug fix or the feature, or two failed Swarm deliveries. Further dispatch
  stops as a pilot decision, not an infrastructure halt; a counterpart already started is
  preserved unless a safety or control failure requires termination; completed and unrun cells
  are reported.

A passing project suite or a valid evidence signature is not task correctness; a conservative
failure verdict on a correct patch is not automatically a verifier bug. Both are reported.

## Scoring, per launch

- **Correct patch**: the frozen independent acceptance and regression checks pass on the exact
  final patch in a fresh checkout (the hidden oracle).
- **Correctly delivered**: a correct patch; the visible checks resolved; the product finished
  normally within budget (exit 0, not killed at the wall) and reported completion without a
  contradictory failure or unresolved required work; for Swarm also its own acceptable structured
  verdict, its evidence directory present and no oracle exposure; for OpenCode a final answer that
  does not report failure. OpenCode's final text is classified by a keyword heuristic and kept
  beside the classification; a doubtful text is "uncertain", never a completion claim and never a
  delivery. Exact reasons are recorded when a patch passes and delivery does not.
- **Delivered without scripted correction.**
- **False claim**: a completion claim the independent checks reject. Uncertain claims are
  reported as such.
- Scripted corrections, internal repair, loops and stops, timeouts and exit statuses.
- Time, non-overlapping: agent wall (the arm's invocations), preparation (install, outside the
  arm), scoring and harness (patch extraction and the verdicts, in fresh checkouts), end-to-end
  (the launch record's start to end). Pilot preparation and infrastructure time are reported
  separately and in the total spend.
- Tokens as each arm reports them, with the number of invocations whose usage is unknown.
  Reasoning and cached tokens are shown as reported, never added twice or assumed alike; missing
  usage is never zero and forbids a precise efficiency claim.

Per arm: cost per correct delivery is all attributable launch cost (every launch, failed work,
corrections, internal verification and external checks) divided by correct deliveries; with zero
deliveries it is undefined. Stage A and stage B are analyzed separately; a combined view states
four unique tasks with two repeated.

## Decision rule, frozen

Stage A qualifies for the four stage B launches only if all hold:

1. all eight launches produce valid, inspectable records with no unresolved setup or scoring
   problem and no oracle exposure;
2. Swarm correctly delivers at least three of four tasks, including both the bug fix and the
   feature;
3. Swarm makes zero false completion claims, needs no manual repair or hints, and respects the
   controls and budgets;
4. a comparative benefit signal: Swarm delivers more correct tasks than OpenCode; or both deliver
   the same number, Swarm uses at least 20% less total end-to-end time across the four tasks, and
   needs no more scripted corrections on the tasks both deliver. Token and time tradeoffs are
   reported either way; token savings alone qualify nothing.

If any item fails: DO NOT PROCEED (or BLOCKED where the instrument failed), with no confirmation
runs spent. After a qualifying stage A, PROCEED TO A LARGER STUDY requires both repeated tasks
correctly delivered by Swarm, zero false claims or control failures throughout, and the same
benefit rule on the combined results; otherwise DO NOT PROCEED, saying whether functionality was
shown but added value remained inconclusive. PROCEED is permission to recommend a larger study,
not to launch one. These thresholds are a conservative spending gate under this configuration,
not a reliability estimate.

## What is frozen after this point

Swarm, OpenCode, the model and its server settings, the tasks, the visible checks, the hidden
oracles, the budgets, the supervision rule, the scoring and the decision rule. A product defect
found after freeze ends the pilot with a reproducible diagnosis and, where practical, a focused
failing regression; it is not fixed and rerun under this assignment.

The analysis is `node scripts/pilot/analyze.mjs --manifest <stage A manifest> [--manifest-b
<stage B manifest>]`, read-only over the records.
