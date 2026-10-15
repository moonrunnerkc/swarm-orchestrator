# Correction of 2026-10-15 to the real-task pilot's account

The pilot's frozen protocol, manifests, records, patches and output excerpts stand byte for
byte; its original analysis ([analysis.json](analysis.json), [results.md](results.md)) stands as
what the frozen analyzer derived on 2026-10-15T02:21Z. This document records what the retained
evidence shows about the pilot's setup that the original report understated, the corrected
derivation beside the original, when each fact was first observable and when it was recognized,
and the repairs made afterwards. The decision does not change: DO NOT PROCEED to a larger study,
now with a setup validity failure beside the delivery shortfall.

## What the original account got wrong

The original report's gate item 1 says all eight launches had "no unresolved setup or scoring
problem". The report also disclosed, in the same document and in
[environment.json](environment.json), that Swarm's blocking `tests` gate ran chai's `npm test`
while the task named `npm run test-node`, and that the upgrade launch's repair installed
browsers into the one child HOME every run shared, which the later feature launch's gate then
used. Those two disclosures contradict item 1: a launch whose product gate was not the task's,
or whose environment another launch prepared, is a record with an outcome, but it is not a
controlled comparison. The original analyzer could not say so because it read validity from two
fields only (`infrastructureFailure` null, no halt record), and neither field carries a
configuration mismatch or environment drift.

Four facts are now kept apart per launch by the corrected analyzer
(`scripts/pilot/analyze.mjs`, `swarm-real-task-pilot.analysis.v2`): a record exists and is
valid; its patch passes the specified checks; the arm delivered; the launch is eligible for a
controlled comparison. The corrected derivation is [analysis-corrected.json](analysis-corrected.json)
and [results-corrected.md](results-corrected.md), derived from the published
[stage-a/](stage-a/) directory alone (manifest, records, and the compressed blobs the records
cite, each verified against its digest), with no access to the comparison cache, the session
store, the model server or the repositories.

## Corrected stage A, launch by launch

| task | arm | record valid | correct patch | delivered | eligible for comparison | why not eligible |
| --- | --- | --- | --- | --- | --- | --- |
| chai-upgrade-c8-v12 | swarm | yes | yes | no | **no** | the product's blocking tests gate was `npm run --loglevel=error test` (script body `npm run test-node && npm run test-chrome`), not the task's `npm run test-node`; the arm installed a prerequisite (browsers) into its environment inside the measured task |
| chai-upgrade-c8-v12 | opencode | yes | yes | yes | yes | |
| lru-cache-refactor-autopurge-noop-timer | opencode | yes | no | no | yes | |
| lru-cache-refactor-autopurge-noop-timer | swarm | yes | yes | yes | **no** | the product's blocking tests gate was `npm run --loglevel=error test` (script body `tap`), not the task's `npx tap`: the same runner reached through npm's `pretest` and `test` scripts rather than as the task's argv; the rule compares the command the task names with the command the product ran, and they differ |
| chai-feature-deep-contain-oneof | swarm | yes | yes | yes | **no** | the same gate mismatch as the upgrade; its tests gate ran a browser suite against browsers the upgrade launch had installed into the one shared child HOME |
| chai-feature-deep-contain-oneof | opencode | yes | no | no | yes | |
| csstree-bugfix-raw-value-whitespace | opencode | yes | no | no | yes | |
| csstree-bugfix-raw-value-whitespace | swarm | yes | no | no | yes | the task's command is `npm test`, which the product ran; the shared HOME held browsers by then, and the packaged gate run shows the csstree suite did not use them |

The observed successes stand: Swarm's refactor and feature patches passed the sealed oracle and
were delivered with the product's own acceptable verdict; its upgrade patch passed the oracle.
What changes is what those launches can be compared against. Corrected stage A gate:

| item | original | corrected |
| --- | --- | --- |
| eight valid launches, no unresolved setup or scoring problem, no exposure | yes | **no**: setup problems on three Swarm launches (listed above) |
| Swarm delivers at least three of four including the bug fix and the feature | no | no |
| zero false claims, no manual help, budgets respected | yes | yes (exposure status is as the launcher scanned it, unknown beyond that scan) |
| comparative benefit | yes, descriptive | reported, but over launches of which only one Swarm launch is an eligible comparison |

Per-arm summary under the corrected rule: Swarm 4 launches (4 valid, 1 eligible), 3 correct
patches, 2 deliveries (0 of them eligible); OpenCode 4 launches (4 valid, 4 eligible), 1 correct
patch, 1 delivery. Nothing comparative survives the eligibility rule, and the decision remains
DO NOT PROCEED.

## When each fact was observable, and when it was recognized

| fact | first observable | first recognized |
| --- | --- | --- |
| the product's tests gate was `npm test`, not the task's `npm run test-node` | 2026-10-15T00:23:58Z, in the product's own `plan:` lines at the start of the upgrade launch's stdout, and before that in the harness source: `writeArmConfiguration` wrote only `[providers]` | 2026-10-15T00:42Z, when the upgrade launch's result line was read after it exited, and named in [environment.json](environment.json) `driftObservedDuringStageA` and in the report's causes before the report was published; not treated as a validity failure until this correction |
| the upgrade launch installed browsers into the shared child HOME | 2026-10-15T00:35Z to 00:36Z, the download printed in the launch's tool output (local time 18:35, UTC-6) | the same reading at 00:42Z; the dependency of the feature launch's gate on it was recognized only in this correction, from the packaged gate-run payload of session 20261015T011758-c826a1 |
| the lru-cache gate ran through npm rather than as the task's argv | 2026-10-15T01:14:27Z, the `plan:` line of that launch | this correction |
| the frozen upgrade reference declares `^12.0.0` while the task requires exactly `12.0.0` | 2026-10-15T00:23Z, the validation ran the maintainer's diff as the reference and the task text was in the frozen set; candidates.md disclosed the difference | this correction, as a validation gap: the frozen oracle did not enforce the declaration, so the validation passed a reference the task text rejects |

The runner did not detect any of these in real time, and nothing claims it did. Its stop
controls, proved on 2026-10-14, cover endpoint loss and replacement, pinned-configuration drift
(harness digest, Node, CLI bytes, OpenCode version, served model), preparation failure, scorer
failure, record validity and interruption. They did not cover the product's effective gate plan,
the arm's environment beside the workspace, or state carried between launches: none of those was
an input the preflight read. PR #81's proof stands for the classes it tested, and is preserved
as it was at [../../comparison-stop-controls/](../../comparison-stop-controls/README.md).

## The amendment to the upgrade oracle

[amendment-2026-10-15/validation-amended.json](amendment-2026-10-15/validation-amended.json)
re-runs the validation under `scripts/pilot/amendments.mjs`, which adds to the upgrade task what
its text already said: `c8` declared exactly `12.0.0` in package.json and in the lockfile's root
entry, the `test-node` script and the `overrides` block unchanged, and no file touched beyond
package.json and package-lock.json. The frozen oracle (`scripts/pilot/tasks.mjs`) is not changed.

- The base now has its hidden oracle executed, not short-circuited: csstree's and chai's hidden
  mocha suites exit 1 on the base, lru-cache's structural count is 0, the upgrade's lockfile
  resolves c8 to 11.0.0. The original validation recorded "the final tree is the base" for those
  rows, which was the scorer refusing an empty patch, not the tests rejecting the missing
  behaviour.
- The maintainer's historical commit fails the amended oracle: `package.json declares c8 as
  "^12.0.0", not exactly "12.0.0"`. A task-compliant reference, the maintainer's change with its
  two range declarations rewritten to the exact version and labelled as such, passes. The
  original validation's "reference passes" for the upgrade therefore held under an oracle weaker
  than the task text.
- The frozen wrong patch (a range declaration with the lockfile left inconsistent) is rejected
  because `npm ci` cannot prepare it, which is the lockfile reason and not the declaration
  requirement; the maintainer's commit is the control that shows the declaration is enforced.
- Retrospective recheck ([amendment-2026-10-15/recheck-upgrade-patches.json](amendment-2026-10-15/recheck-upgrade-patches.json)):
  both recorded upgrade patches (identical bytes from the two arms, digest
  `sha256:eb1e906c…`) pass the amended oracle. The stage A verdicts for them were right.

## Repairs, each with a regression that fails before and passes after

Product (`src/`, commit "Record refused gates as unmeasured, carry the previous loop's account
into repair, and name a run's child HOME"):

- A gate the harness refused to start because the wall budget was spent or the run was
  cancelled was recorded as a failed command (exit 128). The ratchet read "passed before, now
  failed" off that refusal and rejected the attempt as a regression; the base control was
  refused the same way, so the escalation reported the gate failing at the base. Seen on the
  upgrade launch (attempt 1 rejected for build, lint and format "regressing") and on both csstree
  corrections (every gate "fails the same way at the base commit: exited 128"). The refusal is
  now a start failure that names its reason; the observation is unavailable, not failed; the
  ratchet abstains on it by name while a gate the candidate itself made unavailable still
  regresses; the escalation says the gates could not be run.
- A repair attempt's loop could spend the whole remaining wall, leaving its candidate's gates
  refused: the attempt was then unmeasurable by construction. The attempt now holds back the
  failing cycle's measured duration.
- A repair loop started with no memory of the loop before it. On the csstree launch the first
  loop read seven files and searched eight times for `emitWsNeeded`, a name not in the
  workspace, and was stopped for repeating itself; the repair loop re-read the same files from
  the start and spent 292,267 tokens exploring until the cap. The repair brief now carries a
  bounded, harness-derived account of the previous loop (files read and edited, searches that
  matched nothing, refused calls), attributed as a record and not an instruction, and the stall
  notice names the repeated call and the answer it kept getting.
- Every run's child processes shared `$TMPDIR/swarm-child-home`. `SWARM_CHILD_HOME` names a
  run's own child HOME; the execution envelope and its record carry which HOME the run used.
- Two tool refusals from the same trace: `2>/dev/null` was denied as a path outside the
  workspace while `2>&1` beside a `$?` went through confirmation and ran; the null device is now
  allowed. The search tool answered a file path with the filesystem's `ENOTDIR` and the model
  went on to search the whole tree; it now searches within the file, and says in its own terms
  when a path is not there.
- The check report names the command each check actually ran, after any swarm.toml override.

Harness (`scripts/comparison`, commit "Give each comparison launch its own home and refuse to
dispatch Swarm until its effective tests gate is the task's"):

- The swarm.toml an arm's workspace gets is serialized from the frozen task's test argv as the
  product's blocking `tests` gate (plain words only; anything a shell could read otherwise is
  refused) and read back by the pinned build's own parser.
- Before a Swarm launch is dispatched, the pinned product's `check` runs over a fresh checkout
  of the prepared base under the launch's own home; its report must name the task's command as
  the tests gate and show it passing. A different command or a failing gate halts the campaign
  as a configuration fault, with the measurement kept on the attempt record (`gatePlan`).
- Every launch gets a fresh home under its scratch (Swarm's children through
  `SWARM_CHILD_HOME`, OpenCode through `HOME`); npm's content-addressed store inside it is a link
  to one shared cache, declared on every record (`preparedState`); what an arm installs there is
  recorded and removed with the launch. A manifest declares its prerequisites; a browser
  requirement this launcher cannot provision is refused before anything runs.
- The three fault-injection cases for these failures fail against the launcher as it was (the
  retained output in the new proof shows it dispatching, and one home for four launches) and
  pass against the repaired one. The new proof,
  [../../comparison-stop-controls-2026-10-15/](../../comparison-stop-controls-2026-10-15/manifest.json),
  is bound to the repaired bytes; the original proof is untouched.

Evidence (`scripts/pilot`): the analyzer reads a published stage directory alone and refuses to
derive from missing, corrupt, duplicate or absent cells; the publisher packages every cited blob
(compressed under its digest), each Swarm session's ledger, bundle manifest and gate-run payloads,
and the base manifests' scripts. Regressions cover an empty blob store, a corrupt blob, a
duplicate and a missing cell, the gate-mismatch eligibility rule, and a stage B gate that cannot
proceed on one arm's records.

## Diagnosis of the bug-fix failure

From the retained ledger of session 20261015T020025-3beb8b and the product source at the
tested revision:

- Steps 1 to 9 read the generator, its token-before rules, the Raw node, the visible check and
  the test directory: the relevant file locations were in hand by step 7.
- Step 10 asked the search tool to search within `lib/__tests/generate.js` and received
  `ENOTDIR: not a directory, scandir ...` (product: the tool took directories only).
- Steps 14 to 22 searched for `emitWsNeeded` eight times under `lib`, `.` and `dist` with
  varied include and exclude arguments. The name occurs nowhere in the workspace. The model's
  responses carried no text (thinking off), so the ledger does not say where the name came
  from; nothing the tools returned contains it, so it was not read from the workspace. The
  stall detector gave its notice at step 21, naming only that calls were repeated.
- Step 25's shell `grep ... 2>/dev/null` was denied for `/dev/null` (product); steps 26 to 32
  ran the same grep four times with `rc=1`, and the loop was stopped as stalled.
- The product's gates ran on the unchanged tree; the repair attempt began a fresh conversation
  with no account of the above, re-read the same files, reproduced the defect correctly at its
  step 9 (the two generate calls printed the expected wrong and right strings), then explored the
  test fixtures and documentation for the generator's `mode` option until the token cap.
  Attempts 2 and 3 ran with zero tokens left and were empty.
- The two scripted corrections were fresh processes with 4.4 and 0.4 minutes of wall; their loops
  spent all of it, every gate was refused before spawn, and each was reported as failing the same
  way at the base (the misattribution above).

Classification: the search for a name that does not exist, and the failure to move from a
correct reproduction to an edit, are the model's. The product made them more expensive than they
needed to be (the file-path search refusal, the null-device refusal, a stall notice that did not
name what was repeated, a repair loop with no memory of the first, gate refusals read as
regressions), and those are repaired above. Whether the repaired loop changes the outcome on this
task is what the development launches in [development/](development/README.md) measure; a
functioning stop is not a recovery, and a bug fix that is still not delivered is a capability
limit of this model on this task.

## Found by the development launches, after the above

The chai feature launch under the repaired instrument passed its sealed gates (the task's
`npm run test-node`) and was then refused by the product's own final independent verification,
which assembled gates from the fresh checkout's manifest (`npm test`) because the goal context
carried the lockfile but not the run's gate overrides. Repaired in commit "Carry the run's gate
overrides into the independent verification of a goal run" with a deterministic regression; no
launch has run on that build. Details and the bug-fix launch's diagnosis are in
[development/README.md](development/README.md).

## What remains unchanged

The frozen protocol, the stage A and stage B manifests, the eight records, the patches, the
output excerpts, the original analysis and results, the candidates and the environment record.
The original README is kept with a pointer to this correction at its top.
