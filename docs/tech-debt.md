# Tech debt

What this tree carries that it would rather not, found in a bounded pass on 2026-08-23 and
kept bounded on purpose. An item is on this list because fixing it is larger than one file, or
needs a decision nobody has made, or would be a refactor riding along uninvited in a release.

Three things were fixed rather than listed, because each was one file, covered by a test in the
same change, and named in the commit that made it: the missing-verifier misclassification in
`src/tui/verify-bundle.ts`, the two uncovered modules that got tests, and two exports nothing
imported.

## Dependencies

`npm audit` reports **0 vulnerabilities**.

`npm outdated` on 2026-08-23:

| Package | Current | Latest | Proposal |
| --- | --- | --- | --- |
| `@ai-sdk/anthropic` | 4.0.38 | 4.0.41 | patch, take it next release |
| `@ai-sdk/google` | 4.0.44 | 4.0.50 | patch, take it next release |
| `@ai-sdk/openai` | 4.0.41 | 4.0.46 | patch, take it next release |
| `@ai-sdk/openai-compatible` | 3.0.30 | 3.0.35 | patch, take it next release |
| `ai` | 7.0.65 | 7.0.77 | patch, take it next release |
| `@biomejs/biome` | 2.5.8 | 2.5.10 | patch, take it next release |
| `vitest` | 4.1.10 | 4.1.11 | patch, take it next release |
| `@types/node` | 24.13.3 | 26.2.0 | **do not take.** The types should track the Node the project supports, and the floor is 24. Moving to 26 would type against APIs the supported runtime does not have |

All seven patch bumps are inside the ranges `package.json` already declares, so `npm install`
takes them; none was taken during the release itself, because a dependency moving under a
measurement is a change to the thing being measured. Nothing here is a major, and no major is
proposed.

`typescript` is on `^7.0.2` and `vitest` on `^4.1.10`, both current major lines, neither
flagged by `npm outdated` as behind a major.

### One dependency added in this run

`@vitest/coverage-v8`, pinned exactly at 4.1.10, dev only. Justification: it is the first-party
coverage provider for the test runner already in the tree, and nothing outside the runner can
read coverage of modules the runner transforms in memory, which is why the raw
`NODE_V8_COVERAGE` route reported zero for every source file. Pinned rather than ranged so it
cannot drift away from the vitest it instruments.

## Coverage of what the release depends on

Measured over every source file, not only the ones a test imports. Reported, not chased.

| Module | Lines | Lowest file in it |
| --- | --- | --- |
| `src/tools/chokepoint.ts` | 98.3% | itself |
| `src/core` | 98.8% | `model-client.ts` 87.5% |
| `src/providers` | 97.8% | `endpoint-resolution.ts` 90.9% |
| `src/select` | 97.3% | `pricing-source.ts` 88.9% |
| `src/workers` | 97.2% | `parallel-run.ts` 88.9% |
| `src/config` | 96.8% | `swarm-toml.ts` 95.7% |
| `src/evidence` | 94.4% | `blob-store.ts` 78.9% |
| `src/gates` | 94.2% | `file-set-tool.ts` 57.1% |
| `src/tools` | 78.0% | `search-tool.ts` 8.3% |
| `src/tui` | 75.7% | `screen.ts` 2.0% |
| **whole tree** | **85.2%** | 4146 of 4865 lines |

Two of those numbers are shapes rather than gaps:

- **`src/tui/screen.ts` at 2%** is the React component, and it is deliberately thin enough to
  hold no logic worth testing: it subscribes, calls `buildScreen`, and maps each row to one
  `Text`. Everything it would be tested for lives in the pure functions beside it, which are
  tested at four widths, every height from one row up, and with colour off. Testing it would
  mean adding a renderer dependency to assert on pixels.
- **`src/tools` at 78%** is dominated by `search-tool.ts` at 8.3% and `shell-tool.ts` at 21.1%.

### Closed on 2026-08-31: the three thinly covered tool files

`search-tool.ts` 8.2 to 89.8, `shell-tool.ts` 78.9 to 100, `file-set-tool.ts` 57.1 to 85.7.
`shell-tool.ts` had already moved off the 21.1% recorded above before this pass; the other two
had not.

What the tests exercise is the tool bodies, since the chokepoint in front of them was already
at 98.3%. For `search-tool` that is the walk: which directories it descends into, the NUL-byte
rule that tells a binary file from a text one, the sandbox being asked about every descendant so
a denied file is never opened, where it stops on the result limit, the 8000-character line cap,
and the three ways a pattern can be refused. For `shell-tool` it is what a run reports and
carries as a fact: the exit code the command chose, each stream kept separately, and a killed
run named as killed rather than left to read as an ordinary failure. For `file-set-tool` it is
the wrapper rather than the ordering: what a caller is told, what reaches the chain, and the
second declaration, which is the case a planner actually hits.

One of those tests was wrong on the way in and is worth recording. The binary-file fixture
carried a literal NUL byte pasted invisibly into the source, so the test passed for a reason its
own text did not show, and `grep` had been treating the whole file as binary. It writes the NUL
from its code point now, with a companion case asserting that a text file is read whatever its
extension, since the rule is the byte and not the name.

## Documentation pointers

`scripts/check-doc-paths.mjs` was written in this pass and now runs in CI beside the invariant
drift check. It resolves 316 path references across 30 documentation files: markdown links
against the file that holds them, and rooted backtick mentions against the repository root.

It resolves against **what git tracks**, not against the filesystem, and that distinction cost
three red CI runs to learn, in two rounds of the same mistake. The first spelling checked the
disk, passed here, and failed on a clean checkout on three paths that exist on this machine and
in no commit. A pointer that resolves only for the person who wrote it is the same broken
pointer to everyone else, which is what the check is for, so checking the disk was a false pass
on precisely the case it was written for.

The second spelling asked git which of the leftovers it ignores, and asked about `dist` rather
than `dist/`. A directory-only ignore pattern matches the spelling with the slash on any
checkout and matches the one without it only where the directory happens to exist, so the
answer still depended on whether the tree had been built. Same filesystem dependence, one level
down, in the code written to remove it. It is verified now against a fresh clone with nothing
built in it, which is what CI is.

A third correction, smaller and in the other direction. A backtick mention is only read as a
pointer where it starts with a directory this repository has, and that list was written from the
repository root: `src/`, `docs/`, `fuzz/`, `scripts/`, `redteam/`, `.github/`, `dist/`. The
documents under `docs/` point at their own evidence shelf as `evidence/...`, rooted at the file
rather than at the root, so thirty-one pointers were read as prose and never resolved. The check
already tries both spellings for every mention, so accepting the prefix costs nothing. None of
the thirty-one turned out to be a miss, which is the good outcome and not the point: they were
unread, and a check that skips a shelf reports a clean number about a smaller tree than the one
it names.

Three outcomes rather than two. **Zero misses.** Three mentions named and **known**, all of
`redteam/leep/`, which three documents name in order to record that it was removed: a record of
a removal is not a dangling pointer, and the two cannot be told apart without reading the
sentence, so the exception is named in the script with its reason rather than the rule widened
until it stops showing up. Twelve mentions of three **generated** paths, `dist/`,
`redteam/loop/state-dryrun/` and `redteam/loop/state-wake/`, every one of them in `.gitignore`,
so they name build and driver output that exists once something makes it. Counted and printed
rather than passed over, because a silent third category is how a check stops meaning anything.

## Closed on 2026-08-31: `swarm calibrate` has a screen

The interactive screen is wired to one command, `swarm <task>`, through `startInterface` in
`src/cli.ts`. `swarm calibrate` writes plain progress lines and nothing else, on a terminal or off
one. A three-model sweep is 180 runs over roughly three hours, which is the longest thing this
tool does and the workload a live screen would be worth the most on; the 08-23 calibration was
watched through `tail -f` on a log.

It is a second view with its own layout and its own tests, which is what the paragraph above
said it would have to be, and that is what was built. `src/tui/calibrate-view.ts` projects the
sweep, `src/tui/calibrate-screen-model.ts` turns that into rows, and the Ink component maps a
row to one `Text` and stops, exactly as the run screen does. Forty tests, including the row
shape at five widths and five heights and with colour off.

What it shows is what a sweep has and a run does not: a denominator. Runs finished out of runs
planned, the run in flight, a row per model in plan order, and the last few outcomes. Green is
counted over executed runs rather than attempted ones, which is the denominator the report uses
and for the same reason. Abstentions are named beside the count, by the reason code the harness
recorded, because an unmeasured run that shows as nothing is the thing worth stopping a sweep
over.

Two things it deliberately does not do. There is no estimate of time remaining: that would be
arithmetic over run times that vary by model and by case, and a number presented as a prediction
is one people plan around. And there is no key handling, because a sweep has nothing to scroll
or expand, and an interaction that exists on no other screen would be a new pattern rather than
the existing one applied somewhere else.

Off a terminal it writes one line per finished run, in the same words the screen uses, so the
`tail -f` the 08-23 calibration was watched through still reads as one account of the run.

## Closed on 2026-08-24: the Pages site serves v13

`https://moonrunnerkc.github.io/swarm-orchestrator/` answered 200 with a page titled "Swarm
Audit, Real-Corpus Leaderboard": the v12 cheat-detector registry, scored against a corpus this
repository no longer builds. The workflow that produced it is on `main` and stopped firing when
the default branch moved, so nothing updated it and the last deployment stayed up.

Of the three ways out that were written here, retire it, redirect it, or build a v13 page, the
third was taken. `.github/workflows/pages.yml` on this branch deploys a page generated by
`scripts/build-site.mjs` from `docs/claims.md`, so a claim reaches the page by being a row of
that table and by no other route. The generator imports nothing outside `node:`, which keeps a
dependency tree out of the one artifact of this project a stranger reads first.

The old leaderboard address is answered rather than left to 404. The generator writes a second
page at the `/docs/leaderboard/` address the previous site served, saying what used to be there
and that version 13 does not do that work, with a link to the new page. A redirect would have
implied the two are about the same product.

Deployed and checked from outside on 2026-08-24: the root answers 200 with the v13 page, 18
claims and 5 struck-through phrases, no occurrence of the word leaderboard, and the retired
address answers 200 rather than 404. The first attempt failed on the environment rather than on
anything in the workflow, and `v13-main` had to be added to the allowed-branch list by hand.

That deployment also took down what the old one had been serving, which was the whole of the v12
`docs/` tree. Among it, at `/docs/eu-ai-act-mapping.md`, a public page naming a regulatory
instrument `claims.md` forbids by name in any public text. It now answers 404. Nobody had listed
that as a reason to replace the site, and it was the better one.

Two things this did not close. The `github-pages` environment restricts which branches may
deploy, and that list is repository configuration rather than anything in this tree, so it is
not covered by any check here. And nothing verifies the deployed page against the branch: the
tests assert what the generator renders, not what the site is serving.

## Debt: three documents ship inside the package and can go stale between releases

The `files` allowlist puts `build-guide.md`, `security-coverage.md` and `claims.md` in the
tarball. That is deliberate, since a package about evidence should carry what it claims and what
it admits, but it means a sentence corrected on the branch is still wrong in whatever is on the
registry until the next publish.

Live instance, found by publishing: the package identity section of `build-guide.md` said
"swarm-orchestrator on the registry stops at 12.0.0" as a present fact, and 13.1.3 shipped with
it. Corrected on the branch and left to ride along with the next release rather than spending a
version on one sentence, which is the judgement worth writing down: the README got its own patch
because it told readers the wrong install command, and a design-history note does not.

Second instance, found the same way on 2026-08-31: the correction itself had gone stale. It read
"the registry now serves 13.1.3 as latest" while `npm view swarm-orchestrator version` answered
13.1.9. The sentence no longer names a version at all, which is the only spelling of it that
cannot rot, and it says why.

Nothing checks this. A `files` entry whose content names a version or a registry state is the
shape to watch, and the cheap version of the fix is a test asserting no shipped document states
a published version other than the one in `package.json`. Still not built, and now with two
instances behind it rather than one.

## Debt: a session's ratchet is per turn, so a later turn can erase an earlier one's work

The ratchet holds within a turn: tests collected, assertions, coverage and skips may not move
the wrong way across the auto-resolve attempts of that turn, and the final state is compared to
the base commit once more at the end.

Nothing compares one turn to the turn before it. Seen while building the session: a turn was
asked to add a divide function, rewrote `package.json` on its way there, and dropped the `test`
script. The previous turn's `tests` gate had passed with three tests. This turn's reported
not-applicable, honestly, because there was no test script any more. Both statements were true
and nobody objected, because a gate that passed in turn 1 and reports not-applicable in turn 2
is two separate cycles and the ratchet only ever sees one.

That is a real hole and it is the shape of hole this project exists to close: a session that
lets each turn quietly retire the last turn's verification is a session whose green means less
the longer it runs. The fix is a floor carried across turns, so a gate that has passed in this
session cannot later report not-applicable or failed without saying so. Not built, because
deciding whether that floor blocks a turn or only reports it is a design call rather than a
patch, and making it up while shipping something else is how a ratchet gets loosened.

## Debt: one local pairing emits its tool calls as text, and the run reads that as a completion

`rapid-mlx` serving `qwen3-coder:30b-a3b` answers a short tool-calling prompt correctly, and
under this agent's system prompt with its nine tool schemas it repeatedly answered with
pseudo-XML in the message body instead:

    plan: <function>declare_file_set>
    <parameter=files>
    ["calculator.js", "calculator.test.js"]</function>

The SDK parses no tool calls out of that, so the loop sees text with no calls, which is its
definition of a completion claim, and stops with `completed` at step 1 having done nothing. The
same three tasks against Ollama's `qwen3-coder-next` went green three times in a row, so this is
a fact about that pairing rather than about the harness.

What the harness now does about it is say that nothing changed, before the gate table rather
than after it, because gates passing over an empty diff is the misleading part. What it does not
do is recognise the pattern and tell the person their model is answering in text. That is worth
doing and is not done: a run that ends `completed` at one step with no tool calls at all has a
signature, and naming it would save the next person the half hour it cost to find.

## Debt: the interactive session holds its notes until the screen comes down

`note()` buffers on the interactive path, because a raw write into a terminal Ink is drawing on
lands in the middle of a frame. That was right for a single run, where the screen comes down
seconds later. In a session it means the gate summary, the routing reward and the signing notice
for turn 1 appear after turn 3, all at once.

Half of it is closed: each finished turn now leaves its task and what the gates decided on the
screen, so the outcome is visible where it happened. The rest, the detail lines, still arrive at
the end. Doing it properly means the transcript carrying them rather than the buffer, which is
more of the same work rather than a different kind.

## Closed on 2026-08-31: the evidence column has an index

The claims column is a product and the header, gates and diff above it are now readable. The
evidence column underneath is every non-claim record as a card, in chain order, with a
`sha256:` line under each. For this session that is 119 records; for the 2026-08-23 calibration
it is 3,716 cards in an 11.6 MB file with no search box.

Both of the two things named here are done, and a third was added. Records are grouped by turn
and every group is folded by default, with anything that predates the first turn in a group of
its own rather than filed under a heading it came before. The per-record digest has moved into
the expanded payload, where the reviewer resolving a claim through it is already looking. And
the column now opens with an index: how many records there are, how many of each type, a button
per type, and a search box over type, actor, digest and summary.

It is a rendering change and nothing else. No record changed, nothing was added to the ledger,
and the four bundles in `docs/evidence/` plus a session bundle from `~/.swarm` were verified
after it with their own shipped verifier: every check passed on all four. Re-rendering the
08-23 calibration bundle through the new column produced 3,716 records under one folded group
with ten type buttons.

One cost, stated rather than buried: the page grew from 11.59 MB to 12.19 MB on that bundle,
because each record now carries what the filter matches on as an attribute. That is deliberate.
What the filter matches on is decided where the record is rendered rather than reconstructed in
the browser, since a script that decided what a record said would be a second account of the
ledger.

The third item is still a question rather than a task, and is unchanged: `model-call` payloads
are the majority of the bytes, because the recorder writes the system prompt and the whole
growing transcript on every step. Changing what is recorded touches the evidence contract, so it
is named here rather than trimmed as a side effect of a page layout.

## Closed on 2026-08-25: a parallel run swept up the branches it created

A run created `swarm/<runId>/<workerId>` per worker plus an integration branch, removed the
worktrees in a `finally`, and left every branch behind for ever, because the merge queue needs
them after their worktree is gone and nothing outlived the queue. A repository gained
`tasks x redundancy + 1` branches per run; three verification runs left seven.

`sweepRunBranches` runs once the queue is finished and the report says what it removed. The
integration branch is never swept, since that is the result and the report tells the person to
merge it. A branch git still considers checked out is left rather than forced, because that
means a worktree this process could not remove and deleting under it would leave the two
disagreeing. It prunes first, which is the part that matters for a run killed part-way: those
leave registrations pointing at directories that are already gone, and the next run fails
adding a worktree at a path git still believes in. Verified on a live run: three worker
branches removed, the integration branch and `main` untouched, no worktrees left registered.

## Closed on 2026-08-25: the planner says how it stopped, not just that it declared nothing

`--goal` reported "the planner did not declare a task graph" and named the session to read.
That is most of what is useful and it is missing the one fact that decides what to do next: a
loop that ran out of steps, a model that answered in prose, and a model that returned nothing
at all want three different responses, and the message treated them as one.

`runPlanner` returns the stop reason and the step count with the graph, and the message names
both and says what to try for each. Seen on a live run with a deliberately tight budget: `It
stopped with "max-steps" after 2 step(s) ... It ran out of steps before it declared anything:
raise --max-steps.` The observation that produced this stands: a broad two-part goal made the
model return an empty response where a one-part goal declared a graph in three reads, so
breadth rather than the pairing, and `empty-response` now says so in those words.

## Closed on 2026-08-31: the weekly scan no longer files the same 21 findings every Monday

Nineteen of them are `detected-github-token` inside the secret scrubber's own test corpus and
the shakedown logs, which is a secret scanner correctly finding the credential-shaped strings a
scrubber is tested with. One is a non-literal `RegExp` in a fuzz harness's summary reader, and
one is a prototype-pollution rule firing on a read-only walk that exists to quote a bad value
back in a config error.

Done, with the scoped run as its evidence, and with the tally corrected: measured before the
change it was 16 token findings, 3 non-literal regexp and 2 prototype-pollution, not 19 and 1
and 1. Data is excluded by path in `.semgrepignore`, which names the fuzz corpus and the
shakedown logs and nothing else of this tree; the 9 findings in real source carry a `nosemgrep`
naming the one rule and the reason at the line that carries them, so a different rule firing
there is still a finding. Under the workflow's own command the scan now reports zero and exits
0, and the scanned file count moved only by the excluded data, 6782 to 6755. Dispositioned in
`docs/security-coverage.md`.

## Exports nothing else names

A name-grep across `src/**`, so it is a heuristic and not a type-aware analysis: a type used
structurally rather than by name reads as unused here and is not. Two were genuinely dead and
are gone (`colorModes` in `theme.ts`, and `selectedIndex` in `screen-model.ts`, which is used
inside its own file and did not need exporting). The rest, 28 of them, are almost all parameter
and return types that are part of a module's shape and are used without being named.

**Not worth acting on without a type-aware tool.** Removing an export that a caller uses
structurally changes nothing at runtime and loses the name a reader looks for.

## Test files whose name does not match a source file

Six, and none is an orphan: `redteam-adversarial`, `verifier-parity`, `acceptance` (twice),
`corpus-replay` and `confirmation-path` are named for what they exercise rather than for a
single module, which is what an acceptance test is. Recorded here so the next sweep does not
re-find them as a defect.

## Invariant 8

Checked by grep across `src/core`: zero `Date.now`, zero `Math.random`, zero direct environment
reads. The only textual match is the comment in `random-source.ts` that says so. The interface
work added nothing: `src/tui` has no ambient clock, no random source, and no timer of its own,
and the elapsed counter drives off the injected `Clock` from the composition root.

## Open, unchanged, and not debt

The four accepted residuals in `docs/build-guide.md` 7.1 are open by design and are not on this
list. They are not defects awaiting a fix; each is a permanent case in the adversarial suite
asserting the gap as it stands, and widening a check until one goes green is a regression.
