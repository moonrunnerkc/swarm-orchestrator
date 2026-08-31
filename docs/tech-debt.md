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

`search-tool.ts` 8.3% to 89.8%, `shell-tool.ts` 21.1% to 100%, `file-set-tool.ts` 57.1% to
85.7%, measured with the v8 provider over every source file rather than only the imported ones.

Behaviour rather than lines. What is asserted is what each file decides that something
downstream rests on: the facts a claim predicate addresses rather than the prose the model was
shown, the search patterns refused before they run once, the files the scan declines to open,
the exit code and the timeout kept apart as different findings, and the second file-set
declaration that answers the model rather than throwing at it.

One case is worth recording because of how it was wrong first. The binary-file test asserted
that a `.bin` file is skipped, and a literal NUL byte had landed in the test source where a
space was meant, so it passed for a reason its own text did not give. The tool reads a `.bin`
file happily and skips a file carrying a NUL, whatever it is called. It now writes the byte as
an escape and asserts both halves.

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

Built as the second view this entry said it would have to be, with its own layout and its own
tests: `calibrate-view.ts`, `calibrate-store.ts`, `calibrate-screen-model.ts` and
`calibrate-screen.ts` under `src/tui/`, tested over the pure builder at four widths and with
colour off. It shows the denominator a sweep has and a task does not, one row per model with
attempted, executed, green and the abstention reason codes, and the repeat in flight. No keys:
a sweep is watched rather than steered. Off a terminal it is silent and the piped output is
what it always was.

The entry below is what it was written as, kept because it is the reasoning the second view
was built from.

## Debt as it stood: `swarm calibrate` has no screen, and it is the run that most wants one

The interactive screen is wired to one command, `swarm <task>`, through `startInterface` in
`src/cli.ts`. `swarm calibrate` writes plain progress lines and nothing else, on a terminal or off
one. A three-model sweep is 180 runs over roughly three hours, which is the longest thing this
tool does and the workload a live screen would be worth the most on; the 08-23 calibration was
watched through `tail -f` on a log.

Not wired in this release, and not because it was overlooked. The screen renders one run: a task,
a workspace, a plan, an action stream, one set of gates. A sweep has none of those as a single
thing, so pointing the existing screen at it would mean deciding what the header names while
sixty runs are in flight, what the action stream shows, and what a gate strip means across three
models. That is a second view with its own layout and its own tests, not a call site. Worth doing,
worth its own change, and worth saying plainly that this release did not do it.

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

Nothing checks this. A `files` entry whose content names a version or a registry state is the
shape to watch, and the cheap version of the fix is a test asserting no shipped document states
a published version other than the one in `package.json`.

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

## Closed on 2026-08-31: the evidence column is indexed

Both fixes this entry named are in, and nothing about what is recorded moved, so it is additive
over every bundle already written. The column opens with an index: how many records, how many
groups, one line per turn with its task and its count, and one line per record kind with its
count and a link to the first. A record is now a `details` collapsed to its head line rather
than a fully expanded card, and the digest moved inside it.

The turn group is deliberately not the collapsing unit. A link from a claim into a collapsed
group is a link into nothing on any browser that does not open a closed ancestor for a
fragment, so the collapsing unit is the record, whose summary is rendered either way. There is
still no search box, and that is now a decision rather than a gap: it would need a script, and a
review page that needs one to show its evidence is a review page that can stop working.

The third thing this entry raised is unchanged and is still a question rather than a task:
`model-call` payloads are the majority of the bytes, and changing what is recorded touches the
evidence contract.

The entry below is what it was written as.

## Debt as it stood: the evidence column is still an unindexed ledger dump

The claims column is a product and the header, gates and diff above it are now readable. The
evidence column underneath is every non-claim record as a card, in chain order, with a
`sha256:` line under each. For this session that is 119 records; for the 2026-08-23 calibration
it is 3,716 cards in an 11.6 MB file with no search box.

Two things would fix most of it and neither is done: grouping by turn with the group collapsed
by default, and moving the per-record digest into the expanded payload, where the person who
wants it is already looking. A third is a question rather than a task: `model-call` payloads are
the majority of the bytes, because the recorder writes the system prompt and the whole growing
transcript on every step. Changing what is recorded touches the evidence contract, so it is
named here rather than trimmed as a side effect of a page layout.

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

## Closed on 2026-08-31: the weekly scan no longer files the same findings every Monday

Two fixes, because there were two halves. The token rule is scoped off the three places
credential-shaped strings are written on purpose, by splitting the scan into two runs by path
rather than by rule, so nothing is silenced anywhere else. And the repeat itself is closed: the
finding set carries a fingerprint, the issue body carries it, and a run whose set matches an
open issue files nothing. Measured against a local rule rather than the registry, which is not
reachable from where this was done; `docs/security-coverage.md` records what that does and does
not establish, including the one thing that could not be checked offline.

The entry below is what it was written as.

## Debt as it stood: the weekly scan files the same 21 semgrep findings every Monday

Nineteen of them are `detected-github-token` inside the secret scrubber's own test corpus and
the shakedown logs, which is a secret scanner correctly finding the credential-shaped strings a
scrubber is tested with. One is a non-literal `RegExp` in a fuzz harness's summary reader, and
one is a prototype-pollution rule firing on a read-only walk that exists to quote a bad value
back in a config error.

Scoping the token rule off `fuzz/corpus/scrub/`, `src/evidence/*.test.ts` and
`docs/evidence/**/logs/` is the right fix and is not a release-day change: an issue that arrives
every week saying the same known thing is one people learn to close unread, which is the failure
mode this project names about gates. Wants its own change, with the scoped run as its evidence.
Dispositioned in `docs/security-coverage.md`.

## NOT-DONE on 2026-08-31: the dead v12 scheduled workflows are still on `main`

Four scheduled workflows on the `main` branch fire against a codebase this repository no longer
builds, and have been since the default branch moved:

Under `.github/workflows/` on that branch, named here by filename because a rooted path to a
file on another branch is a pointer that does not resolve from this one:

| workflow | schedule |
| --- | --- |
| backward-mine.yml | `0 4 * * *`, nightly |
| complaint-mine.yml | `30 4 * * *`, nightly |
| agent-stream.yml | `0 5 * * *`, nightly |
| codex-canary.yml | `0 9 * * 1`, Mondays |

They are not on this branch and there is nothing here to delete: `v13-main` carries four
workflows, all of them v13, and the only scheduled one is `weekly-scan.yml`, which is live and
wanted. Deleting the four above means a commit on `main`, and the pass that found them was
authorized to push to one branch and not that one.

Left as a one-line job for whoever has that permission: remove those four files from `main`.
Nothing else on `main` is touched by doing so, and nothing on this branch depends on them.

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
