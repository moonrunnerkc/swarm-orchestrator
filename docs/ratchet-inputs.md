# What the ratchet reads, and who could have written it

Every input the session ratchet takes, classified by who authored it: the harness, or the code
the harness is measuring. An input the code under measurement can author is not evidence about
that code, so each one below is either moved to something the harness computes or abstained on
by name. This document is the inventory and the record of which was chosen for each and why.

Written on 2026-08-31 against `src/gates/ratchet.ts`. Line citations are to that state.

## The shape of the question

`judgeRatchet` in `src/gates/ratchet.ts:114` compares two states and returns violations and
abstentions. It reads five things, declared at `src/gates/ratchet.ts:46` through `:57`:

| input | field |
| --- | --- |
| gate results before | `baselineGates`, `src/gates/ratchet.ts:47` |
| gate results after | `candidateGates`, `src/gates/ratchet.ts:48` |
| the numbers before | `baseline: MeasureSnapshot`, `src/gates/ratchet.ts:49` |
| the numbers after | `candidate: MeasureSnapshot`, `src/gates/ratchet.ts:50` |
| tests cleared as new specifications | `newSpecifications`, `src/gates/ratchet.ts:57` |

A `MeasureSnapshot` is seven fields, `src/gates/measure-snapshot.ts:16` to `:31`. So the whole
input surface is eleven things, and each is below.

## The inventory

### 1. Per-file test measures: `perTestFile`

**Declared:** `src/gates/measure-snapshot.ts:18`. **Computed:**
`src/gates/measure-snapshot.ts:83`, `measureTestFile(await input.probe.readCurrent(path))`.
**Compared at:** `src/gates/ratchet.ts:143` (tests declared), `:155` (assertions), `:168`
(skip markers).

**Harness-computed.** The file's text is authored by the run, and the counting is not: the
harness reads the file with `readCurrent` (`src/gates/git-workspace.ts:88`, a filesystem read)
and counts it with `measureTestFile` (`src/gates/measures.ts:148`). No number here is taken
from anything the run printed or declared about itself. That is the right posture and it is why
these three arms are the ones that hold when every runner-reported measure abstains.

**Resolution:** none needed.

### 2. Per-file test measures at the base commit: `perTestFileAtBase`

**Declared:** `src/gates/measure-snapshot.ts:25`. **Computed:**
`src/gates/measure-snapshot.ts:84`, from `probe.readBase`, which is `git show` against the base
ref (`src/gates/git-workspace.ts:90`).

**Harness-computed.** The base commit is history; a run cannot edit it without rewriting the
repository, and the working tree it can edit is read separately.

**Resolution:** none needed.

### 3. Tests the runner collected: `testsCollected`

**Declared:** `src/gates/measure-snapshot.ts:27`. **Compared at:** `src/gates/ratchet.ts:179`,
producing the `tests-collected-decreased` violation.

**Was authorable. This is the finding this pass closed.**

Until this change the number came from `gateMeasures[measureNames.testsCollected]`, merged in
`src/gates/gate-runner.ts:179` from whatever a parser read out of a gate's stdout and stderr.
Two of the three readers take the first match in that text:

- `readTestCounters` (`src/gates/parsers.ts:214`) takes `RegExp.exec`'s first `# tests <n>`.
- `vitestTestParser` (`src/gates/parsers.ts:106`) takes the first line matching
  `^\s*Tests\s+(.+?)\s*$`, and reads the count out of the parenthesis on it.

A test in the suite that writes `Tests  9999 passed (9999)` to stdout supplies that line before
the runner's own summary exists, and it is the one the reader takes. Measured, not reasoned
about: over the text a forged line and a real summary both appear in, the reader returns 9999.

That number is a blocking comparison. Raising it hides a deletion the per-file arms did not
see, and they miss exactly the deletions that happen in files `isTestFile`
(`src/gates/measures.ts:125`) does not recognize as test files. So the evasion is real and it
is specific: delete tests from a file the recognizer misses, print a higher count, and the only
arm that would have caught it reports an increase.

Node's own TAP reporter escapes a leading hash in output it captured from a test, so the
`# tests` spelling does not get through node's reporter. That is a defence node happens to
provide for one runner. It is not a property of the input.

**Resolution: moved into the harness, with an abstention where the harness cannot obtain it.**

The coverage arm already solved this shape: the runner writes a report to a path the harness
named, outside the workspace, and the harness reads the file. The same now applies to the
count. Where the harness can express the declared test command as an argument vector it spawns
itself (`harnessControlledNodeTest`, `src/gates/node-test-command.ts:242`), it adds a second TAP
reporter writing to `testCountArtifactPath` (`src/gates/test-count-artifact.ts:30`) beside the
lcov report, and reads the count out of that file (`src/gates/test-count-artifact.ts:48`, gathered at `:65`). The
snapshot takes it from there and from nowhere else (`src/gates/measure-snapshot.ts:95`).

Where the harness cannot vouch for the invocation, no result is asked for, nothing is read, and
the arm abstains by name through `compareOptional` (`src/gates/ratchet.ts:266`). That covers
every runner that is not node's own: vitest, pytest, cargo, go. Those projects lose an arm and
keep the three source-counted ones, which is stricter about honesty and narrower in coverage.
That trade is the one the ground rule names: abstain rather than emit an unverified number.

`gateMeasures` was removed from `SnapshotInput` rather than left unread, because a field nobody
reads is where the next numeric gets wired back in.

### 4. Tests the runner skipped: `testsSkippedByRunner`

**Declared:** `src/gates/measure-snapshot.ts:28`. **Compared at:** nowhere. The ratchet's skip
arm counts skip markers in the source (`src/gates/ratchet.ts:168`), not the runner's report.

**Was authorable, by the same route as `testsCollected`, and reached no comparison.** It is
carried in the snapshot and read by nothing that decides anything.

**Resolution: moved with `testsCollected`,** from the same artifact
(`src/gates/measure-snapshot.ts:96`), because leaving one field of a pair on the old source is
how the old source comes back.

### 5. Coverage of changed lines: `changedLineCoverage`

**Declared:** `src/gates/measure-snapshot.ts:29`. **Computed:**
`src/gates/measure-snapshot.ts:123`, from `coverageReports` intersected with the added lines of
the diff. **Compared at:** `src/gates/ratchet.ts:196`.

**Harness-computed, already.** The report comes from a path the harness named and cleared
before the run (`src/gates/gate-runner.ts:239`), under the session store invariant 11 keeps
outside the workspace, written by a vector the harness built and spawned with no shell in
between. Nothing printed is read. A report that is not complete lcov parses as nothing and the
arm abstains.

**Resolution:** none needed. This is the pattern the count above was moved onto.

### 6 and 7. Covered and measured changed lines

**Declared:** `src/gates/measure-snapshot.ts:30` and `:31`. Same source as the ratio, and the
ratchet compares neither directly; the attempt selector reads them
(`src/workers/attempt-selector.ts:119`).

**Harness-computed.** **Resolution:** none needed.

### 8 and 9. Gate results before and after

**Declared:** `src/gates/ratchet.ts:47` and `:48`. **Computed:** `src/gates/gate-runner.ts:178`,
`statuses[gate.id] = reading.status`, where `reading` is the gate's parser over the command's
exit code and output. **Compared at:** `src/gates/ratchet.ts:131`.

**Authorable, and neither of 2.2's two resolutions applies. Recorded as such rather than
improvised around.**

A gate's verdict is the verdict of the command the project declared. The exit code and the
output are produced inside the workspace, so a project whose test script exits zero has a
passing tests gate, and there is no harness-side recomputation of "did this project's tests
pass" that does not consist of running the project's tests. Moving the computation into the
harness is not available.

Abstaining is available and would be a loosening rather than a tightening: the arm exists to
catch a gate that passed before an attempt and does not after, and an arm that abstains on
every gate catches nothing. Section 7's division of labour is the reason this is tolerated: the
gate results are the boolean half and are known to be gameable, which is why the numeric ratchet
exists beside them and why invariant 7 spells its arms out. The two halves are both required,
and a run holding a gate green by deleting tests is caught by the numerics rather than here.

One thing the harness does verify, and should be named so it is not mistaken for the whole: a
gate that passed at the baseline and reports anything else afterwards is a violation, including
`not-applicable`. So standing a gate down is not a way out of the comparison
(`src/gates/ratchet.ts:131`), and a gate that did not run at all is abstained on by name rather
than assumed unchanged (`src/gates/ratchet.ts:125`).

**Resolution: kept, documented, and mitigated by the numeric arms.** This is the one input in
this inventory that neither of the two options fits, and saying so is more useful than picking
one of them because the task offered two.

### 10. Tests cleared as new specifications: `newSpecifications`

**Declared:** `src/gates/ratchet.ts:57`. **Computed:** `findNewSpecifications`
(`src/gates/auto-resolve.ts:150`), from control runs in `src/gates/base-control.ts:87`. **Used
at:** `src/gates/ratchet.ts:141`, through `comparableTotals`, where a cleared test pays for one
deletion.

**Harness-computed, already, and deliberately.** Which tests failed on the base source is read
from the machine-readable result the harness asked node's own runner to write, at a path the
harness named and cleared (`src/gates/base-control.ts:96`, read back at `:119`), and from
nothing else. The reporter output a person reads is carried into the record and is read only to
withhold an exemption, never to grant one (`src/gates/base-control.ts:112`). Where no such
result can be asked for, nothing is attributed and nothing is cleared.

**Resolution:** none needed.

### 11. The diff the numbers are measured over

**Declared:** `GateContext.changes`, `src/gates/gate-definition.ts:41`, reaching the snapshot at
`src/gates/auto-resolve.ts:227`. **Computed:** `src/gates/git-workspace.ts:73`, from git.

**Harness-computed.** A run can change the working tree, which is the thing being measured, and
cannot change what git reports about the difference between the tree and the base commit.

**Resolution:** none needed.

## One input that is not the ratchet's and decides all of them

The command a gate runs is read from the manifest **at the base commit**, falling back to the
working tree only where the base had none (`src/gates/engine.ts:78`). That is not on the list
above because it is not an input to `judgeRatchet`, and it is worth naming here because it is
the same class of defect one level up: a run that rewrites its own test script authors the
instrument that measures it. It is closed, and `src/gates/measuring-command.test.ts` holds it.

## Summary

| input | classification | resolution |
| --- | --- | --- |
| `perTestFile` | harness-computed | none needed |
| `perTestFileAtBase` | harness-computed | none needed |
| `testsCollected` | **was authorable** | moved to a harness-named artifact; abstains where none |
| `testsSkippedByRunner` | **was authorable** | moved with it; reaches no comparison either way |
| `changedLineCoverage` | harness-computed | none needed |
| `changedLinesCovered` | harness-computed | none needed |
| `changedLinesMeasured` | harness-computed | none needed |
| `baselineGates` | **authorable** | kept: neither option applies, see section 8 and 9 |
| `candidateGates` | **authorable** | kept: neither option applies, see section 8 and 9 |
| `newSpecifications` | harness-computed | none needed |
| the diff | harness-computed | none needed |

Held as tests in `src/gates/ratchet-inputs.test.ts` and `src/gates/test-count-artifact.test.ts`,
and end to end in `src/gates/auto-resolve.test.ts`, where a counter block printed ahead of the
runner's own no longer reaches the comparison.

## What this does not close

The per-file arms count what `isTestFile` recognizes as a test file
(`src/gates/measures.ts:125`), which is a name-shaped heuristic. Tests in a file it does not
recognize are counted by no arm at all once the collected count abstains, which is every project
whose runner the harness cannot vouch for. That is a narrower gap than the one it replaces, and
it is a gap: a project on vitest that keeps tests in files the recognizer misses has no arm
watching them. Widening the recognizer is a different change from this one and wants its own
evidence.
