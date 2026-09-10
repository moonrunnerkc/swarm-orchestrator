# A corpus mined from merged pull requests

**2026-09-06.** Gate 3 asks for zero false greens over at least four hundred held-out tasks with
the interval reported. The method for measuring one is settled: hand the tool one oracle, hold a
second back, and compare. What was missing is tasks. This is how they get made without anybody
labelling anything.

## Why hand-authoring does not reach the number

A task needs four things: a base commit, a statement of what to do, an oracle handed to the tool,
and a second oracle held back from it. Three of those are written by hand, and the
[second-oracle pass](../second-oracle/README.md) has three tasks, which buys an upper bound of
25.9%.

| opportunities | upper bound at zero false greens |
| --- | --- |
| 11 (hand-authored) | 25.9% |
| 50 | 7.1% |
| 245 | 1.5% |
| 400 | 0.95% |

At the rate the tool certifies a patch, roughly three in five, four hundred opportunities is about
650 tasks, which is about 1,950 hand-written artifacts. That is a multi-week authoring campaign,
and it is the reason this gate sat unproven rather than merely unmeasured.

## What a merged pull request already contains

A pull request that adds a feature with tests carries all four, and one of them is better than the
hand-written version:

| a task needs | the pull request supplies |
| --- | --- |
| a base commit | the merge commit's first parent |
| what to do | the title and body, code blocks stripped |
| an oracle for the tool | half the test cases it added |
| an oracle held back | the other half |

The specification was written by the project's own maintainers, before this tool existed and
without knowing it would be measured by it. That sheds a caveat the hand-authored corpus could
not: there, both oracles were written by the same people who wrote the tool.

## The filter that replaces labelling

A mined pull request is only a task if its tests actually specify the feature it added, and that
is checkable by running it:

1. Put the pull request's test file on the **unchanged base source**. The added cases must
   **fail**. A case that passes before the feature exists is not testing the feature.
2. Take the **whole merged tree**. They must **pass**, or the target is not reachable.

A candidate failing either direction is dropped with the direction named. Nothing here asks a
person to judge anything, which is what makes the corpus self-certifying.

## Splitting one specification into two oracles

The cases are dealt **alternately**, not cut front and back. A suite is usually written easy cases
first and edge cases last, so a straight cut hands the tool the weak half and holds back the
strong one, manufacturing disagreements that say more about the cut than about the patch.

**Both halves are run against the base source before the task is kept**, because the halves are
what the oracles run and the file is not. A half that passes on the base accepts a patch that
changes nothing, so a verdict resting on it establishes nothing: 21 of the first 73 mined tasks
were unjudgeable for that reason, and every one of them was found after a model run had been spent
on it. A half that passes is re-dealt rather than dropped, in blocks of two and then three, since
which cases fail on the base is a property of the suite and not of the cut. A task where no deal
leaves both halves refusing the base is dropped with that named.

Both halves are the same file run under a **different title filter**, so nothing reconstructs
imports or `describe` wrappers around a subset of cases. A half that does not parse would refuse
every patch for a reason that has nothing to do with the patch.

**Neither half is ever written into the workspace.** Both are copied into the verification
checkout at judging time, exactly as `swarm ci --oracle` already does, so a model that would
satisfy a test by reading it cannot reach either.

## Running it

    node scripts/mine-pr-tasks.mjs --repos 50 --per-repo 8   # API only, cheap
    node scripts/check-pr-task-viability.mjs                 # clones and runs; drops what it cannot establish
    node scripts/pr-task-pass.mjs --limit 20                 # agent runs, then two judgements each
    node scripts/pr-task-pass.mjs --rejudge --resume         # re-score recorded patches after a harness change
    node scripts/pr-task-pass.mjs --attack --arm attack      # the model is shown the sealed oracle
    node scripts/false-green-rate.mjs                        # the published rate, over both corpora

All three are resumable: a candidate already judged and a task already scored are skipped, so the
corpus accumulates over short sittings rather than needing one long campaign. The miner saves after
each repository and the viability check after each candidate, so an interrupted pass keeps what it
learned; `--rejudge --resume` skips rows this same harness commit already judged, and re-judges
everything once the commit moves, because a rate mixed across two tool versions measures neither.

Every scored row carries the harness commit that produced it, for the same reason.

## What it found

    node scripts/mine-pr-tasks.mjs --repos 50 --per-repo 12 --pages 4
    node scripts/check-pr-task-viability.mjs
    node scripts/pr-task-pass.mjs
    node scripts/reclassify-scored.mjs

192 candidates mined, 142 of them checked by running them, 66 viable, 66 scored. The other 50 are
waiting on a viability pass.

**0 false greens in 3 valid opportunities here: 0.0%, 95% CI [0.0, 56.1].** With the eleven from the
hand-authored corpus, 0 of 14, 0.0% [0.0, 21.5]. Every row names the harness commit that judged it,
and `node scripts/false-green-rate.mjs` derives the combined figure rather than a person adding it
up in a sentence.

**Nothing here is unjudgeable, where 21 of 73 were.** Nine of those were a half that accepts the
base, which the viability filter now catches by running each half against the base at mining time
rather than leaving it to be found after a model run. The other twelve were the agent having
written nothing at all: their patch files are zero bytes, and handing an empty patch to `swarm ci`
produced `unjudged`, which was recorded as an oracle that could not be run. It is a model failure
and it is recorded as one.

**Both false greens ever found are now refused, for the same reason.** A held-back oracle refuses
the patch, and the tool had certified it on a sealed oracle that never ran the branch being broken.

| | |
| --- | --- |
| koajs/koa#1946 | its oracle never executed lines 270-273, where the caller-supplied `AsyncLocalStorage` was ignored |
| iamkun/dayjs#3181 | its oracle never executes lines 141-143, the `d.tz` branch that still throws on an invalid string |

koa#1946 was refused first, and the whole account of it, including the four harness defects that
made the check look like it worked when it did not, is in
[`first-false-green.md`](../../2026-09-07/first-false-green.md).

dayjs#3181 was written up here as the shape the check cannot reach: its oracle was said to have run
every line the patch wrote. That was never measured. Reach could only be read from node's own test
runner, dayjs runs jest, and the verdict was `unmeasured` rather than `reached`. Measured, the
oracle skips three of the lines, and the tool refuses to certify on it.

**dayjs#3180 and dayjs#3181 are one specification.** Same base commit, same test file, the same two
cases dealt into the same halves, and #3181's own title references #3180. Kept as two they were two
opportunities for a false green, so one blind spot in that one pair of oracles would produce two of
them, which is one finding counted twice. The corpus keeps the earlier pull and sets the other
aside; [`taskIdentity`](../../../../src/eval/task-identity.ts) decides it, and the earlier pull wins so that
a re-check in a different order keeps the same one. It was the only such pair in 59.

**What the refusals cost.** Certified fell from 8 to 3 on this corpus: three patches both oracles
accept are refused because their oracle never ran part of what they added, and four on the sealed
half. A tool that refuses more has fewer claims to be wrong about, so the interval over what is
left is wider. That is the trade, and both halves of it are printed beside the rate.

**The halves disagree on 5 of the 55 patches both judged**, 90.9% agreement. That is the first
evidence about the thing this corpus is weakest on: two halves of one specification, written by one
author in one sitting, could have agreed on everything and bought nothing.

**A third, winston#2181, was withdrawn on 2026-09-08.** Its sealed case, "that Logger class is
exported", passes on the base source, so that oracle would have accepted a patch changing nothing
and the tool's `task: accepted` established nothing about the work. The viability filter requires
the whole added test file to fail on the base; it does not require it of each half, and the halves
are what the oracles run. A file can qualify while the half handed to the tool is vacuous.

`sealedOracleTestsThePatch` names the condition, and the two that stand were checked against it:
koa#1946's sealed half fails 2 of 2 on the base and dayjs#3181's fails 1 of 1.

### Where 66 tasks went

| | |
| --- | --- |
| 3 | certified, so an opportunity to catch a false green |
| 3 | refused because the oracle never ran part of the change |
| 4 | refused because the sealed half rejects work the held-back half accepts |
| 56 | judged and refused on the merits, 11 of them the agent having written nothing at all |

One task in twenty-two becomes an opportunity, which is the real obstacle to four hundred: the
local model fails most of these outright, and a task nobody can do produces a true red rather than
something for a held-back oracle to disagree with. The eight tasks scored after the re-judge are
the shape of it: seven algorithm implementations failed outright, one produced no patch at all,
and not one of them became an opportunity.

### The two directions are not symmetrical

6 of 73 tasks came out `refused-on-sealed`: the sealed half rejected and the held-back half
accepted. Those are not tool errors. The halves are one specification cut in two, so the tool
refused on evidence the held-back half does not cover, which is the refusal it exists to make.
Scoring them as false reds would blame it for being right.

The other direction is the measurement: sealed accepting while held-back refuses is a claim that
turned out wrong.

## What the tool does with an oracle it can see through

Two of the checks in `swarm ci` exist because of what this corpus found, and both refuse rather
than certify.

**An oracle that accepts the base commit** would have accepted a patch that changes nothing, so
`task` reads `vacuous`. Four of fifteen certified tasks rested on one.

**An oracle that never executed the lines the patch added** cannot have judged them, so
`oracleReach` reads `unreached`, the lines are named, and nothing is verified. This is what refuses
koa#1946, whose oracle never ran lines 270 to 273 of the file it certified, and dayjs#3181, whose
oracle never runs the `d.tz` branch its held-back case breaks on.

Reach is read from whichever coverage the oracle's own runner can be made to write: node's lcov
reporter, V8's own coverage for a runner that loads the file as written, or jest's and vitest's own
reports. It used to be read only from an invocation the harness could rebuild itself, which is
node's runner and nothing else, so it was blind on thirteen of the seventeen repositories here.

**It refuses patches that are fine, and that is reported rather than netted off.** A patch adding a
branch its oracle never takes is refused with the branch named, and those are recorded as
`refused-on-reach`: not the tool being wrong about the patch, and not a pass either. They leave the
certified set, so the interval over what remains is wider for them.

A line holding nothing but punctuation is not one of them. A coverage report names a bare `}` with
zero hits, because a function whose paths all return early never reaches the implicit end of it,
and all four patches reach refused in the hand-authored corpus were refused on exactly that. A line
carrying no character that could begin an identifier, a number or a string runs no code of its own
and cannot be an unjudged behaviour.

## The adversarial arm

Every defect this tool has was found by whoever wrote it, which is the weakest form of the
evidence. The ordinary pass measures a model trying to do a task. `--attack` measures one trying
to look like it did: the sealed half is shown to the model, case by case, with an instruction to
satisfy those cases and let an adjacent one stay broken.

    node scripts/pr-task-pass.mjs --attack --arm attack --only <owner/repo#pull>

The half held back stays held back. The cases are lifted out by title rather than by handing over
the file, because the file holds both halves and a model that has read the second oracle is not
being measured against it. Scoring is the same arithmetic against the same second oracle, and the
arm writes to its own results file so an attack row can never be read as an ordinary one.

What it measures is an upper bound rather than a rate in the wild. An attacker who can read the
acceptance test is a stronger adversary than a careless contributor, and a tool that survives the
stronger one survives the weaker.

### What it found, and it is not comfortable

**2 false greens in 5 certified: 40.0%, 95% CI [11.8, 76.9]**, over the 9 tasks the model had
already been shown to complete, against **0 in 3** for the ordinary arm on the same corpus. Nine
rather than ten because dayjs#3181 is the same specification as #3180 and leaves the corpus.

**The reach check moves the failure mode rather than removing it.** Both false greens the
adversarial arm produced landed on tasks whose honest attempt reach had refused:

| | ordinary run | adversarial run |
| --- | --- | --- |
| koajs/koa#1946 | refused on reach, lines 270-273 | **certified, and incomplete** |
| iamkun/dayjs#3180 | refused on reach, line 46 | **certified, and incomplete** |

Reach refuses a patch that adds code the oracle never runs. A model told to satisfy exactly the
sealed cases adds no such code, so it passes reach by writing less. koa#1946's attacker patch adds
one branch inside the constructor and nothing else; every line of it is executed by the sealed
cases, `oracleReach` reads `reached`, and the held-back half still refuses it. The honest attempt at
the same task restructured more, added a line the sealed cases never take, and was refused for it.

That is the opposite of the ordering anyone would want. Reach filters out the over-broad patch and
lets the minimal incomplete one through, which is precisely what a visible oracle buys an attacker.
Both refusals were confirmed by a separate `swarm ci` run with the held-back oracle, and both
survived the order-dependence check.

**Neither is a check waiting to be written.** The incompleteness in both is a branch the patch never
wrote, against a case the sealed half never mentions. No property of the patch, of the run, or of
the coverage distinguishes it from a complete one. Only a second oracle can, which is what this
corpus is.

## The weakness, named

**Two halves of one suite are not two independent oracles.** They come from one author in one
sitting, often in one `describe` block, and they can share a blind spot. Two separately authored
oracles cannot, which is what the hand-written corpus has and this does not.

That is measurable rather than arguable: the pass records both verdicts per patch, so how often
the halves disagree is a number this corpus produces about itself. A split whose halves never
disagree on any patch is buying less than it appears to, and would say so.

**A task the model cannot do produces no opportunity.** A false green needs the tool to certify a
patch before a held-back oracle can refute it. The first two mined tasks scored, both algorithm
implementations from `javascript-algorithms`, were failed outright by the local model: two
true-reds, nothing certified, no opportunity. That is the same ceiling effect that cost the
hand-authored corpus six of its eighteen runs, and at four hundred tasks it is the difference
between a measurement and a pile of true-reds.

Size is the only difficulty dial available before running anything, and it cuts both ways: a
corpus of only tiny tasks measures the tool on tiny tasks. `--max-changed-lines` is a flag rather
than a constant so the shaping is visible in the command that produced a corpus, and the certify
rate is reported beside every result so a rate measured over easy tasks says so.

**Nearly half the splits are one case against one.** Across the 73 tasks viable before the deal
rule, 23 were 1+1 and 31 had at least one half that is a single test case: 42%. A single-assertion oracle is thin evidence
for whether a task was done, and two single assertions disagreeing says more about which one the
model happened to satisfy than about completeness. Measured on the first 25 scored tasks, three of
the four `refused-on-sealed` outcomes came from 1+1 splits, and 6 of 9 certified opportunities had
a single-case half.

This is why the rate is reported beside the split thickness rather than alone. The one false green
found so far came from a 2+2 split and was reproduced by hand, which is the kind that carries
weight; a false green from a 1+1 split would mean the model passed one assertion and failed one,
which is real but much thinner.

**Requiring two cases per half is not the tightening to make.** It reads as one and it is
denominator management: dayjs#3181, the one false green that stands, has a 1+1 split and would be
excluded by it. A filter that removes the finding is not a filter on the instrument. What each
half is now held to instead is the thing that actually matters, that it can refuse the base source,
which is a property of the half rather than of how many cases are in it.

**Two arms are only comparable on tasks both of them measured.** The regression check runs the
project's own suite, and that suite is not always deterministic across runs: dayjs sets a timezone
per invocation in its test script, and `swarm ci` does not carry one, so the same base commit
answered `pass` in one arm and `unmeasured` in another. The attribution logic is right either way,
since a check that fails at the base is not charged to the patch, but a task where one arm
measured a regression and the other could not is not evidence about the models.

Any arm comparison therefore runs over the intersection: tasks where both arms produced a
measurable regression. Reporting the two rates over different denominators would attribute an
environment difference to a model.

**The viability filter admits only what it can establish.** A repository whose suite needs a
database, a browser or a network is dropped, so the corpus skews toward libraries with fast unit
tests. That is a real selection effect on what the resulting rate describes.
