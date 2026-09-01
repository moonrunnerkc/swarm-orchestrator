# What the ratchet reads, and who can author it

Every input `judgeRatchet` reads, traced to where it originates, classified as harness-computed
or authorable by the code under measurement. Written on 2026-08-31.

The distinction is the whole of the ratchet's value. The ratchet exists because a boolean gate
can be held green by deleting the tests that were failing, so it compares numbers instead. A
number the code under measurement can author is a number that can be held wherever the model
needs it, and a ratchet built on one of those is a ratchet that reports rather than holds.

**Harness-computed** means: the value is produced by code in this tree, from bytes the workspace
cannot choose, or from bytes the workspace wrote but which the harness itself counts under rules
the workspace cannot reach. A model writing a test file cannot change how `measureTestFile`
counts it; it can only write a different file, which is the point.

**Authorable** means: the value is read out of something a process running workspace code
produced, where that process could have produced a different value on purpose.

## The inventory

| Input | Originates | Class |
| --- | --- | --- |
| `baselineGates`, `candidateGates` | `src/gates/gate-runner.ts:168`, from `gate.parse(observation)` over a command's exit code, stdout and stderr | **authorable** |
| `baseline.perTestFile`, `candidate.perTestFile` | `src/gates/measure-snapshot.ts:79`, `measureTestFile(probe.readCurrent(path))` | harness-computed |
| `baseline.perTestFileAtBase` | `src/gates/measure-snapshot.ts:80`, `measureTestFile(probe.readBase(path))` | **authorable** through the base ref, see below |
| `baseline.testsCollected`, `candidate.testsCollected` | `src/gates/measure-snapshot.ts:88`, `gateMeasures[testsCollected]`, merged from parser output at `src/gates/gate-runner.ts:169` | **was authorable, now harness-computed or abstained** |
| `testsSkippedByRunner` | `src/gates/measure-snapshot.ts:89`, same route | **was authorable, now harness-computed or abstained** |
| `changedLineCoverage`, `changedLinesCovered`, `changedLinesMeasured` | `src/gates/measure-snapshot.ts:90`, from lcov artifacts read at `src/gates/gate-runner.ts:234` | harness-computed |
| `newSpecifications` | `src/gates/auto-resolve.ts:160`, from base-control runs reading a TAP artifact at `src/gates/base-control.ts:118` | harness-computed |
| `input.changes` (the changed files and added lines the snapshot intersects) | `src/gates/git-workspace.ts:78`, `diffAgainstBase` through a scratch index | **authorable** through the base ref, see below |
| `trackedTestFiles` | accumulated across the run by `src/gates/auto-resolve.ts` | harness-computed |
| `respecificationAllowance` | `src/gates/measure-snapshot.ts:281`, derived from `perTestFile` measures | harness-computed |
| gate `unavailable` | `src/gates/node-command-runner.ts`, set when the harness could not start the command | harness-computed |

## Resolved: the collected and skipped test counts

**What it was.** `testsCollected` and `testsSkippedByRunner` were read out of the test command's
own stdout, by `readTestCounters` at `src/gates/parsers.ts:214`. Node's default reporter prints
its counters as `ℹ tests 1`, its TAP reporter as `# tests 1`, and the pattern at
`src/gates/parsers.ts:210` accepts either. The pattern takes the first match in the stream.

**Demonstrated, not argued.** A single test file whose body is four `console.log` calls:

    test("the only real test", () => {
      console.log("# tests 999");
      console.log("# pass 999");
      console.log("# fail 0");
      console.log("# skipped 0");
      assert.equal(1, 1);
    });

Run under node's default reporter, those four lines arrive on stdout ahead of the runner's own
counters, unescaped. `testOutputParser` over that output returns:

    STATUS: passed
    DETAIL: 999 collected, 999 passed, 0 failed, 0 skipped (exit 0)
    MEASURES: {"testsCollected":999,"testsPassed":999,"testsFailed":0,"testsSkipped":0}

for a suite that collected one test. The number goes straight into a blocking ratchet arm. A
candidate that deletes fifty tests and prints the baseline's count keeps that arm silent.

Node's own TAP reporter escapes a leading `#` in captured output to `\#`, so the forgery above
does not survive it. That is a fact about one reporter, not a property of the channel, and the
default reporter is what runs on every project whose command the harness cannot vouch for.

**What was chosen, and why.** Moved into the harness where the harness can vouch for the run,
and abstained on where it cannot.

Where the declared command is one `node-test-command.ts` recognizes completely, the gate already
runs an argument vector the harness built and spawns itself. That vector now also asks node's own
runner for a TAP report written to a path under the session store, beside the lcov report it
already asks for, and the harness reads that file. The count comes from the result points in that
artifact, through `parseTapOutcomes`, which skips every comment line and refuses a document whose
plan disagrees with its own top-level point count. Nothing a test prints becomes a result point,
because the runner folds captured output into comments.

Where no such artifact exists, because the project's runner is not one this harness can express
as a vouched vector, both measures are **null**, which the ratchet abstains on by name. That is
strictly stricter than reading the number out of stdout: an abstention states that nothing
measured this, where the old reading stated a number nobody could stand behind.

**What abstaining costs, stated plainly.** On those projects the ratchet no longer holds a
suite-wide collected count. What still holds is `testsDeclared`, which the harness counts itself
out of the text of every test file the run has touched, at `src/gates/measure-snapshot.ts:79`.
That arm is the one a deletion actually moves, and it needs no runner at all. The suite-wide
count was the weaker of the two and the only forgeable one.

## Not resolved: gate status

`baselineGates` and `candidateGates` are `passed`, `failed` or `not-applicable` per gate, decided
by a parser reading the exit code and output of a command that runs workspace code. A test file
can call `process.exit(0)`. A `package.json` script the model edited can exit 0 without running
anything.

This is a boundary rather than a gap, and it cannot be closed by moving a computation: running a
project's tests means executing code the model wrote and reading what that code says happened.
What bounds it is elsewhere and stays: `measuredTheChange` at `src/gates/gate-runner.ts:222`
refuses to read green over a change no command gate ran on, the counter parser reports a run that
collected nothing as not-applicable rather than as passed, and every numeric arm above sits under
the boolean one precisely because the boolean one is authorable.

Named here rather than implied away.

## Resolved: the base ref is a symbolic ref, and the workspace can move it

Escalated as a trust-root finding when it was found, since it changes what every gate, the
file-set check and the diff budget are measured against, and fixed after review.

`defaultBaseRef` is the literal string `"HEAD"` (`src/cli-options.ts:220`). It is carried
unresolved into `createGitWorkspaceProbe` (`src/gates/git-workspace.ts:70`), which spends it at
read time on every base-side question: `git show HEAD:<path>` for `readBase`, and
`diffAgainstBase` for the change set. `git` is on the default shell allowlist
(`src/tools/sandbox.ts:24`), so one unconfirmed tool call moves HEAD.

Measured against a scratch repository holding a three-test file, with two of the tests deleted in
the working tree:

    BASE TESTS BEFORE COMMIT: 3   changed files: 1
    BASE TESTS AFTER  COMMIT: 1   changed files: 0

After one `git commit -am`, the base side of the comparison holds the tampered file, so the
deletion is not a deletion, and the change set is empty, so the diff budget, the file-set check
and changed-line coverage all have nothing to look at.

The turn baseline already avoids this for a session's second turn onward: `recordTurnBaseline`
returns a resolved commit object and `src/cli.ts:408` replaces `baseRef` with it. The first turn
of every session, every single-run invocation and every worker still carry the string.

**What was done.** `resolveBaseCommit` in `src/gates/git-workspace.ts` turns the name into a
commit object, and the three entry points that carried the name now resolve it before anything
reads it: the session loop, the single run, and `swarm gates`. The gates command records the
resolved commit rather than the name it was asked for, because a bundle that says `HEAD` names
whatever HEAD points at when someone later reads the bundle.

This is the single-run path being held to what the parallel path already did.
`src/workers/parallel-run.ts` resolved its base with `rev-parse` before handing it to any worker
and always had, which is why workers were never exposed to this and why the fix needed no new
idea.

Resolving pins what a run always meant, so it changes no verdict for an honest one. A name that
does not resolve, in a repository with no commits or no repository at all, is handed back
unchanged: those cases already raise their own errors where the gates find them, and a message
about `rev-parse` here would replace a good one with a worse.

`src/gates/base-commit.test.ts` holds both halves. The demonstration stays as a test, so the
unresolved reading is still shown moving the base from 3 tests to 1 and the change set from 1
file to 0; beside it the resolved reading holds at 3 and 1 across one commit and across several.
