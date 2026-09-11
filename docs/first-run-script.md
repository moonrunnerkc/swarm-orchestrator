# The ten-minute first run, as a script somebody else follows

Gate 12 asks whether a new user can install, initialise a policy, make a safe test-backed fix,
verify signer identity, and understand the result in under ten minutes. It is the one gate that
cannot be self-certified: it needs a person who has not seen this tool, and a stopwatch.

This is the script that run would follow. It is not the run. **Nothing here has been timed and
gate 12 stays unproven** until somebody who has not read this repository sits for it. Timing the
author is not a weaker version of this measurement, it is a different one, and reporting it as
this one is the collapse of *unmeasured* into a number that the rest of this project exists to
refuse.

## What the run needs

**One person who has not used this tool.** They may be a working engineer, and they must not have
read this repository, watched a demo of it, or been walked through it. Somebody who has seen it
once is a second run, recorded separately.

**One observer, silent.** The observer starts the clock, writes down what happens, and answers
nothing. A question the subject asks out loud is data: write down the question and say "I cannot
help with that, do what you would do on your own." An observer who explains the tool has measured
themselves explaining it.

**A machine with Node 24 or newer, git, and a network connection.** Nothing else installed
beforehand. Not the author's machine, if that can be arranged, because a machine that has run this
before has a warm npm cache and a keychain entry already in it.

**A repository the subject did not write.** A small JavaScript or TypeScript project with a
passing test suite and a `test` script in `package.json`. Handing them this repository would be
handing them the tool's own documentation.

## The clock

Starts when the subject reads step 1. Stops when the subject says out loud what the tool decided
and why, in step 6, or at fifteen minutes, whichever comes first. A run that reaches fifteen
minutes is recorded as over ten and stopped there: what is being measured is whether ten minutes
is enough, and the rest of the number is not needed.

Record the wall time at the end of each step, not only at the end. A total of nine minutes with
seven of them in the install is a different finding from nine spread evenly.

## What the subject is told, and nothing more

Read this to them, or hand it over on paper. It is the whole of the briefing.

> This tool runs a coding agent that has to prove what it did. Install it, point it at this
> repository, have it make one small change with a test, and then tell me what it decided and how
> much of that you believe. Say what you are doing as you do it. I cannot answer questions.

The task itself, handed over as one line, chosen so the project's own suite can fail on it:

> Add a function that trims whitespace before it splits, with a test that covers an empty input.

## The six steps, and what each one is timed for

The subject is not given these. They are what the observer is watching for, in the order the tool
expects them. A subject who does them out of order, or who finds a different route to the same
place, has found something worth writing down.

**1. Install.** `npm install -g swarm-orchestrator`. Timed because a global install on a cold
cache is minutes of the ten and none of them are the tool's design.

**2. Initialise a policy.** `swarm init` in the repository, which writes `swarm.toml` from what
`package.json` already declares. Watch for whether the subject opens the file, and whether they
can tell what it will now run.

**3. One task.** `swarm "add a function that trims whitespace before it splits, with a test that
covers an empty input"`. Watch the screen with them. Note whether they can tell, while it runs,
whether it is working.

**4. Read the result.** The run prints its gates, its bonds and its nine answers. Watch for
whether the subject reads `unmeasured` as a failure, as a pass, or as what it is. That confusion,
if it happens, is the finding this gate exists to produce.

**5. Verify the signer.** `swarm verify <bundle> --signer <fingerprint file>`. Watch for whether
the subject can find the bundle without being told where it is, and whether they can say what a
signature check does and does not establish.

**6. Say what happened.** The subject says out loud what the tool decided and how much of it they
believe. The clock stops here. This is the step the gate is actually about: the other five are
mechanics, and a subject who completes all of them and cannot say what was established has not
understood the result.

## What the observer writes down

One line per step: the wall time it ended at, and what the subject did rather than what they were
supposed to do. Then four things at the end:

- **The total, and whether it is under ten minutes.** One number, and it is the gate.
- **Every question the subject asked out loud**, verbatim. A question is a sentence the
  documentation owes an answer to.
- **Every place they went looking for something and did not find it.** Which file they opened,
  which command they tried first.
- **What they said in step 6, verbatim.** Not a summary of it. A subject who says "it passed" has
  read something different from one who says "the tests passed and nothing checked whether the
  task was done", and the difference is the whole of what this gate measures.

A run is one data point. One run under ten minutes moves this row from `unproven` to a number with
`n=1` beside it, which is what it will say.

## After the run

The result goes in [`beta-gates.md`](beta-gates.md) as a row with the date, the total, and `n=1`.
Whatever the subject got stuck on is a defect against the documentation or the output, filed with
their words in it.

If the run goes over ten minutes, the row says so and names which step took the time. A gate that
fails on the install rather than on the tool is a different problem from one that fails in step 6,
and averaging them would hide both.

## Recording the study

The observer can create the common repository with `node scripts/create-first-run-fixture.mjs <new-directory>`.
Its TASK.txt fixes the task and its baseline test runs without dependencies. Creating the fixture
is preparation, not a participant observation. Record supplied credentials, runtime images,
network access, warm caches and the expected signer fingerprint among the prerequisites.
Obtain that fingerprint through a trusted channel independent of the bundle being checked.
The verify flag accepts a fingerprint, not a filename.

After building this checkout, use `node scripts/observe-first-run.mjs <protocol.json> <event.json>`
at each milestone. The schemas live in `src/eval/first-run-observation.ts`. Freeze the build digest,
phase, anonymized participant and observer IDs, consent, prerequisite list, sample size, passing
fraction and cap before starting. Record all installation, policy, task, patch, verification and
explanation milestones, plus every assistance or failure event. A verification milestone names
the task bundle digest; the explanation supplies the silent observer's three comprehension
scores. The recorder timestamps each event and refuses replacing an earlier observation.

Formative participants and validation participants are separate. Validation rejects participants
recorded as having used the tool, read this repository or seen a demonstration. These declarations
require the observer's confirmation. The recorder cannot establish that a person is new or that an
observer is independent. A synthetic fixture observation never counts as a human study result.
The ten-minute target, cohort pass fraction and any later hard stopping cap must be prespecified.
