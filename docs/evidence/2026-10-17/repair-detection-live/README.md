# Live repair and detection, 2026-10-17 (night)

Registered in [protocol.md](protocol.md) before the first launch, with three amendments, each
before the launches it affects; every launch is in [launches.md](launches.md). These are
**development records on an exposed task** (mime), not comparative evidence.

## What was established

| question | answer |
| --- | --- |
| R: does a live repair fix the injected mime fault when a supplied check names it? | **Not shown** (launches 1, 2). Both runs passed the supplied counterexample, the visible check and the project tests, and the product reported `accepted`. Both final patches delete line terminators from the name instead of treating them as ordinary characters, which the three supplied cases cannot tell apart; the evaluator rejects them on 10 and 15 of its 113 cases. Accepted against supplied checks is not the same as correct, and these runs show it. |
| D: does a live planner find the omission? | **Yes, twice.** In launch 3 an example check (`file\n.png` → `image/png`) and in launch 5 a relation (a space against each line terminator at every position of two seeds) were admitted; the evaluator finds each right: it accepts the upstream fix and rejects the retained faulty patch. |
| D: does a live repair then fix it? | **No** (launches 3, 5). In launch 3 a repair broke the supplied visible check while chasing the generated check and the ratchet kept it (corrected since). In launch 5 the correct relation stood beside three admitted example checks whose programs built an empty `new Mime()` and reject every implementation; the repair made one edit in two attempts and delivered the injected candidate, reported `unresolved`. |
| O, C: ordinary run and paired comparison | **Not run.** Both were conditional on D. |

Launch 4 is invalid for an infrastructure reason: the model server could not parse a tool call
the planner wrote and cut the stream, and the product read the cut-off text as the planner
finishing (corrected since).

## Product corrections the traces justified

Each with a regression test that fails without it:

- the repair brief shows the current change as a diff against the base, not only its digest
  (launch 1: repairs took the injected design for the project's own code);
- a supplied command check's refusal carries its own output (found before launch 1);
- a relation's whitespace may be written as code points (launch 3: eleven calls arrived with
  their space and line terminators emptied by the server's tool-call parser);
- generated checks run as their own `task-diagnostics` gate, so a repair that breaks a supplied
  check to satisfy one is rolled back (launch 3);
- a turn the server cut off mid-answer is sampled again, never read as the model finishing
  (launch 4).

Not corrected: an admitted generated check whose program never reaches the project's real
behaviour (launch 5's empty `new Mime()`) passes its base control when its cases expect the
degenerate value. That is the next blocker for live repair.

## Development tests, labelled as such

The relation check was exercised before any live run on an assignment-parser fixture in
`src/workers/planned-check-program.test.ts`, on a slug fixture through the ordinary command line
on a scripted model (`src/cli-planned-checks.integration.test.ts`), and on the mime fixture by a
relation the developers wrote knowing the omission ([relation-development-test.json](relation-development-test.json),
[validate-relation.mjs](validate-relation.mjs)): engineered test coverage, not discovery.

## Allowance used

Five of eight launches, 44.9 of 120 agent minutes; the infrastructure reserve replaced launch 4.

## Records and reproduction

The five launches' streams and per-launch records are in one pack,
[packed-derived/launch-streams](packed-derived/launch-streams/inventory.json)
(`node scripts/evidence-pack.mjs restore <that directory>`). To stay within the tracked tree's
headroom, each stored stdout keeps only the run's result line, and the planning chains' ledger
copies (digests without their blobs; each launch's `generated-checks.json` holds those chains'
content, decoded) were dropped; [stdout-trimmed.json](stdout-trimmed.json) gives the digest and
size of everything dropped.

## Install routes, walked from GitHub and the registry

[remote-install.mjs](remote-install.mjs) walks them in a disposable root with its own HOME, npm
prefix and cache, and reaches no model. Its first walk ([remote-install-before-fixes.json](remote-install-before-fixes.json),
a shallow clone) found three first-run defects, since fixed: a shallow source build printed the
release's version line, a misspelt last flag was told it "needs a value", and a repository with
no manifest exited 1. The walk of the pushed head is [remote-install.json](remote-install.json).

```sh
node validate-counterexample.mjs --out <file>
node validate-relation.mjs --out <file>
node run.mjs --swarm-cli <dist/cli.js> --mode supplied|seeded|ordinary --out <empty dir>
node ../repair-trust-live/score.mjs --task mime --patch <final.patch> --out <file>
node ../planned-check-live/verify-checks.mjs --task mime --generated <generated-checks.json> --out <file>
```
