# Reach pressure: protocol, generation 3

Written and committed before any task of the confirmatory cohort was run. Every row the run
writes carries the SHA-256 of this file, so an edit after the fact is a different protocol and the
analysis refuses to mix the two.

## Question

After an agent has satisfied the visible acceptance evidence for a task, does requiring complete
changed-line reach before it may stop change the probability that its patch passes an independent
held-back oracle?

- **Null.** Reach enforcement does not change held-back correctness.
- **Alternative of interest.** Reach enforcement pushes toward narrower implementations, so some
  control patches pass the held-back oracle where the reach-repaired patch fails it.

The analysis is two-sided. Reach helping, hurting and doing nothing measurable are all reported
under the same rules, and the decision rule below was fixed before any outcome existed.

## Frozen parameters

The driver reads this block and nothing else from this file.

```json
{
  "schema": "swarm.reach-pressure.protocol.v1",
  "generation": 3,
  "cohort": "mined-pr-viable-79",
  "manifestDigest": "sha256:07a5a50b2b0d5cc87d746e214eee0c92ae1ca9828cd68adc463f579a5a0ea81a",
  "driverDigest": "sha256:a962c7a420d14229d797819477050bd5076dcf8fedf5656f5631f1747d06d830",
  "policyDigest": "sha256:07c1cf1bee31eafc4ce345babf8565249712325597aa7af56a58211f9b03afc4",
  "model": "local:malekoo/Qwen3.8-27B-MLX-8bit",
  "endpoint": "http://127.0.0.1:8000/v1",
  "agent": { "maxWallMinutes": 12, "maxTokens": 1000000, "thinking": false, "isolation": null },
  "limits": { "prefixInvocations": 2, "reachRepairInvocations": 2, "attemptsPerTask": 3 }
}
```

- `manifestDigest` is the canonical-JSON digest of [`manifest.json`](manifest.json).
- `driverDigest` is the canonical-JSON digest of the per-file SHA-256 of the ten sources listed as
  `driverSources` in `scripts/reach-pressure-experiment.mjs`: the driver, the scripted agent it
  refuses outside a synthetic cohort, and the modules under `src/eval` and `src/gates` that decide
  a stop, build feedback, judge a patch, prepare a workspace, derive the summary and compute the
  statistics. The page renderer, `src/eval/reach-pressure-report.ts`, is deliberately not among
  them: it turns the summary into prose and decides no number.
- `policyDigest` is the digest of `experimentPolicy` in `src/eval/reach-pressure.ts`.

`run` and `score` recompute all three and refuse where any differs from this block. `analyze`
holds the rows to the registered driver digest and prints on the page whether the sources it was
derived with still match it, so a later correction to the derivation is visible and not silent. It also
refuses to run the confirmatory cohort from a tree that is not a clean commit, apart from files
under this directory, and stamps that commit on every row.

## Environment at registration

| | |
| --- | --- |
| branch | `v13-main`, clean at registration |
| harness commit at the start of this work | `149bf7d0e42192721e9448473eb2b14063670ec1`; generation 1 registered at `a2a6ee1f7` |
| harness commit of the run | the commit holding this file and the manifest, or a later one that changes nothing the driver digests; recorded on every row |
| Node | v24.15.0 |
| machine | Apple M5 Max, 18 cores, 64 GB, macOS (Darwin 25.6.0, arm64) |
| model | `malekoo/Qwen3.8-27B-MLX-8bit`, Hugging Face snapshot `6a88621e929c7261b3f5e5c000bac8b663a3bcf3` |
| server | `mlx_lm.server` 0.31.3 on mlx 0.32.2 at `http://127.0.0.1:8000/v1`; generations 1 and 2 ran it with `--prompt-cache-size 1 --prompt-cache-bytes 2000000000`, generation 3 with `--prompt-cache-size 1 --prompt-cache-bytes 500000000 --prefill-step-size 512 --prompt-concurrency 1 --decode-concurrency 1` (memory and scheduling settings; the arithmetic of a greedy completion is the same) |
| decoding | the agent sends no temperature, top-p or seed. The server's defaults decide: temperature 0.0, top-p 1.0, top-k 0, min-p 0.0, which is greedy decoding. Batched GPU inference is still not bit-reproducible |
| thinking | off (`local_thinking = false`), as in the historical pass |
| concurrency | one task at a time, one model call at a time |

## Cohort

The 79 tasks `campaign/pr-tasks/viable.json` marks viable. That file last changed in `61e6a3c6c`
on 2026-09-10, the commit behind the "192 candidates mined, 79 viable, 79 scored" line of
[the mined-corpus evidence](../../2026-09-06/mined-corpus/README.md), and all 79 tasks viable today
have a row in the historical `scored.json`. The cohort is that historical cohort and no
substitution was made.

[`manifest.json`](manifest.json) freezes, for each task: repository, pull number, base commit,
merge commit, test file, runner command, the digest of the task text, the visible case titles, the
held-back case titles, the digest of the pull request's test file at the merge commit (the one
file both halves are title filters over), and the digest of the whole viability record. Case
titles are the case identities: they are what each half's filter selects. The driver re-reads the
task text and the oracle file at run time and refuses a task where either digest has moved.
Tasks run in manifest order, which is task id order.

## Design

A shared-prefix paired design.

1. **One trajectory per task.** A workspace is prepared at the base commit and the agent is
   invoked with the task text, exactly as `scripts/pr-task-pass.mjs` invokes it, plus `--json` so
   the session can be found afterwards.
2. **The visible judgement.** After each invocation the workspace's whole diff against the base is
   stored by content address and judged by `swarm ci` in a fresh checkout with the visible half as
   `--oracle` and `--install`, which also runs the repository's own checks. This is the unchanged
   production verifier, bonding included.
3. **Visible acceptance** is `regression: pass` and `task: accepted`. It is what a verifier with no
   reach enforcement and no bond enforcement would let a run stop on.
4. **Before visible acceptance** there is one repair path, common to both conditions by
   construction because there is only one trajectory. A refused patch gets one more invocation
   (`prefixInvocations` is 2) with the control condition's feedback. Reach is never mentioned
   before the fork, even where a verdict carries unreached lines beside a failing suite.
5. **The control outcome** is the patch at first visible acceptance, stored and digested before
   anything else happens to the workspace.
6. **The reach condition** forks from that exact workspace. Where `oracleReach` is `reached` or
   `unmeasured`, production would not refuse on reach, no treatment is applied, and the reach
   outcome is the same patch. Where it is `unreached`, the agent is invoked again in the same
   workspace with the reach feedback below, up to `reachRepairInvocations` times, each result
   judged as in step 2. The reach condition stops when `regression: pass`, `task: accepted` and
   `oracleReach` is not `unreached`. A repair that breaks the visible oracle or the suite is told
   so, under the reach condition's own policy.
7. **The reach outcome** is the workspace's patch when the reach condition stops or its
   invocations run out. Whether that patch satisfied the reach condition is recorded beside it.
8. **Tasks that never reach visible acceptance** received no treatment. Both outcomes are the one
   final patch.

The only difference between the conditions is therefore the reach refusal and what follows from
it. The stop rules are `reasonsToRefuse` from `src/gates/certification.ts`, filtered to a named
subset per condition (`experimentPolicy`): the control keeps `regression-not-pass` and
`task-not-accepted`, and reach adds `oracle-did-not-reach-the-change`. Production certification is
not modified and `bondRefusesCertification` stays true.

**What "fork" means here.** Every invocation of the agent is a fresh conversation. That is not a
limitation introduced for this experiment: the CLI has no way to continue a conversation with a
new message, and the harness's own repair (`resolveWithModel` in `src/agent-run.ts`) starts a clean
loop on purpose. So what is shared and forked is the workspace, the patch and the ledgers, which
is everything a verifier-driven repair in this harness ever inherits. No independent generation
per arm is used, so no sampling noise separates the conditions.

### Oracle bonding

`swarm ci` measures the bond on every accepted patch and the verdict is recorded on every step,
for both patches. It enters no stop decision and no feedback in either condition. A unit test
holds the stop decision constant across all four bond states for both conditions.

### What the agent is told

Feedback is built from verdict fields and never from anything a runner printed, because both
halves live in one file and a runner's output can name the cases it skipped. A repair prompt is
the unchanged task text, then the line
`Recorded verifier observations about earlier work on this task:`, then the sentences below that
apply.

- Always first: "An independent verifier judged the change in this workspace and declined to
  certify it. It judges with an acceptance check you cannot see or edit, and with the repository's
  own checks."
- Suite refused: "The repository's own checks fail with the change applied and pass without it."
  or, where it could not be measured, "The repository's own checks could not be measured with the
  change applied."
- Visible oracle refused: "The acceptance check for the task fails with the change applied."
- Reach refused, reach condition only: "The acceptance check passes and the repository's own
  checks pass. The acceptance check never executed these lines the change added, so it did not
  judge them:" then one line per file, `path: line, line`, then "The verifier certifies a change
  only where its acceptance check executes every line the change adds."
- Always last: "The change is already in this workspace. Revise it so that the verifier can
  certify it."
- For an empty diff: "An independent verifier looked at this workspace and found no change
  against the base commit, so there was nothing to judge. The task is still to be done."

The reach sentences say what was observed and what certification requires. They do not say
whether to remove the lines or make them run, because which one the model picks is the measurement.

### Keeping the held-back half hidden

- Neither half is ever written into a workspace. Both are copied into `swarm ci`'s own fresh
  checkout at judging time, which exists only while the judge runs, and no agent runs then.
- The historical pass cloned the task's checkout into the workspace, merge commit included, so the
  pull request's test file was one `git show` away. Here every ref, the remote and the reflog are
  dropped and the clone is repacked with nothing unreachable kept, and the driver refuses a
  workspace where the merge commit or the test file's blob still resolves.
- The code that builds prompts is handed the task id and the task text and nothing else.
- Held-back scoring is a separate phase that refuses to start until every trajectory has settled,
  so no held-back verdict exists while an agent can still run.
- Residual, named: the tool policy is lexical and an allowed interpreter can read outside the
  workspace. The task text is the pull request's own title and body.

## Budgets

Per invocation: 12 wall minutes, 1,000,000 tokens, the agent's default step and gate-repair caps,
which are the historical pass's settings. Per task: at most 2 invocations before visible acceptance
and at most 2 reach repairs after it, so at most 4. `swarm ci` keeps its own limits: 5 minutes per
command, 20 minutes per judgement.

## Outcomes

**Primary.** The held-back half's verdict on the control patch against its verdict on the reach
patch, per task. `accepted` is a pass and `rejected` is a fail. The existing order-dependence rule
applies unchanged: where the visible half accepted and the held-back half refused alone, both
halves are run together, and a refusal that disappears in company is recorded as order dependence
and read as `accepted`. Held-back judgements run `--oracle-only`, since the suite was measured
when the visible oracle judged the same patch. One patch is judged once: where both outcomes are
the same bytes they share one verdict.

**Secondary.** A pass that also requires `regression: pass` on that patch; patch metrics for both
patches where reach triggered (files, added and deleted lines, executable added and deleted lines
under reach's own definition of a line that carries code, added test lines, diff bytes) and the
sign of each change; visible and regression status after repair; bond state of both patches;
invocations, wall time, model calls and tokens spent in the repair phase against the shared prefix.
No branch or condition count is reported, because nothing in this repository parses the mined
projects' languages. Any description of what a repair did is written after the aggregate table
exists, as diff facts, with both patches committed beside it.

## Analysis

- The full paired 2x2 table, counts and percentages, over **judgeable tasks of the frozen cohort**:
  tasks whose two patches each carry a held-back pass or fail. This is the primary denominator. It
  includes tasks that never reached visible acceptance and tasks where reach did not trigger, which
  are concordant by construction, because the question is about enforcing the policy over a cohort.
- The same table over three narrower, named denominators: tasks that reached visible acceptance,
  tasks where reach triggered, and tasks where the repair satisfied reach.
- Exact two-sided McNemar test on the discordant pairs (`mcNemarExact`, binomial).
- Paired difference in held-back pass rate, reach minus control, with a 95% interval by Newcombe's
  1998 square-and-add method for paired proportions, his method 10 (`pairedDifferenceInterval`).
  Both functions are in `src/eval/statistics.ts` with known-answer tests.
- Harm count (control pass, reach fail) and help count (control fail, reach pass), separately.

**Decision rule.** A population-level claim in either direction requires the exact McNemar
p-value over the primary denominator to be below 0.05: harm where the harm count exceeds the help
count, help where it is the other way. Anything else is reported as insufficient, however the
discordant pairs lean. Five or fewer discordant pairs cannot reach 0.05 whichever way they fall,
and if that is what the cohort yields the report says so. Discordant pairs are listed by task id
in every case, as instances and not as a rate.

## Denominators, failures and censoring

Every scheduled task keeps a row. Terminal statuses:

| status | meaning | paired denominator |
| --- | --- | --- |
| `reach-not-triggered` | visible acceptance, reach reached or unmeasured | in, one patch |
| `reach-repaired` | reach triggered and a repair satisfied the reach condition | in |
| `reach-repair-exhausted` | reach triggered and the repairs ran out | in, final patch |
| `never-visible-accepted` | the prefix ran out without visible acceptance | in, one patch |
| `unjudgeable` | the workspace could not be prepared, or the visible oracle gave no verdict or accepts the base | out, named |
| `infrastructure-failure` | the endpoint not answering after an invocation, or a driver that stopped mid-task | out until re-run |

- An empty diff from a live endpoint is the model's outcome. It is not sent to a judge: the frozen
  viability record shows the held-back half refusing the unchanged base, so it is scored a fail
  with that basis recorded.
- The endpoint is asked whether it still answers after every invocation. Where it does not, the
  attempt is an infrastructure failure whatever is in the workspace, and the driver stops
  dispatching: a server that died during a repair leaves the earlier patch in place, and that is
  not the model declining to change it.
- A held-back verdict of `unjudged` or `vacuous` makes the pair unjudgeable. It leaves the
  denominator by name and is never converted to a pass or a fail.
- No other exclusions. In particular no task leaves because its split is thin, its repository is
  over-represented or its result is inconvenient.

## Stopping and resuming

The whole cohort runs. There is no interim analysis and no held-back verdict to look at until
every trajectory has settled. An interrupted attempt stays on the ledger as an
`infrastructure-failure` row, including a launch the driver never settled, and the task is
scheduled again under this same protocol with the next attempt number, at most `attemptsPerTask`
times in all; a task still failing after that stays an infrastructure failure by name. The last
attempt is the task's outcome and the number of interrupted attempts is reported. A supervisor
outside the driver restarts the model server with the registered arguments when the driver stops
on an infrastructure failure and resumes it; it decides nothing else. Nothing else is retried: not a
refused patch, not an unjudgeable verdict, not a judge that timed out.

## Changes after registration

Treatment logic, outcome definitions, task membership and statistical rules do not change because
of results. If a real implementation defect forces a change, the affected run stops, the defect is
written down here under a new heading, the generation number rises, and the whole cohort is run
again under that one generation. Rows of two generations never make one estimate.

### Generation 1 stopped: a wedged server was being recorded as the model writing nothing

Generation 1 was registered at `a2a6ee1f7` (driver digest `sha256:0e03cf1c…`) and ran 12 tasks
from 2026-09-17 18:00 local. From the second invocation of `gvergnaud/ts-pattern#319` onward,
every invocation made exactly one model call, which the provider layer recorded as `call-failed`
with no usage, and ended at its wall budget with an empty diff; the MLX server process was alive at
113 MB resident and answering `/models`, and a direct completion request to it never returned. The
generation-1 health probe asked only `/models`, so seven tasks in a row (`ts-pattern#319`,
`hubot#1635`, `hubot#1710`, `dayjs#2330`, `dayjs#2367`, `dayjs#2640`, and the `dayjs#2948` attempt
the driver was stopped during) were recorded as `never-visible-accepted` with a live-model empty
diff, which is the misattribution this protocol says must not happen. No held-back verdict was
produced for any task. The 12 rows are kept under [`generation-1/`](generation-1/results.jsonl)
with the driver's log and are not part of any estimate.

The fix, which is the whole of the driver change between the generations: the endpoint is asked
for a four-token completion with a two-minute deadline, before the first task and after every
invocation, instead of for its model list; and an invocation whose every model call the provider
layer recorded as `call-failed` is an infrastructure failure whatever the workspace holds. The
server was restarted with the same arguments. Nothing about the treatment, the feedback text, the
outcome definitions, the cohort or the statistics changed; the driver digest changed because the
probe lives in a digested module.

### Generation 2 stopped: the server dies of GPU memory, and a task could be rescheduled forever

Generation 2 was registered at `4cc3999e4` (driver digest `sha256:c5715338…`) and ran from
2026-09-17 21:20 local. The probe worked: after the first invocation of `caolan/async#1790` the
server stopped completing, the attempt was recorded as `infrastructure-failure`, and the driver
stopped. The server's own log names the cause, `[METAL] Command buffer execution failed:
Insufficient Memory` in its generation thread while processing a prompt of about 32,000 tokens
on a machine under memory pressure from the agent's own test runs; after that thread dies the
server still lists its models and never completes again. The same task killed a freshly restarted
server on its second attempt, and the driver would have scheduled it again without limit. Two
tasks settled (`classnames#170`, `async#1595`), both never visibly accepted, and no held-back
verdict was produced. The rows are kept under [`generation-2/`](generation-2/results.jsonl).

The changes: `attemptsPerTask` caps how often a task is rescheduled after infrastructure
failures, after which it stays one by name; a supervisor restarts the server with the registered
arguments and resumes the driver, which is the resume this protocol already prescribed, done
without a person; and the server runs with a smaller prompt cache, a smaller prefill step and one
sequence at a time, which changes what it holds in memory and not what a greedy completion
computes. Nothing about the treatment, the feedback text, the outcome definitions, the cohort or
the statistics changed.

## What was exercised beforehand

Unit tests cover the shared prefix, the absence of reach feedback before the fork, the held-back
titles never reaching a prompt, the bond deciding nothing, the classification of empty diffs, and a
synthetic pair where a repair narrows a patch and both patches are scored. The driver was run end
to end over a three-task synthetic cohort (`scripts/reach-pressure/synthetic-cohort.mjs`), once
with a scripted agent that forces the reach path and once with the real model, through the real
verifier and into the report schema. No confirmatory task was run and no confirmatory held-back
verdict was looked at while any of this was built.

## Artifacts

| file | what it is |
| --- | --- |
| `protocol.md` | this file |
| `manifest.json` | the frozen cohort |
| `environment.json` | what the driver saw of the machine and the endpoint at the first run |
| `results.jsonl` | one launch row and one result row per attempt, append-only, canonical JSON |
| `hidden-scores.jsonl` | one row per task and patch digest |
| `summary.json`, `report.md` | derived by `node scripts/reach-pressure-experiment.mjs analyze`, which calls no model and no judge |
| `pair-notes.json` | diff facts about discordant pairs, written after the aggregate table |
| `patches/` | both patches of every task where reach triggered, named by SHA-256 |

Workspaces, every patch, the stored oracle files and a copy of every agent session (ledger and
blobs: each model call and tool call) stay outside the repository under
`~/.cache/swarm-pr-tasks/reach-pressure/g1/`. Each result row carries the session id, the SHA-256
of its ledger and its record count, and each patch is named by its digest.
