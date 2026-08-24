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

### Debt: `src/tools/search-tool.ts` and `shell-tool.ts` are thinly covered

8.3% and 21.1%. Both are tool implementations behind the chokepoint, which is at 98.3%, so what
is untested is the tool bodies rather than the path that records and gates them. `search-tool`
carries the ReDoS guard, and `src/tools/regex-safety.ts` (the guard itself) is separately
tested at length, so the untested part is the search around it. Worth its own change, not this
one.

### Debt: `src/gates/file-set-tool.ts` at 57.1%

The tool the planner declares its file set through. Invariant 12 depends on the declaration
reaching the ledger before the edits, and that ordering is tested at the gate level; the tool
wrapper around it is not.

## Documentation pointers

`scripts/check-doc-paths.mjs` was written in this pass and now runs in CI beside the invariant
drift check. It resolves 230 path references across 27 documentation files: markdown links
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

Three outcomes rather than two. **Zero misses.** Three mentions named and **known**, all of
`redteam/leep/`, which three documents name in order to record that it was removed: a record of
a removal is not a dangling pointer, and the two cannot be told apart without reading the
sentence, so the exception is named in the script with its reason rather than the rule widened
until it stops showing up. Six mentions of three **generated** paths, `dist/`,
`redteam/loop/state-dryrun/` and `redteam/loop/state-wake/`, every one of them in `.gitignore`,
so they name build and driver output that exists once something makes it. Counted and printed
rather than passed over, because a silent third category is how a check stops meaning anything.

## Debt: the weekly scan files the same 21 semgrep findings every Monday

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
