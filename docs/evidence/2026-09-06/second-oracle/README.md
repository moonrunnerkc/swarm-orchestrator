# The second oracle, and why one was never enough

**2026-09-06.** A false-green rate needs two oracles. This directory holds the second one for each
of the three real-repository tasks, the protocol that uses it, and what it found.

## Why one oracle cannot produce the number

On 2026-09-05 this repository reported a false-green rate of 0.0%, 95% CI [0, 29.9], over the
eighteen recorded real-repository patches. That number was withdrawn the next day.

The measurement handed each repository's sealed hidden test to the tool as `--oracle`, so
`verified` could not be true unless that test passed, and then used the same test as the ground
truth `verified` was scored against. The two sides were one assertion. They agreed on 18 of 18
with nothing off the diagonal, which is what agreement by construction looks like:

    node -e 'const r=require("./docs/evidence/2026-09-04/real-repos/rescored.json").runs;
      console.log(r.filter(x=>x.verified===x.oracle).length,"of",r.length)'

What that established is that the hidden tests are deterministic and that regression never failed
where they passed. Neither is a false-green rate.

## The protocol

Each task now carries two oracles, both declared in `scripts/real-repos.mjs` so neither is a
retyped second account of itself:

- **The sealed oracle** (`hidden`, under `docs/evidence/2026-09-04/real-repos`) was written before
  any run and is handed to the tool as `--oracle`. The tool's task claim rests on it.
- **The held-back oracle** (`secondHidden`, here) is never given to the tool. It is what that
  claim is scored against.

Every patch is verified twice, and the second invocation is read only for its `task` verdict, so
nothing the tool concluded in the first can depend on the held-back test.

    node scripts/second-oracle-pass.mjs

A false green is now definable: the tool said `verified` on the strength of the sealed oracle, and
a differently written test of the same specification refuses the patch.

## How the held-back oracles were written

From `task.md` alone, which is the contract both arms were given, and **blind to all eighteen
produced patches**. Each one deliberately differs from its sealed counterpart in two ways:

- **Different values throughout.** A patch that satisfies the sealed oracle by special-casing the
  literal inputs it names fails a test of the same rule on other inputs. Where the sealed
  ts-pattern oracle asks about `{}` and `Object.create(null)`, the held-back one asks about an
  object with only inherited keys, one whose single own key is non-enumerable, and `{ b: undefined }`,
  which serializes to `{}` and is not empty.
- **The parts of the contract the sealed oracle never reaches.** The task text requires `P.object`
  to support `.optional()`, `.and()`, `.or()` and `.select()`; the sealed oracle tests none of
  them. It requires `List.partition` to hand its predicate the whole array as a third argument;
  the sealed oracle never passes one. Where the sealed oracle checks four `chunk` examples, the
  held-back one states the grouping property over every length to twenty-five at six sizes.

## The weaker property, named

The sealed oracles were committed before the first run. These were written afterwards. What
protects them is that the patches were already recorded and unchangeable, and that they were
written without reading any of them; what it does not protect against is an author who suspects
what the runs got wrong. That is a real difference from the sealed oracles and it is why this
directory says so rather than presenting the two as equivalent.

Both were also written by the same people who wrote the tool.

## The instrument check that runs before the rate

A held-back oracle that refuses every patch its sealed counterpart accepted is a miswritten test
far more often than it is six runs all cheating: it is the shape of a test that fails to compile,
imports the wrong path, or asserts against an API the task never specified. `heldBackOracleLooksBroken`
names that case and the pass reports it above the rate, because a backward-mined zero read as a
100% false-green rate would repeat exactly the overconfidence this pass exists to correct.

## What it found

    node scripts/second-oracle-pass.mjs

    === is the held-back oracle sound? ===
    ts-pattern  sealed accepted 0, held-back also accepted 0  (nothing to disagree with)
    purify      sealed accepted 5, held-back also accepted 5
    darkreader  sealed accepted 6, held-back also accepted 6

    === the four corners, against an oracle the tool was never given ===
    swarm     9 runs: 5 true green, 0 FALSE GREEN, 0 false red, 4 true red
    baseline  9 runs: 6 true green, 0 FALSE GREEN, 0 false red, 3 true red

The instrument reads first. The held-back oracle accepts every patch its sealed counterpart
accepted, eleven of eleven, so it is not a test that refuses everything. It also refuses seven
patches on its own account, six of them ts-pattern runs where `P.object` was never added at all,
so it is not a test that accepts everything either. It discriminates, which is what makes its
agreement worth reporting.

**A false green is only possible where the tool said `verified`, and that happened eleven times.
The held-back oracle refuses none of the eleven: 0 of 11, 95% CI [0.0, 25.9].** Over all eighteen
runs the rate is 0 of 18, [0.0, 17.6], and per arm 0 of 9, [0.0, 29.9].

This is the first false-green number on this corpus that is not arithmetic. Nothing in it is
forced: the two oracles could have disagreed on any of the eighteen, and on eleven of them the
tool had already committed to a claim that a disagreement would have falsified.

What it says is narrow and worth stating exactly: **on these eighteen patches, no change passed
the oracle it was gated by while failing a differently written test of the same specification.**
The sealed oracles were adequate for these tasks, and no run got past one by special-casing it.

## What it still does not establish

**Eleven opportunities.** The upper bound is 25.9%. Four hundred tasks would put it near 1%.

**Six of the eighteen could not contribute.** No ts-pattern run passed its sealed oracle, by
either arm, so the tool never claimed anything there for a held-back oracle to refute. A corpus
with a task neither arm can do spends a third of itself proving the task is hard.

**Three tasks, three repositories**, and two of the seven true reds are one task failing twice.

**Both oracles were written by the people who wrote the tool**, and the held-back ones were
written after the runs. Blind to the patches, which bounds the risk; not sealed before them,
which is a weaker property than the first oracles have, stated here rather than glossed.

**Agreement is not proof of adequacy.** The held-back oracle found nothing, which is consistent
with the patches being sound and also with the held-back oracle being too gentle. It tests
strictly more of each contract than the sealed one does, which is the argument that it is not,
and it is an argument rather than a measurement.
