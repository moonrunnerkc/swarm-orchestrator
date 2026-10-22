# Development study launches

Frozen before the first development launch, October 22, 2026.

- Manifest: `~/.cache/swarm-study-2026-10-22/dev/manifest.json`, sha256 `120e4ae75ee78e71f2cb8845a71b080301f2b6ae50edd4766b0fdd6104f7af13`.
- Product: `git archive` of `309a2c0e6`; build tree, protocol and harness digests: `sha256:8692885035888203f63082a372abbeb0540b5632737844a5f915805d0e095265 sha256:fca1ac299541fa72788e11d27fd5f30aea14c40c752413195e4e3151ee437543 sha256:c1420d71ba26c8a5707bd00c09be31285a1a77cb17c798a298ffdcf8d01576d3`.
- Smoke on that build: `smoke-4`, all four arms pass every registered criterion (validation including
  the in-profile probe, inference, scoring, permission probe from each arm's own transcript, no
  canary exposure). Earlier smokes: `smoke` and `smoke-2` stopped before inference on the gate-plan
  check (two harness corrections, committed); `smoke-3` passed on build `16a5abc90`, which lacked the
  armed-point record and was superseded.
- Order: acorn swarm, acorn swarm-control, entities swarm-control, entities swarm, sinon swarm,
  sinon swarm-control, acorn sample 2 swarm-control, acorn sample 2 swarm.

Outcomes are filled in from the records after the last launch.

## Development run 1 stopped; tuning before run 2

Run 1 (manifest above, build `309a2c0e6`) stopped after three launches:

- acorn pair A, `swarm`: the decision point fired at step 16 of 40 with no edit and chose a
  diagnosis. The diagnosis spent all five of its steps reading regions the worker had already
  read and stopped at its step limit with no answer, so nothing was actionable and no notice was
  given; cost 5 steps, 26,058 tokens, 10 s. The worker then ended its 40 steps with no edit; the
  delivered tree is unchanged. Hidden and visible fail.
- acorn pair A, `swarm-control`: edited (593 bytes), hidden and visible fail. The pair is a tie at
  failed delivery.
- entities, `swarm-control`: zero-inference setup failure. The harness's gate-plan check ran the
  product under the launch's own home and left files there, so the arm's home was not fresh.

Two causes, both in this stage's own code, corrected before run 2:

1. Product, development tuning: the diagnosis now has its tool steps minus one for reading, then
   one turn with no tools in which it must answer, and its brief says so. Record fields named
   `tokens` were scrubbed as credentials; the remaining allowance is now recorded as `maxSteps`,
   `maxTokens`, `maxWallTimeMs`.
2. Harness: the gate-plan check runs under its own fresh home, prepared as the arm's is. A changed
   harness runs only under a recorded correction naming both digests.

Run 1's records are kept as they are. Its acorn pair counts as development evidence about build
`309a2c0e6`: the point was exercised and its diagnosis produced nothing usable. Run 2 repeats the
registered eight launches on the tuned build under a new manifest.

## Development run 2, frozen before its first launch

- Manifest `~/.cache/swarm-study-2026-10-22/dev-2/manifest.json`, sha256
  `dc872c3b5c70f92a04466d2f845ed73357f322d51e64ff507786be5a2f2e4de2`; build `git archive` of `4e0ece037`.
- Smoke `smoke-5` on that build: all four arms pass every registered criterion.
- Same registered eight launches, order, tasks, arms and resources as run 1.

## Development run 2 results (build `4e0ece037`)

| Task | `swarm` (`--adaptive`) | `swarm-control` | Pair |
| --- | --- | --- | --- |
| acorn, sample 1 | no edit; hidden and visible fail; 481 s | killed at the 540.5 s deadline with no edit; fail | tie, failed |
| entities | complete: hidden, visible and lint pass; 250 s, 1,037,345 tokens | complete; 398 s, 2,016,309 tokens | tie, complete |
| sinon v2 | 8,101-byte patch; hidden and visible fail; adds a lint failure | 11,063-byte patch; hidden and visible fail | tie, failed |
| acorn, sample 2 | killed at the deadline with no edit; fail | killed at the deadline with no edit; fail | tie, failed |

Decision points: armed in every `swarm` loop. Task loops: acorn 1 diagnosed at step 16 (no edit);
entities and sinon continued at step 16 at no cost (edits had landed). Repair loops: entities
attempt 1 diagnosed a failing lint check; sinon attempt 1 diagnosed; sinon attempt 2 and acorn 1
attempt 1 were withheld for too little remaining allowance. Every diagnosis now answered, and every
answer was refused by the parser for its shape: a list where one text was declared (acorn), a null
question and a long approach (entities, whose answer named `src/escape.ts:187` and `Number.NaN`, the
lint failure's line and fix), and one bad escape (sinon). No notice reached any worker, so no
implementation decision was changed by the mechanism. The entities cost difference is not
attributable to it. Acorn sample 2's `swarm` session was lost (see below), so its decision is unknown.

Harness defect found: an arm killed at the deadline prints no result line and its session was not
copied before the launch directory was removed; acorn sample 2 (both arms) and run 1's acorn
control lost their sessions this way. Their scored outcomes stand. Corrected: every session under
the launch's home is kept, after a stop as after a scored launch.

## Development run 3, registered before launch

Product tuning 2 (`b6b975f55`): the diagnosis answer is normalized field by field, malformed
entries dropped by name, and only path-and-line pairs recovered from text that does not parse;
every recovered claim is still checked by the harness before it counts. It changes only code that
runs under `--adaptive`, so run 3 launches the four `swarm` cells again on the new build with run 2's
configuration and resources, and pairs each with run 2's `swarm-control` launch of the same task and
sample. Order: acorn 1, entities, sinon v2, acorn 2.
