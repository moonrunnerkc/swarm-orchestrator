# Development validation of the pilot repairs, 2026-10-15

Amended 2026-10-15: the attribution of the bug-fix failure below ("a capability limit of this
model on this task") is narrowed in
[amendment-2026-10-15-attribution.md](amendment-2026-10-15-attribution.md), which names product
defects in the retained loops that this report did not account for. The figures and records here
are unchanged.

Five launches of the repaired instrument and product on three known tasks, under
[protocol.md](protocol.md); the sixth was withheld as predeclared. These are development
checks, not fresh comparative evidence and not a repetition of the pilot. The larger-study
decision is unchanged: DO NOT PROCEED.

## Outcome in one table

| cell | correct patch | delivered | eligible | agent time | tokens | what happened |
| --- | --- | --- | --- | --- | --- | --- |
| chai-upgrade-c8-v12-dev, swarm | yes | **yes** | yes | 2.6 min | 80,588 | sealed tests gate `npm run test-node` (the task's), fresh home, product's check passed on the base before dispatch; acceptable verdict, exit 0, amended oracle passed. Under the pilot's setup this same task spent 18 minutes on a browser suite and exited 1 |
| chai-upgrade-c8-v12-dev, opencode | yes | yes | yes | 1.2 min | 108,946 | fresh home; exit 0 with a completion claim the oracle confirms |
| chai-feature-deep-contain-oneof-dev, opencode | no | no | yes | 20.0 min | 587,646 | no edit; killed at the wall |
| chai-feature-deep-contain-oneof-dev, swarm | yes | **no** | yes | 4.2 min | 104,895 | the run's own sealed gates (build, lint, format, `npm run test-node`) all passed and the visible check passed; the final independent verification in a fresh checkout ran `npm test` instead, whose browser suite cannot run there, read the candidate's and the base's failures as different, reported the regression dimension unmeasured, and the run exited 1. A new product defect, repaired after this launch (below); the patch is correct and passed the amended oracle |
| csstree-bugfix-raw-value-whitespace-dev, swarm | no | no | yes | 19.0 min | 843,830 | read, reproduced, never edited the generator; three internal attempts and two scripted corrections, stopped for repeated calls three times and by the token cap; the final tree holds a probe script and no fix |
| csstree-bugfix-raw-value-whitespace-dev2, swarm | not run | | | | | withheld: the first bug-fix launch did not correctly deliver |

Agent minutes spent: 47.0 of the 120 allowed. No halt, no manual involvement, no code or settings
changed between launches. The verifier defect was found after the fourth launch and repaired
after the fifth; the fifth ran on the same build as the first four.

Evidence: [manifest-dev.json](manifest-dev.json), [manifest-dev-bugfix.json](manifest-dev-bugfix.json),
[manifest-dev-bugfix2.json](manifest-dev-bugfix2.json) (frozen, unrun); records, patches, output
excerpts, every cited blob and each Swarm session's ledger, bundle manifest and gate-run
payloads under [dev/](dev/) and [dev-bugfix/](dev-bugfix/); the derived tables
[results-dev.md](results-dev.md) and [results-dev-bugfix.md](results-dev-bugfix.md) with
[analysis-dev.json](analysis-dev.json) and [analysis-dev-bugfix.json](analysis-dev-bugfix.json),
each derived from its published directory alone. The "eight launches" gate item the analyzer
prints is the pilot's rule applied literally to a stage that froze fewer cells; it is not a
verdict on these stages.

## What the repairs established

- **The effective gate is the task's, and it is checked before dispatch.** Every Swarm record
  carries `gatePlan` with `expected` and `effective` both `npm run test-node` (or the task's
  `npm test` for the bug fix) and `status: passed` under the launch's own home; the sealed gate
  set in each session ledger names the same command. The preflight took about 8 seconds per
  launch.
- **Each launch had a fresh home of its own.** Every record's `preparedState` names a home
  under the launch's scratch, fresh, with no browser cache before or after; no launch could
  find what another installed. The OpenCode arm ran under a fresh HOME as well (it migrated its
  own database there in a second). npm's store was the shared content-addressed cache by link,
  as declared.
- **The product's bounds and accounts held.** The bug-fix launch's stall notices named the
  repeated call and its answer; each repair attempt was handed the account of the loop before
  it (the files read, the probe script written, the empty greps, the refused calls) and held
  back the measured gate time; no gate was recorded as failed for want of time, and no
  refusal was read as a regression or as a failure at the base.

## The new defect, and its repair

The chai feature launch under Swarm passed its sealed gates, including the task's node suite,
and its visible check. Its final independent verification, which judges the candidate in a
fresh checkout, assembled its own gates from the checkout's manifest because the goal context
handed it only the lockfile and not the run's gate overrides, and the checkout has no swarm.toml
(the workspace's is untracked and excluded from the patch). It ran `npm test` at base and
candidate; both failed on the browser suite with outputs that differ run to run, the regression
dimension was recorded unmeasured, and the task-acceptance gate refused the run.

Repaired in commit "Carry the run's gate overrides into the independent verification of a goal
run": the goal context now carries the run's swarm.toml gate commands and the verification
assembles the gates the run sealed. `src/cli-task-goal.test.ts` shows the refusal without the
overrides and the pass with them, with no model. The launch stands as recorded: a correct patch
that the product refused for the product's own reason. The remaining live verification of this
repair is incomplete: no launch has run on the repaired build, and none is started here.

Also observed in this launch's trace and left as diagnosed, not fixed: the standalone verifier
commands (`swarm ci`, `swarm-verify`) read no swarm.toml at all and would assemble the same
manifest gates; a project whose committed swarm.toml names a different test command is judged
by its manifest's script there.

## The bug fix: a capability limit on this model, with the product's share named

From the retained ledger of session 20261015T051419-83a9d1 and the two corrections:

- The first loop read the generator, its token rules, the Raw node and the syntax nodes,
  wrote a probe script that reproduces the defect (its output matches the task's "returns" and
  "must return" strings), and then re-read `lib/syntax/node/StyleSheet.js` four times with the
  same answer; the notice named the call, and it was repeated again, so the loop stopped at step
  23 with 244,018 tokens and no edit to the generator.
- The first repair attempt received the account above and started from the generator files
  again, searched the test fixtures, and ran one grep over the fixtures seven times (the same
  three-pattern grep printing nothing), stopping at step 20 with 267,881 tokens. The second
  attempt re-read `lib/syntax/index.js` four times and hit the token cap at step 9. The third had
  no tokens left.
- The two scripted corrections, fresh processes with 10.8 and 0.8 minutes of wall, read and
  probed again and edited nothing.
- Tool refusals in this trace, each the model's call and each costing a step: a `node -e`
  script with a line break was refused as a path holding a control character; a numeric
  argument sent as a string was rejected by the schema (twice); a read of swarm.toml was
  refused by the credential denylist (twice); a write before any file set was declared was
  refused with the remedy named (twice, then declared and written). None blocked the fix: the
  generator files were read, and the model never attempted an edit to them.

Classification: the model, given the file locations, a working reproduction and the account of
what it had already tried, did not move from reading to editing on this task in any of six
loops across two launches (the pilot's and this one), at about 1.4 million tokens in all. The
product's share, repaired on this branch, made each loop cheaper and its stop honest; it did not
and could not supply the edit. A functioning stop is not a recovery. The bug fix remains
undelivered and is reported as the limit it is.

## Timing and caches

The product build under test is the repaired source at commit
`6f49840028be5a88fd3a2ae3110dbf47cb764872` (dist digest `sha256:60d7513a…`, pinned in each
manifest); OpenCode 1.14.48; the same model, server and settings as stage A, server loaded at
04:44Z and unloaded at 05:34Z. Fresh homes meant OpenCode migrated its database on every launch
(about one second) and Swarm's own install step read the shared npm cache; the model server
kept its prefix cache from earlier runs of the same products, a speed effect disclosed and not
controlled, as in stage A. Agent times here are not comparable with stage A's beyond the
qualitative reading above.
