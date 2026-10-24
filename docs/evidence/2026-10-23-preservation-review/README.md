# Preservation and candidate review stage, October 23, 2026

This stage set out to make Swarm deliver more complete, correct changes, and to verify what a
change preserved as well as what it added. It:
- corrected the refusal of correct refactors;
- recorded preservation obligations on every run;
- tried an experimental review of the actual candidate;
- ran a development study, a registered fresh block and two confirmation rounds.

Everything ran on `qwen3.6:35b-a3b` through local Ollama, one sequence at a time. Paid inference
was $0. Design: [design note](design-note.md). Files: [intended files and amendments](intended-files.md).

**Bottom line.**
- **Refactor refusals corrected.** Two correct refactor deliveries that had been refused now
  verify. All ten incorrect candidates of those two tasks stay refused.
- **The review showed no benefit.** In the development study it established 3 findings, and the
  offline assessor rated all 3 as false accusations against the reference. The 5 attempts it
  earned changed no hidden verdict. In the fresh block it was never asked, because the gates never
  went green.
- **Fresh block.** Revised Swarm completed 4 of 6 launches, the same as Swarm without the review.
  aider completed 3 and OpenCode 5. Swarm's own verdict accepted none of its 8 complete-by-hidden
  candidates, so nothing was delivered.
- **Why Swarm's verdict refused.** Three repair-policy defects classed a failure the change itself
  caused as missing setup, so repair stopped with its attempts unused. All three are corrected. In
  the second confirmation round repair ran and removed every lint finding the change had added.
- **What still blocks delivery.** On a project whose blocking lint already fails on the base,
  Swarm cannot accept any change that leaves that failure alone. This stage does not correct that.

## The eight questions

1. **Did Swarm deliver more complete correct artifacts?** No.
   - **Fresh block.** By the registered definition, revised Swarm completed 4 of 6, as did
     `swarm-control`. aider completed 3 and OpenCode 5. Its own verdict accepted none of them, so
     revised Swarm *delivered* 0 of 6.
   - **Development study.** 1 of 6, against 2 of 6 for the implementation without the review.
2. **What did those artifacts add?** The four complete revised-Swarm artifacts are the ufo
   `filterQuery` feature (2) and the ufo base-prefix boundary fix (2). Each has a test that fails on
   the base source and passes on the delivered source. All three other arms produced the same.
3. **What existing behaviour did Swarm verify they preserved?**
   - The base suite: every final verification of a ufo candidate read the project's tests as
     passing.
   - The task's own preservation sentences: recorded as authoritative obligations, but
     **unmeasured**, because the review that measures them never ran in the fresh block.
   - In round 2 the hidden kept-behaviour check failed one `swarm-control` candidate (ufo bug fix).
     That candidate already failed it before repair, and no check in the run measured it.
4. **Which exact observation changed which implementation?**
   - The fresh block's records show every hidden-pass Swarm candidate stopping with
     `repair-unavailable` / `setup` after 0 of 3 attempts. The acceptance gate's
     `setup unavailable: a check fails at the base commit too …` led to amendment 10.
   - Round 1 showed that rule never fired: stood-down checks carry an `unavailable` text. That
     corrected amendment 10 again.
   - Round 2's nanoid stop on `Cannot find module './random'` led to amendment 11.
   - The scorer stop on launch 8 led to amendment 9. The fresh block's first launch, which stopped
     before inference, led to amendment 8. Its preflight led to amendment 7.
5. **Did the improvement repeat or transfer?**
   - The repair-label correction repeated in the five round-2 runs it applies to: repair
     proceeded in every one.
   - It did not transfer to delivery. Repair changed no hidden verdict, and the product accepted
     nothing (next section).
   - The refactor correction was reproduced on both refactor tasks, from the published records.
6. **Did the product correctly deliver the result?**
   - It made no false accept in the fresh block. It refused 8 hidden-pass candidates; each had added
     lint findings, which is a real, minor regression.
   - In round 1 it made one false accept: nanoid `swarm-control`, accepted while failing the hidden
     behaviour check.
   - In round 2 it refused a candidate the hidden evaluator passes. That candidate's lint reports
     only what the base reports, and its final verification reads regression pass.
7. **How did it compare with each control, at what total cost?** Fresh-block pairs by task and
   sample (wins, losses, ties), for revised Swarm:

   | Opponent | Wins | Losses | Ties | Opponent's wall | Opponent's tokens |
   | --- | --- | --- | --- | --- | --- |
   | `swarm-control` | 0 | 0 | 6 | 1,243 s | 5.67M |
   | aider | 1 | 0 | 5 | 2,380 s | 0.21M |
   | OpenCode | 0 | 1 | 5 | 938 s | 4.68M |

   Revised Swarm itself used 1,428 s and 7.12M tokens. No arm made an unknown-usage call. Totals
   for the stage:
   - development study: 7,360 s and 35.1M tokens;
   - fresh block: 5,989 s and 17.7M tokens;
   - two confirmation rounds: 3,676 s and 17.2M tokens.

   Human intervention during launches: none. Between freezes, the implementer made the recorded
   setup and scorer corrections.
8. **What remains untested or unproven?**
   - Whether Swarm delivers once that blocking-gate limit is addressed.
   - Whether the review helps when it is asked at all: it ran in the development study only, with
     no valid finding.
   - Anything at scale: these are counts from three-task blocks with one model.

## 1. Refactor refusals

The two complete refactor deliveries of the controller stage were refused because a refactor
must edit the files that name what it renames: a lint ignore list, a build entry, a test's
`require`. `rename-transport-v1` reads a changed configuration or test file as the base's
instrument where it differs only in references moved along the patch's own renames, verified as
a set ([verifying](../../verifying.md)). The standalone verifier re-derives the decision.

Reproduction over all 12 published candidates of both tasks, with the sealed contract
([script](reproduce-refusals.mjs)):

| Build | Hidden-pass candidates verified | Hidden-fail candidates verified |
| --- | --- | --- |
| base `66b421274` ([summary](reproduction/before-66b421274.json)) | 0 of 2 | 0 of 10 |
| `dc00353a9` ([summary](reproduction/after-dc00353a9.json)) | 2 of 2 | 0 of 10 |
| final `1fb954b53` ([summary](reproduction/after-1fb954b53.json)) | 2 of 2 | 0 of 10 |

Five deterministic controls stay refused on a Biome fixture: a rule switched off, a narrowed
glob, a swallowed status, a printed pass and an unwritten build output.

## 2. Preservation obligations

Each run records, before the first model call, what it must preserve and where that comes from:
the task's words, the supplied contract, the base suite and review probes
([description](../../candidate-review.md)). The planner cannot remove an obligation. An obligation
nothing measured is reported as unmeasured. On the fresh block every task sentence obligation
stayed unmeasured, and the contract's obligation was decided by its check.

## 3. Candidate review (experimental, off by default)

[Development protocol](development-protocol.md), [launches](development-launches.md), records in
[development/](development/). Three arms, 18 launches on three exposed tasks:

| Arm | Complete | Wall | Tokens | Unknown-usage calls |
| --- | --- | --- | --- | --- |
| `swarm-control` | 2 / 6 | 2,024 s | 10.3M | 0 |
| `swarm-prose` (equal-budget prose control) | 1 / 6 | 2,622 s | 12.6M | 3 |
| `swarm` (executable review) | 1 / 6 | 2,714 s | 12.3M | 8 |

- Five review attempts were made, and none changed the hidden verdict.
- Most probes never loaded: they named exports the project does not have.
- The 3 established findings were all false accusations by the offline assessor against the
  reference ([findings](development/findings.json)).
- So no new mechanism went into the fresh block, and the review stays experimental.

## 4. Fresh block

[Selection rule](fresh-block-selection-rule.md), [protocol](fresh-block-protocol.md),
[launches](fresh-block-launches.md), records in [fresh/](fresh/). Three new tasks, four arms, two
samples, 24 launches. Every launch has an outcome. Two freezes were superseded before any scored
launch, and one scorer stop was corrected under `--correction`, all recorded.

| Arm | ufo feature | ufo bug fix | nanoid refactor | Complete | Swarm verdict accepted |
| --- | --- | --- | --- | --- | --- |
| `swarm` | 2 / 2 | 2 / 2 | 0 / 2 | 4 / 6 | 0 |
| `swarm-control` | 2 / 2 | 2 / 2 | 0 / 2 | 4 / 6 | 0 |
| aider | 2 / 2 | 1 / 2 | 0 / 2 | 3 / 6 | n/a |
| OpenCode | 2 / 2 | 2 / 2 | 1 / 2 | 5 / 6 | n/a |

- **Scoring.** The corrected scorer agrees with the runner on all 23 launches the runner judged.
  Launch 8 is scored by the corrected scorer alone.
- **Completion claims.** OpenCode claimed completion 6 times, and the hidden evaluator passes 5 of
  those. aider makes no claim.
- **The review.** It was withheld in all six revised-Swarm launches, because the gates never went
  green.

## 5. Why Swarm refused, and what was corrected

| Defect | Seen in | Correction |
| --- | --- | --- |
| A reading the change left unmeasured (a base-failing lint whose output the change altered; tests the change edited, read again without its edits) labelled `setup unavailable`, so repair stopped with attempts unused | all 8 hidden-pass ufo Swarm runs; 2 nanoid runs | `unmeasured by the change`; repair proceeds ([amendment 10](intended-files.md)) |
| The same rule never fired live: a stood-down check's absence reads as `unavailable` | confirmation round 1, all affected runs | stood-down checks skipped; checked against every recorded verification ([replay](confirmation/replay/)) |
| `Cannot find module './x'`, the change's own broken `require`, read as a missing tool | round 2 nanoid `swarm`; replay changes 5 recorded nanoid cycles and nothing else | only a bare package specifier is setup ([amendment 11](intended-files.md)) |

[Confirmation](confirmation-launches.md), under its [protocol](confirmation-protocol.md), on the
now exposed tasks:

| Round | Build | Repair attempts used in affected runs | Complete | Product accepted |
| --- | --- | --- | --- | --- |
| 1 | `fa9b90055` | 0 (correction did not fire) | 3 / 6 | 1, a false accept |
| 2 | `1fb954b53` | all 5 runs amendment 10 applies to repaired; nanoid `swarm` stopped on the defect amendment 11 corrects | 1 / 6 | 0 |

In round 2 the first repair removed every lint finding the change had added, in all four ufo runs.
Scored offline from the runner's snapshots, repair changed no hidden verdict in either direction.

## Remaining failure and the next falsifiable hypothesis

- **The ufo bug fix candidate.** In round 2, `swarm`'s ufo bug fix candidate passes the hidden
  evaluator, reports only the base's own lint finding, and reads regression pass in the final
  verification. It was still refused with `blocking gate(s) failed: lint`, because the loop's
  blocking lint gate fails as it does on the base.
- **The existing remedy.** The product already has one: declare such a gate advisory. Neither
  study declared it, so this limit applied to every Swarm launch on ufo.
- **Hypothesis.** On a project whose blocking lint already fails on the base, with that gate
  declared advisory and the corrections of this stage, Swarm delivers the ufo candidates it now
  repairs. It would be refuted if, on a fresh registered block, Swarm's verdict still accepts none
  of its complete candidates, or accepts one the hidden evaluator fails.

## Reproduce

```sh
# refactor refusals, from the published records
node docs/evidence/2026-10-23-preservation-review/reproduce-refusals.mjs --cli dist/cli.js \
  --sessions <session archive root> --out <dir>
# scoring, from a study directory with revealed records
node docs/evidence/2026-10-23-preservation-review/score-study.mjs --manifest <manifest.json> \
  --revealed <runs/revealed.json> --out <scores.json>
# repair classification and acceptance reading over recorded runs
npx tsx docs/evidence/2026-10-23-preservation-review/confirmation/replay/replay-classify.mjs \
  src/gates/repair-policy.ts <study directory>...
npx tsx docs/evidence/2026-10-23-preservation-review/confirmation/replay/live-acceptance.mjs \
  <study directory>...
# packed records, byte for byte
node scripts/evidence-pack.mjs restore docs/evidence/2026-10-23-preservation-review/fresh/packed-derived/records
```

The session ledgers of every launch are archived on the branch
`evidence/2026-10-23-preservation-review-sessions`.
