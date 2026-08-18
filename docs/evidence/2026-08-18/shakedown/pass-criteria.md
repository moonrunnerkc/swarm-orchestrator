# Shakedown pass criteria

Written before any task was run, per the project's own evaluation-design-first rule. The
point of writing it first is that a criterion invented after the numbers are in is a
description of the numbers.

## What is being tested

Whether the agent, run against a real repository, produces work that the harness can hold
to its own standard. Not whether the model is clever: whether the evidence path holds up
over ten consecutive real tasks without being steered.

## The corpus

Ten tasks drawn from this repository's own small chores, spread across the four task
classes the router already classifies. Every one is work somebody would actually ask for,
not a puzzle constructed to be easy.

| # | Class | Task |
| --- | --- | --- |
| 1 | edit | Name the fuzz corpus directory in the error `fuzz/smoke.mjs` prints when a corpus is missing |
| 2 | edit | Give `PatternUnreadableError` a message naming the pattern it could not read |
| 3 | edit | Report the seed count per harness in `fuzz/smoke.mjs` as a total at the end |
| 4 | test-fix | Add a `scrubText` case for a credential name split by a digit |
| 5 | test-fix | Add a `findBacktrackingRisk` case for a quantifier inside a lookbehind |
| 6 | test-fix | Add a `parseLineHits` case for a section with `DA:` lines but no `LF:` |
| 7 | multi-file | Move the four-character floor constant in `scrub.ts` behind a named export and use it in the test |
| 8 | multi-file | Give `corpus-replay.test.ts` and `smoke.mjs` one shared list of harness names |
| 9 | tool-heavy | Find every `.fuzz.cjs` harness with no entry in `fuzz/README.md` and list them |
| 10 | tool-heavy | Report which `src/gates` files have no test file beside them |

## Dimensions recorded per task

Recorded whatever the outcome, from the run's own output and its bundle, never from the
model's narration:

- gate outcomes, per gate, including not-applicable
- attempts the auto-resolve loop took
- whether it escalated, and on what
- diff size: files changed and lines added
- invariant violations: any file-set breach, any placeholder introduced, any secret-scan
  hit, any ratchet rejection
- whether the exported bundle verifies under its own embedded verifier
- claims made, and how many the harness rendered verified

## What counts as failure

The shakedown fails if any of these happens even once:

1. A bundle does not verify under its own embedded verifier.
2. The harness renders a claim verified that is not true of the cited record.
3. A run reports green while a blocking gate failed.
4. A file outside the declared set is changed with no recorded amendment.
5. The ledger chain breaks, or a run continues after a failed ledger write.
6. A credential written into the workspace reaches the ledger unredacted.

## What is not failure

Named in advance so it cannot be reinterpreted later:

- **An escalation is a result.** The agent hitting the attempt cap and escalating with a
  bundle is the designed behaviour. A shakedown where nothing escalates has tested less.
- **A task the model does badly is not a harness failure.** A wrong or empty edit that the
  gates catch and report is the system working.
- **A ratchet rejection is a result**, and a wanted one: it is the numeric floor doing what
  it is for.
- **Not-applicable gates are not passes and are not failures.** The scratch clone is this
  repository, so typecheck and lint apply here and will run.

## How it is run

Against a scratch clone of this repository at the current commit, one clean clone per task,
so no task inherits another's tree. The frontier model, since the local one has already
been measured separately and the question here is the harness rather than the model.
