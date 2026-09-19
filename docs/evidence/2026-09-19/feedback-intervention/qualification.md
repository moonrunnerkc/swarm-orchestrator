# Qualifying the instrument before the feedback study

Written before the study's protocol was registered, against `v13-main` from `43b6c5c76`, the
commit after the reach-pressure hardening. For each defect the reach-pressure run exposed, and for
each property the new study depends on: what the code did, whether that was already correct, what
changed, and the test or run that shows it. No task of the confirmatory cohort was run and no
held-back verdict of it existed while any of this was done.

The reach-pressure run is motivation here and not a result of this study. Where the hardening that
followed it had already fixed something, the fix was audited and left alone.

## Summary

| # | requirement | already correct | changed here | shown by |
| --- | --- | --- | --- | --- |
| 1 | type tests and other non-runtime files cannot make a runtime reach refusal | yes, `pathSetAside` since the hardening | nothing | `src/gates/oracle-reach.test.ts` ("why reach sets a changed file aside": 23 exclusions, 16 near misses, the recorded shapes of commander#1557 and #1613) |
| 2 | unsupported or unusable coverage is unmeasured, never reached or unreached | yes in the verifier | the study reads an unmeasured verdict as no reading, never as no findings | `src/gates/oracle-reach-abstention.test.ts`; `src/eval/feedback-study.test.ts` "never reads an unmeasured verdict as one with no findings", "does not call an unmeasured reading cleared" |
| 3 | mutation feedback uses only accepted, witnessed, behaviour-changing mutants | **no**: the suite witness could come from the held-back half | `signalsOf` takes a mutant only where it is vacuous and witnessed by coverage or the repository suite; the suite witness runs on base, patch and mutant only (`320fd822c`) | `feedback-study.test.ts` "takes a mutant only where the check ran it, accepted it and a detector witnessed a change"; `src/gates/independent-verification.test.ts` "does not let the held-back cases witness a mutant the repository's suite cannot see", which fails on the previous verifier |
| 4 | endpoint health asks for a bounded completion, not `/models` | yes for MLX | **no for Ollama**: the probe's four tokens went to reasoning; it now turns thinking off both ways the agent does (`4629e62cb`) | `src/eval/endpoint-health.test.ts` "asks with thinking off in both spellings", "reads reasoning with no answer as no usable choice" |
| 5 | server death, GPU OOM, total call failure and invocation timeout are infrastructure | partly: probe and all-calls-failed were | a process the driver killed at its deadline, and one that left no session, are infrastructure (`b44666807`) | `endpoint-health.test.ts` (four cases); `feedback-study.test.ts` "an infrastructure failure is never a model outcome", four causes in a prefix and in an arm, none judged |
| 6 | patch digest and verifier findings after every repair invocation | reach findings per step only | every step records its patch digest, file list, whole verdict with every mutant's text and witness, both finding sets, their relation to the step before, usage, stop reason and attribution | `feedback-study.test.ts` "records the patch and the findings after every invocation", "sends updated findings on the second turn" |
| 7 | held-back files, cases, outputs and verdicts reach no workspace, prompt, feedback or model-visible log | partly | oracle file on disk only while a judge runs; one home per invocation, removed once its session is copied out; every session audited; suite runs never see the oracle's copied file (`653a4ba74`, `320fd822c`, `f4b72b035`) | `src/eval/sealed-workspace.test.ts`; `feedback-study.test.ts` (no prompt carries a held-back title, the neutral arm is told no finding); `agent-session.test.ts`; the audit column of every row |
| 8 | reach-pressure generation 3 re-derives its recorded summary without rewriting acquisition evidence | yes | nothing | run below |
| 9 | evidence headroom for the whole study | **no** | the two ledgers are packed losslessly once the study settles (`d39975674`) | measured below |

## 3 and 7. A defect found while qualifying: the held-back half reached the suite witness

A mined task's oracle is one shell command that copies the pull request's whole test file into
`swarm ci`'s checkout and runs one half of it by title. The file stayed. Every run of the
repository's own suite after the first oracle run therefore also ran the other half. Two readings
were wrong for it:

- **The bond's second detector.** A mutant the visible half accepted is witnessed by the
  repository's suite when a check that passed with the patch fails with the mutant. The check that
  passed ran before any oracle; the check with the mutant ran beside the copied file. A held-back
  case failing on the mutant was recorded as the repository's suite witnessing it. For this study
  that would have made a mutation finding's existence depend on the held-back half, and the
  prompt would have carried held-back information.
- **Regression attribution.** A failing check is re-run at the base to see whether the base
  already failed it. The base was measured beside the copied file, which fails there by
  construction, so a regression the patch caused could read as inherited.

The synthetic preflight exposed it: after a repair folded a function into one expression, its
single remaining mutant was "witnessed" by the repository's suite, which never calls that
function. The fix puts the checkout back to the base and the patch, writes the one mutant again,
and only then runs the suite; attribution cleans the checkout as well as checking out the base.
Both are general `swarm ci` defects: any oracle that writes into its checkout contaminates later
suite runs the same way. Two end-to-end tests through a real checkout hold both, and both fail on
the previous verifier (run and recorded before the fix was committed).

## 5. What is and is not charged to the agent

| event | read as |
| --- | --- |
| the endpoint does not answer a four-token completion within two minutes after the invocation (a dead server, or one whose generation thread died of GPU memory) | infrastructure |
| every model call of the invocation failed | infrastructure |
| the driver killed the agent at its deadline, four minutes past the agent's own wall budget | infrastructure |
| the agent process left no session to read | infrastructure |
| the agent stopped itself at its own wall budget, cancelling the call in flight | the agent's |
| a provider error partway through an invocation, on an endpoint that answers afterwards | the agent's, recorded and counted (the residual the hardening named) |

Observed during qualification, outside any confirmatory run: the first Gemma preflight invocation
exited in no time with no session (its model tag was wrong); it was recorded as an
infrastructure failure, not as a model that wrote nothing, and the driver stopped. A GLM server
whose generation thread died of Metal memory while another model held the GPU kept answering
`/models` and failed the completion probe, which is the wedge generation 1 of the reach-pressure
run mis-recorded.

## 7. Keeping the held-back half out of reach, as built

- Workspaces hold the base commit's history only; the driver refuses one where the merge commit or
  the test file's blob resolves (`prepareSealedWorkspace`).
- Prompts are built from the task text and visible verdict fields. The runners are never handed
  the held-back cases; tests put distinctive held-back titles beside every runner and check every
  prompt for them.
- The oracle file exists on disk only while a judge runs, outside every workspace.
- Each agent invocation runs under a home of its own, removed once its session is copied out. The
  shared child home the reach-pressure run used held 476 earlier sessions, prompts included.
- Every session's payloads, tool calls and their outputs, are searched for paths under the mined
  checkouts, the study's stores and any other invocation's workspace or home. Every row carries
  the result; an unreadable session is recorded as unchecked, never as clean.
- Held-back scoring refuses to start until every unit of every registered model has settled.
- Residual: the tool policy is lexical, and a process that reads a file silently is not seen by
  the audit.

## 8. Generation 3 re-derived

At `23703b189`, twice, with `node scripts/reach-pressure-experiment.mjs analyze --out <dir>`:

- `resultChanged: false`. The one changed pointer is `/schema`; 41 fields were added, all
  accounting and repair progress; none removed.
- The two derivations are byte-identical, and the summary equals the one the hardening published
  under `docs/evidence/2026-09-18/reach-pressure-hardening/rederivation/`.
- The published summary still digests to
  `sha256:7604c90d0121b5fd3e4a318f7b1e91eac4b214967ded5e170a74870f4e066fbc`, and the SHA-256 of
  every file under `docs/evidence/2026-09-17/` was the same before and after.

The shared paired-table refactor (`fa7da9b8c`) and the shared held-back scorer (`cf55d18bc`) run
under `src/eval/reach-pressure-derivation.test.ts`, which loads the committed rows and holds the
re-derivation to changing no published value.

## 9. Headroom

The tree sat at 90.6 MB under a 100 MB ceiling with 6 MB required free, so 3.4 MB could be spent.
Rows of this study carry whole mutants and both finding sets on every step: 4.2 to 4.3 KB a step
on the preflights, against 1.8 KB in the reach-pressure run. After the mining record and its packed candidate list were committed, the tree stood at 91.6 MB
with 8.4 MB free, so 2.4 MB may be spent before the 6 MB gate fails.

The study commits its two ledgers packed (`pack-ledgers`, `d39975674`): on the synthetic
preflight 72 KB of ledger became 4 KB, about 17 to 1, because every row repeats its identity
fields. Patches are committed as one content-addressed archive. A projection from the preflights:
two models over 154 tasks, about two prefix steps a task and six to seven arm steps an eligible
pair, is roughly 800 steps, 3.5 MB of raw ledger and about 0.2 to 0.3 MB packed; the patch
archive, from the reach-pressure run's patch sizes, about 0.5 to 1 MB. That fits with room to
spare. The gate itself is run after the evidence is committed, and its output is on the report.

## Model panel preflights

Unit tests cover the arms' prompts word for word, the absence of any finding from the prefix and
from the neutral arm, the held-back titles never reaching a prompt, witnessed-only mutation
findings, unmeasured readings, every terminal class, infrastructure attribution in prefixes and
arms, the resume schedule, the one-identity rule, the cohort cap, and the analysis's tables,
Holm's adjustment and the task-clustered bootstrap (`src/eval/feedback-study*.test.ts`,
`src/eval/agent-session.test.ts`, `src/eval/statistics.test.ts`, `scripts/feedback-study.test.mjs`).

The driver ran end to end over the five-task synthetic cohort (`scripts/feedback-study/preflight.mjs`),
through the real verifier: freeze, run, score, analyze in place twice (the second refuses a
changed byte), analyze beside it twice (byte-identical), pack the ledgers, analyze through the
archive (byte-identical), and `score` refused once packed.

| preflight | commit | acquisition | rows | infrastructure failures | invocations | stopped by the agent itself | sessions audited clean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| scripted stand-in, no model | `d39975674` | | 24 | 0 | 16 | n/a | n/a |
| `local:mlx-community/glm-4.7-flash-abliterated-8bit` | `4629e62cb` | `sha256:c047329b7882…` | 28 | 0 | 23 | 23 of 23 `completed` | 23 of 23 |
| `local:malekoo/Qwen3.8-27B-MLX-8bit` | `b0a7f17b1` | `sha256:c047329b7882…` | 22 | 0 | 17 | 17 of 17 `completed` | 17 of 17 |

Both model preflights ran under the acquisition identity this protocol registers. Between them
they produced reach findings (Qwen on the switch-statement task, GLM on three tasks), a witnessed
mutation finding (Qwen on the sign task), repairs that changed nothing, repairs that changed the
patch and kept the same findings, and one whose findings grew. Qwen's first preflight, at
`23703b189` before the ledger packing and the probe fix, produced the same terminal classes.

`gemma4:31b` was tried and not enrolled; see the panel. No task of the confirmatory cohort was run
and no held-back verdict of it was looked at while any of this was built.

## Addendum, 2026-09-19: a defect generation 1 exposed

Everything above was written for generation 1 and is left as it was. Item 7 claimed that each
invocation ran under a home of its own. It did, and its tool processes did not: the agent gives
every command it runs a home under its own scratch directory, `defaultChildHome()`, and the driver
gave the agent a private home and the shared scratch directory. So the agent's shell commands ran
with `HOME` in the shared child home, which holds the visible judge's evidence and the sessions of
every earlier run, generation 3 of the reach-pressure experiment included.

The session audit caught it on the first cohort unit: an npm debug log path under the shared child
home in the agent's own tool output. Nothing in that session read a held-back place. The
generation was stopped during its second unit, and its rows are kept under
[`generation-1/`](generation-1/results.jsonl).

The fix (`4f6d42b2a`) gives every invocation a scratch directory of its own beside its home, removed
with it, so the home the agent gives its tools is inside it. A test starts a process the way the
driver starts the agent and checks that the home it would give its tools is inside that scratch
directory. On the live preflights that followed, every session's own temporary files sit under its
private scratch directory, and no session names the shared child home.

Both preflights were run again under generation 2's acquisition identity; the protocol lists them.

## Addendum, 2026-09-19: a defect generation 2 exposed

The session audit reads each payload as JSON text and takes a reference from a forbidden root to
the first character that ends it. It stopped at quotes, whitespace and brackets and not at a
backslash, and every escape in JSON text begins with one. A colourised test runner in generation 2
ended the agent's own workspace path with `\u001b[39m`, the reference read on through the escape,
and the agent's own workspace no longer matched itself, so the audit recorded it as a place the
invocation should not have named. Nothing reads the audit during a run, so no prompt, verdict or
outcome depended on it; what it would have corrupted is the reported count.

A reference now ends at the first character a path cannot hold, and a trailing full stop or comma
is dropped (`9c4104e78`). The new tests fail on the previous tokenizer. Re-run over generation 2's
seventeen real sessions, with each session's own workspace and home read from its own records, the
corrected audit names nothing.

## Addendum, 2026-09-19: the audit's rule, settled on generation 3

Generation 3 showed a second shape of the same misreading: a stack trace hard-wrapped the agent's
own workspace path at 80 columns, and each fragment was read as a separate place. Rather than
answer one rendering at a time, the rule now says what every rendering leaves behind: a wrapped,
truncated or partly coloured path leaves a fragment that is an ancestor of the path it was. A
reference counts as the invocation's own where it is one of its own paths, lies under one, or is an
ancestor of one (`ea6a04740`). Every path into something that is not its own, a sibling arm, a
mined checkout, a stored oracle or another invocation's home, still counts, since none is an
ancestor of its own. What this gives up is a bare mention of a directory above the workspace,
which names nothing held there.

Re-run over every real session so far, 195 across generations 1 to 3 and every model preflight,
with each session's own workspace, home and scratch directory read from its own records, the audit
names exactly one reference: generation 1's npm log in the shared child home, the true finding
that stopped it.
