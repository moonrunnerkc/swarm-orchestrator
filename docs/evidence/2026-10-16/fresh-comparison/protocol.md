# Fresh comparison of 2026-10-16: protocol, registered before any scored launch

## Scope

- **What:** Swarm and OpenCode, four fresh tasks ([candidates.md](candidates.md)), two
  repetitions per tool per task. That is 16 launches, one at a time, on this host.
- **Status:** this is the only scored cohort of the assignment. The development launches in
  [../development/](../development/protocol.md) were on exposed tasks and do not pool with it.
- **Frozen:** this file, the manifest
  ([manifests/stage-A.json](manifests/stage-A.json)), the task module
  (`scripts/pilot/tasks-2026-10-16.mjs`) and the harness digest the manifest names. All are fixed
  before the first launch. Nothing in a scored cohort changes after that.

## Configuration

| what | value |
| --- | --- |
| model and server | Ollama 0.32.14 at `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b`, thinking off (`enable_thinking`, `chat_template_kwargs.enable_thinking`, `reasoning_effort: "none"`), `max_tokens` 8192; one model resident, one request at a time. These are the 2026-10-16 comparison's settings. |
| Swarm | build `dca2e5953` (`~/.cache/swarm-comparison/tools/swarm-dca2e5953`); CLI and whole-dist digests in the manifest; **its default configuration**: no workflow flags, legacy prompt, no planned checks |
| OpenCode | 1.14.48, its 2026-10-16 configuration: edit and shell allowed in the workspace, no web fetch, HOME the launch's own directory |
| Node | v24.15.0 |
| checkouts | `~/swarm-comparison-work`, outside any hidden directory, for both tools and the scorer |

### Why Swarm runs its default configuration

The development launches measured the two options this assignment added or exposed.

| option | result | decision |
| --- | --- | --- |
| concise prompt | failed its registered rule: it used 56 per cent more tokens on one task and 11 per cent fewer on the other | not used |
| `--plan-checks` | in four mime launches it never admitted a planned check; it cost 3 to 4 times the default's tokens on the three that delivered, and the fourth halted on a defect since repaired | not used |

Neither is in the scored configuration. Both remain available to users. Neither is claimed to
help.

## Limits, the same for both tools

| limit | value |
| --- | --- |
| launch deadline | 10 minutes for everything: the initial invocation, any correction and Swarm's internal repair and final verification. The process group is killed at it. |
| cleanup | at most 60 seconds after the deadline, reported apart from agent time |
| Swarm's own wall | `floor((time left − 60 s) / 1 min)` minutes, of which the product keeps 30 s for its final verification |
| tokens | **one common cap: 8,000,000 per launch, all internal work charged.** Swarm enforces it natively, as a bound checked between calls. OpenCode has no native cap; its total is recorded, and a launch above the cap counts as not delivered. Neither tool came within a tenth of it in any earlier launch, so this is a recorded ceiling, not the binding limit. The wall binds. |
| scripted corrections | at most 2, visible failure output only, each with at least 120 s left (Swarm) or 60 s (OpenCode) |
| Swarm product limits | 40 steps per loop, 3 gate-repair attempts, 8192 output tokens per call |

## Order

The launch order is fixed by `repeatedLaunches` in `scripts/comparison/order.mjs`:
- repetition `-r1` runs every task in the seeded order, the first arm alternating by position;
- repetition `-r2` runs the same order with each task's first arm flipped.

So each tool goes first on each task exactly once. The 16 launches are listed in the manifest.
A tool's launch never depends on the other tool's result.

## Scoring, per launch, from the published evidence only

- **Correct patch:** the frozen hidden oracle passes the exact final patch in a fresh checkout.
  The oracle is the upstream tests overlaid, the task-authored checks, the structural and version
  rules, the closed file set and the project test.
- **Correctly delivered:** all of these hold:
  - the patch is correct;
  - the visible check is resolved;
  - the exit code is 0 within the deadline;
  - the final report is a completion claim under `final-report-claim-v1`;
  - for Swarm, its own verdict is acceptable;
  - the launch stays within the token cap.
- **False completion claim:** a completion claim over a patch the oracle rejects.
- **Interventions:** scripted corrections, counted. No person interacts with either tool, so the
  human-minute count is zero by construction. It is reported as interaction counts, not minutes
  saved.
- **Cost:** agent time, end-to-end time, preparation and scoring apart, and comparable tokens,
  counting every prompt and completion token once as the server counted them.
- **Repeatability:** for each task and tool, whether the two repetitions agree on delivery and on
  the oracle's verdict, and how far their patches differ. This is observed consistency across two
  runs, not a guarantee.
- **Reported apart, not decision measures:**
  - security results (tar's negative-size property is in the oracle);
  - lint and type checks where they pass at the base;
  - file scope and dependency changes;
  - a discretionary review rubric over blind-lettered patches.
- **Coverage audit after scoring:** every delivered patch from either tool is also an extra
  candidate for the oracle. Where the two tools' patches for one task disagree in behaviour, the
  disagreement is examined against the task text. Any case the oracle missed is reported as an
  oracle gap, not as a re-score.

## Decision rule, frozen now

**A bounded signal of practical benefit for Swarm** exists only if one of these holds over the
16 launches.

1. **More complete autonomous deliveries at acceptable cost.** All of these:
   - Swarm correctly delivers at least two more launches than OpenCode, out of 8 each;
   - Swarm makes no more false completion claims;
   - Swarm needs no more scripted corrections;
   - Swarm's end-to-end minutes per correct delivery are at most twice OpenCode's.
2. **Materially lower cost at equivalent results.** All of these:
   - equal correct deliveries;
   - false claims and corrections no worse;
   - end-to-end minutes per correct delivery and comparable tokens per correct delivery are each
     at least 25 per cent lower for Swarm.

Otherwise the result is **no demonstrated benefit**, with the measured limitation named.

Every dimension is reported as a win, tie, loss or unmeasured. No superiority is claimed on a
dimension that is tied, worse or unmeasured. Sixteen launches on four tasks with one local model
support a bounded signal at most, never general superiority.

## Validity and stops

The launcher's stop controls apply unchanged. These halt dispatch:
- a dead or changed endpoint;
- configuration drift;
- a preparation, scorer or record failure;
- an interruption.

A halted launch is kept, and the same cell is resumed only through `--recover` with a recorded
justification. A tool's genuine task failure is an outcome, never a reason to rerun.

If a defect that changes a scored build is found, the observations so far stand. The 16 launches
are the whole comparison allowance, so no rerun cohort fits within it. The defect is reported,
with the cells it affected, and the result is stated without those cells where it cannot stand
with them.
