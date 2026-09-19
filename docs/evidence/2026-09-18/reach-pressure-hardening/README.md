# Hardening after the reach-pressure experiment

Written 2026-09-18, against `v13-main` as it stood at `34f9f1d2f`, the commit that indexed the
[reach-pressure experiment](../../2026-09-17/reach-pressure-experiment/report.md). This is an
audit of the instrument that ran it, the fixes that followed, and what each does to the evidence
already committed. No task was run and no model was asked anything to produce it. The experiment
was not rerun.

**What the experiment found still stands.** Seventy-nine tasks, thirteen visibly accepted, nine
reach triggers, no repair that satisfied reach, no discordant pair, and a reading of
"insufficient". Every row, held-back score, patch, the protocol and the published summary and page
are byte for byte what they were. The published summary re-derives under today's analysis with no
value changed (see [item 6](#6-driver-identity-and-post-run-derivation)). What the defects below
affect is how much the treatment could have shown, not what was observed: a reach refusal that
names a file nothing can execute is a weaker treatment than the protocol intended, which is a
reason a new experiment is worth running and not a reason to discard this one.

Commits `47c23aaab` through the head of this change. `npm run gates` output is at the end.

## Summary

| # | audited | correct before this work | changed here | affects committed evidence |
| --- | --- | --- | --- | --- |
| 1 | reach refusals over non-runtime files | partly: `.d.ts`, docs and `.test-d.ts` were set aside | one explained rule shared by three callers; `test-d/` and `_test` spellings; every exclusion reported | no |
| 2 | endpoint health measures generation | in the experiment driver only | two named probes; three campaign runners fixed | no |
| 3 | server death around an invocation | mostly, in the experiment driver | per-step attribution; no-call-answered rule kept across recovery; `pr-task-pass` resume fixed | no |
| 4 | repairs that repair nothing | no | six-way repair relation, per step and fork to final | no, derived beside it |
| 5 | scratch files passing as repairs | no | `temporary` and `retain` in the file-set tools, enforced by the gate; per-invocation scope on rows | no |
| 6 | driver identity and re-derivation | partly: one sentence on the page | component identities, derivation record, no overwrite | no, and now cannot |
| 7 | stopped generations excluded | at analysis only | `run` and `score` refuse too; identity read before parsing; tested on the real rows | no |
| 8 | reach uncertainty | mostly | a change with nothing judgeable reads `unmeasured`, not `reached`; every abstention tested | no |
| 9 | repair prompt | it named lines and nothing else | second, versioned wording; the first kept exactly | no |
| 10 | unknown usage | tokens yes, model calls and cost no | honest totals in four places | no value changed |
| 11 | repository weight | no: 99.8 of 100 MB | lossless in-tree packing, 90.4 MB, headroom gate | derived artifacts packed, none lost |
| 12 | duplicated logic | | identity check, source-file rule, attribution, totals | no |

## 1. False reach refusals for non-runtime files

**Before.** `4515b769f` taught the test-file rule the `.test-d.ts` spelling, with one test. That
fix was correct and incomplete in three ways. Reach, the mutant planner
(`src/gates/oracle-mutants.ts`) and the patch metrics each combined `namesATestFile` and
`aRunnerCouldLoadIt` on their own, so the three agreed by accident. tsd's other spelling, a
`test-d/` directory, was still source. And a file reach skipped was skipped silently: nothing in a
verdict said what `reached` had been reached over.

**Now.** `pathSetAside` in `src/gates/oracle-reach.ts` is the one path-level rule and all three
callers read it. Each class it sets aside carries its reason, and every reason is a statement
about what a runtime coverage report can contain, never about how a name looks:

| class | why runtime reach is undefined for it |
| --- | --- |
| `type-declaration` (`.d.ts`, `.d.mts`, `.d.cts`, generated or not) | types only, erased before anything runs, so no report can name a line of it |
| `type-test` (`.test-d.ts[x]`, `.spec-d.*`, anything under `test-d/`) | read by the type checker and executed by no runner |
| `candidate-test` (test directories, `.test.*`, `.spec.*`, `_test.*`) | the acceptance oracle runs its own test file and never the change's, so they are absent from its coverage by construction |
| `no-runner-loads-it` (docs, changelogs, JSON and extensionless fixtures, snapshots, YAML and TOML configuration, source maps) | no JavaScript runner loads it, so it has no executable line |
| `no-code-on-added-lines` | blank lines and bare punctuation execute nothing of their own |

Deliberately still judged, with tests holding each: `src/latest.ts`, `src/contest.js`,
`src/testing-helpers.ts`, `src/test-data.ts`, `src/latest-d.ts`, `src/d.ts`, `lib/changelog.js`,
`src/config.ts`, `jest.config.js`, `fixtures/server.js`, and the experiment's own `probe-tmp.js`
and `tsd-check.tmp.js`. A scratch script is executable and was never executed, so reach naming it
was the accurate half of those two refusals. JavaScript tool configuration stays judged for the
same reason: an interpreter loads it, V8 names it where a process does, and hiding it would hide
added behaviour. The verdict carries `setAsideByReach` and `swarm ci` prints it.

The cases come from the 150 distinct paths the mined corpus and the experiment's patches touch,
classified under the old rule and the new and compared by hand. The PR miner had a third spelling
of "source file" that still read a type test as source; it reads reach's rule now.

Tests: `src/gates/oracle-reach.test.ts` ("why reach sets a changed file aside", 23 exclusions, 16
near misses, the recorded shapes of commander#1557 and #1613),
`src/gates/independent-verification.test.ts` (end to end through a real checkout).
Historical evidence: unaffected. The report's estimate that a rerun would trigger on at most five
of the nine stands. New experiment: uses the corrected rule.

## 2. Endpoint health must measure generation

**Before.** `endpointGenerates` existed and the experiment driver used it. `endpointAnswers`
(GET `/models`) sat beside it under the more general name, and three other runners were exposed:

- `scripts/pr-task-pass.mjs` probed `/models`, at preflight and again only when a patch was
  empty. A wedged server passes both, and a server that dies partway leaves a partial patch that
  was judged as the model's.
- `scripts/redesign/pilot-run.mjs` returned the literal `healthy: true` beside an Ollama tag
  listing, so the campaign engine's one rule for an infrastructure failure could not fire while
  the daemon's process existed.
- `scripts/run-campaign.mjs` had no probe. A wedged server let the CLI run to its wall budget and
  exit cleanly, which was counted as a run the arm lost.

**Now.** `src/eval/endpoint-health.ts` holds `endpointListsModels` and `endpointGenerates`, named
so neither can stand in for the other. Only the second may decide attribution. It takes an
injected fetch, keeps one deadline over the request and the body, and names its failure:
`timeout`, `unreachable`, `http-error`, `unreadable-body`, `no-usable-choice`. All three runners
use it after every invocation. The metadata probes that are legitimately about metadata (local
discovery, the served-model default, the Ollama provenance checks) are untouched.

Tests, none touching a network: `src/eval/endpoint-health.test.ts` (metadata answers and the
completion hangs; metadata answers and the completion errors; success; HTTP success with no usable
choice, six shapes; a body that stalls after its headers; a timeout attributed to infrastructure),
`src/eval/frozen-campaign.test.ts` (a server that dies under a launch).
Historical evidence: generation 3 already ran under the generating probe. The mined pass's
committed `scored*.json` hold no infrastructure row, so nothing there was misread by this.

## 3. Mid-run server death and GPU memory exhaustion

**Before.** The driver probed after every invocation, stopped dispatching, capped reschedules and
closed dangling launches, which is what made generation 3 sound. What was missing: a step under a
dead server was recorded with a `no-change` observation and nothing saying it was not the agent's;
the all-calls-failed rule and the probe were two inline conditions; and `pr-task-pass` wrote its
infrastructure row into `runs`, where a resume skips it and `--rejudge` judges it, so its own
instruction, "fix the endpoint and run it again", could not be followed.

**Now.** `attributeInvocation` is the one rule: the endpoint generated afterwards, and at least one
model call of the invocation was answered. Every step records its attribution. A step read as
infrastructure keeps its invocation and the patch it left, is never judged, carries no repair
relation, scores nothing and ends dispatch. `pr-task-pass` keeps such attempts under
`infrastructureFailures`, apart from `runs`. The resume decision is `scheduleOf`, a tested function.

Looking for where generation 3's ten unknown-usage invocations came from found something the rows
did not say: every one is a single model call in flight when the twelve-minute wall budget ended,
after 24 to 38 answered calls, recorded as `call-failed` with "This operation was aborted". They
are an agent out of time and are correctly the agent's. The ledger could not tell that from a
provider that raised, so a failed model call now records `cancelled`, and a row carries
`cancelledCalls` and `endedOnProviderFailure`.

No retry was added anywhere. The supervisor restart the protocol already describes is unchanged.

Tests: `src/eval/reach-pressure.test.ts` ("a model server that dies before, during or after an
invocation"), `src/eval/reach-pressure-derivation.test.ts` ("resuming a run without repeating or
losing an attempt"), `src/evidence/model-call-recording.test.ts`.
Historical evidence: unaffected; generation 3's one infrastructure attempt (commander#1678,
attempt 1) was classified correctly when it ran.

## 4. Repair feedback that produces no meaningful repair

**Now.** `src/eval/repair-progress.ts` reads a repair as a relation between two sets of blocking
findings and two stored patches: `patch-unchanged`, `findings-identical`, `findings-moved`,
`findings-shrank`, `findings-grew`, `satisfied`. A record holds both finding sets, what was
resolved and introduced, both patch digests, and the paths whose section of the patch changed,
entered or left. A finding is named by the text of its line where the patch can be read, so a
renumbered line is not read as a new one, and by line number, marked as such, where it cannot.
No score is computed: whether source got better is not something this harness can observe.

Generation 3, derived from its rows with line-number identity and labelled as derived:

| fork to final | tasks |
| --- | --- |
| `patch-unchanged` | 6 |
| `findings-grew` (dayjs#3180, commander#1832: a scratch file, one more unexecuted file) | 2 |
| `findings-identical` (commander#1671: the agent's own example edited) | 1 |

Tests: `src/eval/repair-progress.test.ts`, `src/eval/reach-pressure.test.ts` ("what a repair did
to the verifier's findings", one case per relation).

## 5. Scratch and diagnostic artifacts

**Before.** The file-set gate checks membership. A probe script the agent had declared or amended
in was a member and passed, and nothing in the workflow had a word for a file that is allowed to
exist and not meant to stay.

**Now.** `declare_file_set` and `amend_file_set` take `temporary`. Such a path is authorized like
any other and owed a removal, and the blocking `file-set` gate fails while one is still in the
change, naming it. An amendment can `retain` one, and its reason then travels with the file on the
ledger, in the reviewer's claim and in the gate's output on every pass. Nothing is deleted behind
the model's back and nothing reads a filename: the tests keep a new source file called
`tmp-cache.js` and fail a leftover called `inspect.js`. The pinned legacy system prompt is
unchanged, because runs are compared under it; the tool descriptions and the concise prompt carry
the instruction. Experiment rows now hold, per invocation, the files it added against what that
session's own ledger declared: never declared, declared temporary and left, or retained and why.

Tests: `src/gates/temporary-files.test.ts` (created and removed; created and left; a legitimate
new file; a deliberate retention; replay from the ledger), `src/eval/reach-pressure.test.ts`.
Residual, inherent: an agent that never records a file as temporary is held only by membership,
as before. The harness cannot know a file's purpose unless told, and guessing from its name is
what this avoids. Such a file is still named on the row as having entered the patch.

## 6. Driver identity and post-run derivation

**Before.** `analyze` wrote `summary.json` and `report.md` in place, whatever they had held, and
the page said in one sentence that its sources differed from the registered ones. Nothing stopped
a later fix from replacing the published numbers.

**Now.**
- Four identities, each a digest over named sources: acquisition, scoring, analysis, renderer
  (`identitySources`). A protocol of schema `swarm.reach-pressure.protocol.v2` registers
  acquisition and scoring, which `run` and `score` enforce. Analysis and rendering are recorded by
  each derivation and not registered, so a correction stays possible and visible. Generation 3's
  ten-source driver digest is kept as the formula its protocol used.
- A published summary or page is never overwritten by different bytes. A differing derivation is
  written to `--out` with a `derivation.json` stating the acquisition identity read off the rows,
  the derivation identities, the commit it ran at, the digests of the observations it read and did
  not write, the fields it re-derived, whether any published value changed, and every JSON pointer
  changed, added or removed.

[`rederivation/`](rederivation/) is generation 3 derived by this checkout. Its
[`derivation.json`](rederivation/derivation.json) records `resultChanged: false`: the one changed
pointer is `/schema`, the summary's shape label, and everything else is added accounting and
repair-progress fields. The published files are untouched.

Tests: `src/eval/reach-pressure-derivation.test.ts`, which loads the committed rows and holds the
re-derivation to changing no published value, to being the same bytes twice, and the in-place
write to refusing both a moved value and an added field.

## 7. Historical generations stay excluded

**Before.** `analyze` refused mixed rows. `run` and `score` did not look, so rows left in place
across a protocol change would have had settled tasks skipped and open ones continued under the new
generation, surfacing only at analysis. Generations 1 and 2 were kept apart by moving files by
hand. A generation 1 row also fails today's row schema, so a stray one would have been refused as
malformed and not as foreign.

**Now.** `assertOneAcquisition` is the one identity rule. `run` and `score` apply it before
writing, `analyze` before parsing, and `summarize` calls the same function. It reads identity
before contents. The tests put the committed generation 1 and 2 rows beside generation 3's and
hold every entry point to refusing them, first, last and in the middle, and a held-back score of
another generation with them. Exercised for real against the synthetic cohort as well: a
generation 2 row appended to its results made `run`, `score` and `analyze` each refuse.

## 8. Reach measurement uncertainty

Audited path by path. Already abstaining correctly: no oracle, an unrecognized or shell-decided
runner, a failed instrumented run, no report, an empty report, a missing coverage directory,
transformed offsets past the end of a file, a tree the vacuity check could not restore, and an
absent field in the experiment's own reading (`?? "unmeasured"`).

**One conversion found.** A change whose every file was set aside came back `reached`: nothing was
unreached, so vacuous truth read as a measurement. It is `unmeasured` now, with the set-aside files
named. Certification treats the two alike, so no verdict flips; a reader does not. An unavailable
command is now an explicit abstention where it had been an incidental one.

Kept on purpose: a file the run never loaded is a reading (`unreached`), not an abstention. An
oracle that ran nothing the patch changed must not look thorough.

Tests: `src/gates/oracle-reach-abstention.test.ts` (each arm, each way of having no reading),
`src/gates/independent-verification.test.ts`.
Inherent limits, named in the code: the jest and vitest arms cannot tell a file the run never
loaded from one the project's own coverage configuration excludes; a transforming loader whose
offsets stay inside the file is undetectable; and the reports are written by the workspace's own
processes.

## 9. Repair prompts

**Before.** The reach refusal named the lines and what certification requires. Across eighteen
repair invocations that produced six unchanged patches, two scratch files and one edited example.

**Now.** The wording is part of the treatment, so it is versioned and never edited.
`reach-pressure-v1` is generation 3's, word for word, under the policy digest it froze, with a
test holding the exact text. `reach-pressure-v2` adds: that the acceptance check and the
repository's checks still have to pass after any revision; that the acceptance check exercises the
behaviour the task describes, so the repair belongs in that implementation; that a named line
which is not executable behaviour may be left, with the agent saying which and why; and that
tests, examples, documentation and new unloaded files cannot change what the acceptance check
executed and are not a repair. Neither says what to write, asks for less code, or mentions a
held-back case, and a test holds both to that. With item 1 in place the prompt can no longer name
a file nothing executes.

Tests: `src/eval/reach-pressure.test.ts` ("the two wordings of a reach refusal", exact text).

## 10. Resource accounting and unknown usage

| where | before | now |
| --- | --- | --- |
| experiment analysis | a null model-call count was added as zero while tokens went null beside it | `knownTotal`: a total is a number only where every part was measured; the known subtotal is kept under its own name with the count it is missing; the page says accounting is incomplete |
| arm scoring | a crashed run cost `0` and was summed into dollars per accepted patch | cost is null, the arm's cost per accepted patch is null with it, and the report says how many runs did not report |
| core loop | an unreported call added zero tokens, silently | the total is unchanged, since predicates and replay read it, and the outcome and settled budget record carry `callsWithUnknownUsage` |
| calibration speed | an unknown-usage call put its seconds in the denominator and nothing in the numerator, so a model with one call cut off measured slower, and selection compares that number | speed is taken over the calls that reported both |

Generation 3 has no null model-call count, so its 769 and 388 stand. Its page already printed
token totals as unknown. Wall time is the driver's own clock and is always known.

Tests: `src/eval/reach-pressure-analysis.test.ts` ("totals over usage that was only partly
reported"), `src/eval/arms.test.ts`, `src/core/loop.test.ts`,
`src/select/calibration-measures.test.ts`.

## 11. Repository evidence size

The tree was at 99.8 of 100 MB, which left this work no room to be committed. A tenth of it was
78 raw run transcripts and 12 rendered review pages: views of the records that no verifier and no
check reads, compressing about ten to one. `scripts/evidence-pack.mjs` packs tracked derived
artifacts under a root into the existing `utf8-file-map-brotli` format with an inventory of every
original's digest, removes originals only after the written archive has been unpacked and
compared, and verifies every committed pack in `npm run checks`. What may be packed is the
offload's own definition, so a ledger, DAG, manifest or verifier never can be. No Git LFS, no
second repository, nothing deleted: 10.2 MB became 0.6 MB and the tree is at about 90.5 MB. All
fourteen cited bundles still verify from the checkout.

`scripts/check-repo-weight.mjs` now also requires 6 MB free under the ceiling, sized from what
experiments here have cost in tracked bytes, and a confirmatory `run` checks it before its first
task. ADR 0010's separate evidence repository remains the larger answer and remains a proposal.

Restore: `node scripts/evidence-pack.mjs restore <pack directory>`.
Tests: `scripts/evidence-pack.test.mjs`, `scripts/check-repo-weight.test.mjs`.

## 12. Adjacent duplicated logic

| concern | finding |
| --- | --- |
| judging, held-back settlement | one definition already (`halfJudgeFor`, `settleHeldBack`), read by the pass, the re-judge and the experiment. `second-oracle-pass.mjs` and `rescore-real-repos.mjs` judge different corpora from different inputs and were left alone |
| reach classification | three callers and the miner each spelled it; one rule now |
| endpoint health, attribution | two probes with misleading names and three inline rules; one module now |
| repair classification | none existed |
| usage accounting | `knownTotal` shared by the analysis and arm scoring. `knownSum` in the goal campaign report returns null for an empty list on purpose and was left |
| identity validation | `summarize` and `assertOneAcquisition` were two copies; one now |

## Not changed, and why

- **CLI exit codes.** A run in which every model call failed exits 1, like a run whose gates
  failed. The harnesses attribute from the ledger and the probe, never from the exit code, and the
  codes are a public interface.
- **The pinned legacy system prompt**, for the reason in item 5.
- **Any historical row, score, patch, protocol, summary or page.**

## Remaining limitations that are inherent

- A provider error partway through an invocation, on an endpoint that then recovers, is still
  charged to the agent. It is recorded (`endedOnProviderFailure`) and counted, and nothing can tell
  a transient fault from a request the agent's own transcript made too large to serve.
- The health probe is one sample after the invocation.
- Repair relations say what changed between two sets, never whether code got better.
- Relations derived for rows that predate the record use line numbers, so a renumbered line reads
  as moved. Generation 3's three changed repairs were checked file by file against the committed
  patches: `probe-tmp.js` entered dayjs#3180, `tsd-check.tmp.js` entered commander#1832, and
  commander#1671 rewrote `Readme.md` and one test and nothing under `lib/`, which is what the
  derived relations and the pair notes both say.
- An agent that never says a file is temporary is held only by membership.
- The three coverage limits in item 8.

## Is the repository ready for a new verification-feedback experiment?

Yes. A new protocol should be written as schema `swarm.reach-pressure.protocol.v2`, register the
acquisition and scoring identities `freeze` prints, and name `reach-pressure-v2` as its policy. It
runs under the corrected reach rule, the generating probe, per-step attribution, recorded repair
progress and scope, honest totals and a tree with room for its evidence. The driver was exercised
end to end over the synthetic cohort with the scripted agent after these changes: run, score,
analyze, an idempotent second analyze, a resume that dispatched nothing and added no row, and a
foreign row refused by all three phases. Design questions the experiment itself raised are outside
this work: one model, one trajectory per task, and thirteen visible acceptances in seventy-nine.
