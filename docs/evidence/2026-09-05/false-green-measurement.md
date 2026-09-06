# The false-green rate, measured

**2026-09-05.** Eighteen real-repository patches, re-scored from the diffs they recorded, against
hidden acceptance tests written before any of them ran. No model was called: the patches already
existed, so this is arithmetic over evidence rather than a new campaign.

The headline is not the final number. It is that the measurement found two defects in the tool
doing the measuring, and neither would have been visible without it.

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

### Third pass: eighteen of eighteen

With each repository's hidden test wired in as its oracle, using the invocations
`scripts/real-repos.mjs` already records rather than retyped ones:

| arm | runs | true green | false green | false red | true red |
| --- | --- | --- | --- | --- | --- |
| swarm | 9 | 5 | **0** | 0 | 4 |
| baseline | 9 | 6 | **0** | 0 | 3 |

**False-green rate 0.0%, 95% CI [0.0, 29.9] per arm.** False reds: 11 under the old standalone
scoring, 0 now.

The tool agrees with the hidden acceptance test on every one of the eighteen.

## What this does not establish

**Eighteen runs is eighteen runs.** The interval on a zero rate at n=9 per arm reaches 29.9%, so
what has been shown is that no false green occurred here, not that the rate is low. The mission's
bar of 400 tasks would put the upper bound near 1%. The machinery to get there now exists and
costs nothing per run, because it reads recorded patches.

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
