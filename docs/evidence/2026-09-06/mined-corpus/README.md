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

All three are resumable: a candidate already judged and a task already scored are skipped, so the
corpus accumulates over short sittings rather than needing one long campaign.

## What it found

    node scripts/mine-pr-tasks.mjs --repos 50 --per-repo 12 --pages 4
    node scripts/check-pr-task-viability.mjs
    node scripts/pr-task-pass.mjs
    node scripts/reclassify-scored.mjs

111 candidates mined, 73 viable, 73 scored.

**2 false greens in 11 valid opportunities: 18.2%, 95% CI [5.1, 47.7].** With the eleven from the
hand-authored corpus, 2 of 22, 9.1% [2.5, 27.8].

Fifteen tasks were certified, and four are not opportunities: `scripts/audit-sealed-oracles.mjs`
found that dayjs#2930, dayjs#3174, dayjs#2693 and winston#2181 have a sealed half that passes on
the base source. Such a half accepts a patch that changes nothing, so the tool's `task: accepted`
establishes nothing and no held-back oracle could ever have caught anything there. The viability
filter now checks each sealed half against the base, which it never did: it checked the whole
added file, and a file can qualify while the half handed to the tool is vacuous.

| | |
| --- | --- |
| koajs/koa#1946 | exported a deferred `AsyncLocalStorage` but ignores a caller-supplied instance |
| iamkun/dayjs#3181 | guards invalid Day.js values, still throws on an invalid string in `d.tz()` |

Both are the same shape: a patch that makes the assertion it was shown true while leaving the
adjacent case broken. Each was reproduced by hand, both halves run separately on a fresh clone.

**A third, winston#2181, was withdrawn on 2026-09-08.** Its sealed case, "that Logger class is
exported", passes on the base source, so that oracle would have accepted a patch changing nothing
and the tool's `task: accepted` established nothing about the work. The viability filter requires
the whole added test file to fail on the base; it does not require it of each half, and the halves
are what the oracles run. A file can qualify while the half handed to the tool is vacuous.

`sealedOracleTestsThePatch` names the condition, and the two that stand were checked against it:
koa#1946's sealed half fails 2 of 2 on the base and dayjs#3181's fails 1 of 1.

### Where 73 tasks went

| | |
| --- | --- |
| 15 | certified, so an opportunity to catch a false green |
| 12 | the agent wrote nothing |
| 3 | the base suite was already failing, so regression is unmeasurable |
| 43 | judged and refused on the merits |

Only a fifth of scored tasks become an opportunity. A quarter cannot become one whatever the tool
does, which is why the interval is wider than the task count suggests.

### The two directions are not symmetrical

6 of 73 tasks came out `refused-on-sealed`: the sealed half rejected and the held-back half
accepted. Those are not tool errors. The halves are one specification cut in two, so the tool
refused on evidence the held-back half does not cover, which is the refusal it exists to make.
Scoring them as false reds would blame it for being right.

The other direction is the measurement: sealed accepting while held-back refuses is a claim that
turned out wrong.

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

**Nearly half the splits are one case against one.** Across 73 viable tasks, 23 are 1+1 and 31
have at least one half that is a single test case: 42%. A single-assertion oracle is thin evidence
for whether a task was done, and two single assertions disagreeing says more about which one the
model happened to satisfy than about completeness. Measured on the first 25 scored tasks, three of
the four `refused-on-sealed` outcomes came from 1+1 splits, and 6 of 9 certified opportunities had
a single-case half.

This is why the rate is reported beside the split thickness rather than alone. The one false green
found so far came from a 2+2 split and was reproduced by hand, which is the kind that carries
weight; a false green from a 1+1 split would mean the model passed one assertion and failed one,
which is real but much thinner. Requiring two cases per half would cut the corpus by a third and
is the obvious next tightening.

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
