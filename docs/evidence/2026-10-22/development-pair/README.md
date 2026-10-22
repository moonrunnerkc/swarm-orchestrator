# The repair trace on the retained alias candidate: development pair

Launches 0 and 1 of [../protocol.md](../protocol.md): the 2026-10-21 alias launch's faulty first
candidate (one-dash aliases throw) put in place by a scripted first loop, then every model call
live, under the same build (`06531fb5e`), contract, task words, 9-minute wall, 40-step loops and 3
attempts. The arms differ only in `--repair-trace`. Driver: [alias-repair-boundary.mjs](alias-repair-boundary.mjs);
records, briefs and stdout in the stage's pack (`payloads/development-pair`); sessions on the
evidence branch ([../README.md](../README.md#records)).

## What the trace of 2026-10-21 showed, and what was changed for both arms

The 2026-10-21 repair received the task, the diff and the failing tests gate in a fresh loop, but
the gate's output reached it cut at its first 16,000 characters (all of mocha's 1,231 passing
titles), and it opened with "Nothing ran over this change" above a tests gate that had failed. It
found its own failing case (`-j 4` throws, record 354), could not call the unexported function its
diff changed (record 408), and asserted the intermediate value instead (record 418: `-j` becomes
`--jobs=4`; observed on the same candidate, it becomes `-jobs`). It never ran the case over the
base, and edited nothing ([../../2026-10-21/fresh-comparison/correction-2026-10-22/README.md](../../2026-10-21/fresh-comparison/correction-2026-10-22/README.md)).

Both arms here carry the two input corrections of `3196a0818` (the end of a long gate stream is
kept; "nothing ran" only where no test command passed or failed). Both briefs below hold the
failure listing ("3 failing", the five "invalid option" lines) and no false preface. The trace arm
adds preservation-trace-v1: the brief says `tests` passed in the harness's run over the base
(gate-baseline record) and fails now, and asks for one preserved case to be reproduced on both trees
through `run_check`'s `compare_base`, narrowed to the first differing value, fixed there, and checked
against the preserved case and the task's own examples before a regression test is added.

## Results

| | control (launch 0) | trace (launch 1) |
| --- | --- | --- |
| trace notice given | no | yes, attempt 1 (`passingAtBase: tests`) |
| `compare_base` comparisons | not offered | **0** |
| reading of the base | `git stash` (records 121, 164; the second without a `pop`) | `git show <base>:lib/cli/parse-args.js` (record 96) |
| attempt 1 | 32 steps, cut at the model-work cutoff; edited `lib/cli/parse-args.js` and the spec | 21 steps, completed; edited the same two files |
| attempt 1's tree, final-verification readings | tests **passed** (runner-source-v1), visible check accepted, lint passed, **format failed** (new) | the same |
| ratchet | rejected (lint and format regressed in the workspace), rolled back | the same |
| attempt 2 | none (wall spent) | withheld (no model-work wall left) |
| delivered tree | the retained candidate, unchanged | the retained candidate, unchanged |
| delivered: frozen evaluation, expanded check | fail, 10 of 11 (as on 2026-10-21) | the same |
| exit, outcome, claim | 1, `not-accepted`, none | 1, `not-accepted`, none |
| wall, model time, verification time | 511.3 s, 108.1 s, 256.9 s (five passes; two `run_check`, 8.8 s each) | 415.6 s, 69.0 s, 226.7 s (three passes) |
| tokens | 837,049, a lower bound (1 call without usage) | 491,992 |

The workspace lint "regression" in both is mocha's order-dependent docs check again; the
independent verification read lint as passing. The format failure is real: both repairs left code
prettier would reformat, and neither ran the project's format check.

The two rolled-back trees cannot be rebuilt exactly: the ledger records each write's content after
the evidence scrubber, which redacts credential-shaped names (mocha's `let tokenStarted` is among
them), so a replay ([rebuild-rejected.mjs](rebuild-rejected.mjs)) does not reproduce the recorded
patch digests (`c292af22...`, `bf823a51...`), and the control attempt's unpaired `git stash` is
not replayable at all. By the protocol they are reported as not reconstructed and are not scored
beyond the harness's own readings above.

## What this pair shows

- **No artifact improvement from the trace.** Both arms delivered the identical faulty candidate.
  The intervention did not run as designed: the model never called `compare_base`, so the
  hypothesis (a traced, base-compared repair makes more useful progress than broad inspection) was
  not tested by this pair.
- Both repairs, unlike the 2026-10-21 one, reached a tree whose tests pass under the final
  verification. The difference from 2026-10-21 includes the corrected brief and a longer repair
  allowance (the scripted first loop took seconds), so this pair does not separate the two.
- What lost both repairs was formatting, then the wall: a correct-by-tests tree that fails the
  project's format check is rolled back, and no time remained to fix it. That is the next obstacle
  this pair names; nothing here was changed for it.

A single pair is development evidence. The trace stays experimental and off by default.


## Supplemental reconstruction audit, 2026-10-22

The earlier statement that neither rejected tree can be reconstructed was too broad.
The treatment session `20261022T082133-6e195b` contains complete shell diff outputs at
records 150 and 156. Applying those to recorded base `4d6498ff08c531642f09faea489c1b426c4d0efb`
and regenerating the binary, full-index patch independently reproduces
`sha256:bf823a5124440626b4d4ca6481bd0ef708b7dc018094c6f23772c91ceb49c1aa` (3,836 bytes).
The write-only replay still encounters redactions; the shell diff records avoid those bytes.
The control reconstruction remains unresolved.

Use a clean checkout of that recorded base, with the original session restored as above:

```sh
node rebuild-rejected.mjs --session <session> --checkout <base-checkout> \
  --diff-records 150,156 \
  --expect-digest sha256:bf823a5124440626b4d4ca6481bd0ef708b7dc018094c6f23772c91ceb49c1aa \
  --out <candidate.patch>
```

This corrects reconstruction availability, not the historical outcome: the product rolled the
candidate back and delivered its original faulty tree. Independently scoring or formatting this
reconstruction is an audit, not a live delivery win. Supplemental checks and the new experiment
are recorded in [the capability study](../../../capability-study-2026-10-22.md).
