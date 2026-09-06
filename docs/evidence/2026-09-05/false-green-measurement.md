# The false-green rate, measured

**2026-09-05.** Eighteen real-repository patches, re-scored from the diffs they recorded, against
hidden acceptance tests written before any of them ran. No model was called: the patches already
existed, so this is arithmetic over evidence rather than a new campaign.

The headline is not the final number. It is that the measurement found defects in the tool doing
the measuring, and then a defect in the measurement itself: the number this document first
reported as a false-green rate of zero was the hidden test agreeing with itself. That claim is
withdrawn below and the reasoning is kept, because a retracted number with its cause named is
worth more than a quietly corrected one.

## What was measured

The runs are the ones in [`../2026-09-04/real-repos/`](../2026-09-04/real-repos): three public
TypeScript repositories at pinned commits, one task each, three runs by each of two arms. Each
recorded its produced diff, and each has a hidden acceptance test written before the first run
and never shown to either arm.

Four corners, from the tool's verdict against that test:

| | oracle accepted | oracle refused |
| --- | --- | --- |
| **tool said verified** | true green | **false green** |
| **tool refused** | false red | true red |

Only one of those is a defect in this tool rather than in the model. A false green is the tool
saying a change is acceptable when the change does not do what was asked, and the whole of this
project is the claim that it does not do that.

## What it found

### First pass: every patch refused, nothing failed

`swarm ci` refused all eighteen, with no check failed and no refusal given. Eleven of the
eighteen pass their hidden test.

The cause is that a fresh checkout has no `node_modules`. A real project's test runner lives
there, so the tests gate found no command and reported that it measured nothing, and a verdict
requiring a passing check read that as not verified.

Nothing measured and measured-and-found-wanting are different findings, and collapsing them is
the mistake this project exists to avoid, committed by the part of it built to avoid it. The two
are now reported apart, and `--install` installs from the lockfile with install scripts off. It
is not the default: installing runs whatever the registry serves, which the approval model
already lists as needing a person.

### Second pass: four false greens

With dependencies installed, the tool verified four patches the hidden test refuses.

| repository | arm | run |
| --- | --- | --- |
| ts-pattern | swarm | 1 |
| purify | swarm | 2 |
| ts-pattern | baseline | 2 |
| ts-pattern | baseline | 3 |

**22.2% false-green rate, 95% CI [6.3, 54.7].** The mission's bar is zero.

This was not a bug in a check. It is what the checks establish. A repository's own suite tests
the behaviour the project already had; a task adds behaviour it did not. The ts-pattern hidden
test asks whether `P.object.empty` matches `{}` and refuses `[]`, `new Map()` and `new Set()`.
Nothing in the existing suite had an opinion about that, because the pattern did not exist yet.
So a patch that adds the feature badly, or does not add it at all, still passes that suite.

Running the suite establishes that nothing broke. It does not establish that the task was done.

### The fix

The vocabulary was already there and unused. A verification now reports `regression` and `task`
separately: `regression: pass` for the suite still passing, `task: unjudged` where nothing said
the work was done. `verified` requires both, and without an oracle it is false with the reason
given rather than true by omission.

`--oracle <command>` supplies one. Nothing infers it.

### Third pass: eighteen of eighteen, and why that number is not what it looks like

With each repository's hidden test wired in as its oracle, using the invocations
`scripts/real-repos.mjs` already records rather than retyped ones:

| arm | runs | agree accept | gates missed | gates stricter | agree refuse |
| --- | --- | --- | --- | --- | --- |
| swarm | 9 | 5 | 0 | 0 | 4 |
| baseline | 9 | 6 | 0 | 0 | 3 |

The tool agrees with the hidden acceptance test on all eighteen. **This was first written up as a
false-green rate of 0.0%, 95% CI [0.0, 29.9] per arm. That was wrong and the claim is
withdrawn.**

The hidden test is on both sides of the comparison. It is handed to the tool as `--oracle`, so
`verified` cannot be true unless it passes; and it is then the ground truth `verified` is scored
against. `verified === oracle` on 18 of 18 with nothing off the diagonal, which is what a
tautology looks like. Verify it directly:

    node -e 'const r=require("./docs/evidence/2026-09-04/real-repos/rescored.json").runs;
      console.log(r.filter(x=>x.verified===x.oracle).length,"of",r.length)'

What those eighteen runs do establish: the hidden tests are deterministic across time and
machine, and regression never failed on a run whose hidden test passed. Both are worth knowing.
Neither is a false-green rate.

**The 22.2% in the second pass is the real measurement**, and it is the one that still stands. The
harness claimed verified on the strength of a repository's own suite, an independent oracle
refused four of eighteen, and the two propositions were genuinely different. The fix closed that
by making the tool stop asserting a task was done when nothing judged it, which removes the
failure mode by removing the claim. Removing a claim is a real fix; it is not a measurement that
the remaining claims are sound.

## What this does not establish

**The false-green rate after the fix is unmeasured.** Not zero, not low: unmeasured. Measuring it
needs an oracle the tool is judged against but not given, and once the tool is given one the
comparison collapses into the tautology above. The route out is an oracle that is independent of
the one wired in, which means a second hidden test per task, and the corpus has one.

**Without a task oracle the tool cannot emit a false green at all**, on the task dimension,
because it makes no task claim: the verdict reads `task: unjudged` with the reason beside it. This
is why the golden-set campaign cannot produce the number either. An earlier run of it reported
8.3%, and that figure was scoring the harness's gate claim against a task oracle: two different
propositions, and the gap between them measures whether the configured gates were adequate, never
whether the tool lied. `scripts/run-campaign.mjs` now reports that column as `gates-missed` and
says so in its own output.

**Eighteen runs is eighteen runs**, across three repositories and three tasks.

**Three repositories and three tasks.** Two of the seven true reds are the same task failing
three ways. A corpus this small cannot say the tool generalises.

**The oracles were written by the same people who wrote the tool.** They were written before the
runs and never shown to the arms, which is what makes them oracles rather than gates, and they
are still three tests chosen by an interested party.

**Nothing here was blind.** A human review study comparing what a reviewer concludes from the
diff alone against what they conclude from the bundle has not been run.

## Reproducing it

    npm run build
    node scripts/rescore-real-repos.mjs

Reads `docs/evidence/2026-09-04/real-repos/runs.jsonl`, applies each recorded patch to a fresh
checkout of its pinned commit, installs from the lockfile, runs the repository's checks and then
its hidden test, and writes `rescored.json` beside the runs. No model, no network beyond the
package registry the lockfile already names.
