# Requirement coverage, bounded tool output and the verification reserve, 2026-10-19

Follow-up to [repair-value](../repair-value/README.md) (PR #89), on the local branch
`fix/requirement-coverage-and-verification-reserve`. Declared files and amendments:
[scope.md](scope.md). Three kinds of evidence are kept apart: **deterministic** (no model),
**scripted-model** (the product driven by a scripted endpoint) and **live-model** (the registered
launches, [protocol.md](protocol.md), [launches.md](launches.md)).

## 1. C1, diagnosed from its own records (deterministic)

[c1-timeline.mjs](c1-timeline.mjs) verifies C1's restored chains (hashes and every blob) and splits
its wall without counting nested durations twice ([c1-timeline.json](c1-timeline.json)):

| phase | wall | model | tools and commands | other |
| --- | --- | --- | --- | --- |
| planning, round 1 | 234.1 s | 200.1 s (90.8 s a call cut off at the round's wall) | 32.7 s (the in-loop base run of the planned checks) | 1.2 s |
| planning, revision | 78.0 s | 77.0 s (32.4 s cut off) | 0.4 s | 0.6 s |
| seal and preflight of the sealed checks | 22.4 s | 0 | | 22.4 s (fresh checkout, install, checks) |
| worker loop | 429.0 s | 365.2 s, of which 300.7 s are six calls carrying the 113 KB `npm test` output | 60.3 s: 45.0 s two `run_check` verifications, 7.3 s and 5.3 s the two `npm test` runs | 3.5 s |
| final phase | 45.6 s | 0 | | 45.6 s: build, lint, tests refused; acceptance, bonds, independent verification |

Observed, not inferred: the six calls carried 50.9K to 52.6K input tokens and waited 47 to 51 s for a
first token; the first call after the output left the 14-message compaction window took 5.5K tokens.
**Hypothesis**, consistent with the records but not established by them: the compaction marker at
the head of every resent window changes on each call, so the local server could reuse no cached
prefix and re-read the whole prompt each time, which would explain first-token time tracking total
input rather than new input. The fix here (section 3) does not rest on it.

Also found in the records: a revision round got the first round's system prompt ("read the
relevant source ... then declare"), so C1's revision reread the repository for 45 s and declared
nothing; and the final gates were refused because the end of the worker's wall aborted the gates
engine's command signal. Corrections to the earlier account are appended to
[../repair-value/README.md](../repair-value/README.md).

## 2. What changed

- **A rejected check never removes the requested behaviour.** A preserve check the base fails is a
  disagreement with the base, case by case, with whether the task names the input. The revision is
  told the task's words, every case with the base's answer, and the choice between correcting an
  expectation and reclassifying as a change with its reason (admitted only by the change control
  and only for inputs the task names); it is told not to reread the repository. Coverage is
  reconciled against the retained contract, and a requirement left with no check is reported as
  uncovered, with why and the next action, in the brief, the outcome and the JSON result.
- **One verbose command no longer dominates later requests.** A shell output over 12,000 characters
  reaches the model as a bounded view with the recorded status, the omission, the omitted lines
  that mention a failure, and the evidence record; `read_recorded_output` returns omitted lines from
  the ledger. On C1's recorded output, through each build's own chokepoint and loop, the tool output
  in each later request falls from 113,651 to 9,806 characters ([context-size.json](context-size.json)).
  No live speed improvement is claimed from this.
- **Final verification keeps a share of the one total.** Gate commands stop only for cancellation and
  the end of the total allowance; model work ends a reserve earlier (four times the measured
  preflight, at least a minute, at most a quarter); a check still running at the deadline is
  reported as not run. A run whose work stopped at its wall is still not accepted, and is no longer
  called cancelled.

## 3. Verification before any launch (deterministic and scripted-model)

[verification.md](verification.md): `npm run gates`, `build`, `check:packaged` and `fuzz:build` all
exit 0 on `4e6c4e510` in a clean full-history clone; 4,525 tests pass and 29 are skipped, the same skips as on PR #89.
[regressions-before.md](regressions-before.md): every new regression fails on PR #89's head.

## 4. Live launches (live-model; five of five used, 20.3 agent-minutes)

| # | launch | hidden oracle | product's reading | final verification | wall | tokens |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | D1, Swarm `--plan-checks`, marked (exposed) | **fail** | `accepted`, exit 0 | completed (72.7 s of a 110.7 s reserve) | 567 s | 2,317,080 |
| 2 | Swarm `--plan-checks`, fast-xml-parser | not run | halted in the runner's preparation, no model call | | 0 s | 0 |
| 3 | arm 1, Swarm `--plan-checks`, yargs-parser | **pass** | `accepted`, exit 0 | completed (50.6 s of 91.2 s) | 497 s | 1,881,582 |
| 4 | arm 2, Swarm, yargs-parser | **pass** | `accepted`, exit 0 | completed (26.9 s of 60 s) | 110 s | 620,893 |
| 5 | arm 3, OpenCode, yargs-parser | **pass** | exit 0, claimed | none | 44 s | 263,751 |

- **D1** ([d1/README.md](d1/README.md)): a development result. The requested mixed-case scheme
  outcome was lost again, by a new route: its only check was a broken program read as a base
  disagreement, the revision was withheld for time, and coverage, reconciled per requirement, counted
  the requirement covered by a check of existing behaviour. Two product defects, recorded, not
  repaired under the protocol. The final checks did run on the delivered tree.
- **The comparison** ([comparison/README.md](comparison/README.md)): all three arms delivered the same
  one-line patch. Planned checks made no difference on this task but cost (4.5 times the wall, 3.0
  times the tokens of ordinary Swarm). Neither Swarm arm repaired. No comparative benefit in
  correctness over OpenCode is shown; ordinary Swarm took 2.5 times the wall and 2.4 times the tokens,
  for a result backed by a final independent verification.

## Remaining limitations

- Coverage is reconciled per requirement, not per requested outcome: a requirement whose named
  example's check is refused reads as covered while any other check of it is retained (D1).
- A check whose every case throws is read as a disagreement with the base, not as a broken program,
  when the run completes (D1).
- Whether a disagreeing case is "named by the task" is a verbatim token match; a task that states
  its example differently from the check's input is not recognised, and reclassification is then
  refused.
- The revision still needs a fixed minimum of planning time; when the first round uses the share,
  it is withheld (D1), and the requirement is reported uncovered only if no other check remains.
- The reserve's multiple of the measured preflight is a policy, not a measurement of the final phase.
- The comparison is one task with an easy one-line fix; it cannot show what planned checks or repair
  contribute where the first candidate is wrong.

## Correction, appended 2026-10-19 (the scores above stand)

From the follow-up in [../outcome-coverage/](../outcome-coverage/README.md). In section 4's
comparison bullet, "for a result backed by a final independent verification" describes a
capability, not a measured benefit: all three yargs-parser patches were the same and all three
passed the independent hidden oracle, so the comparison establishes a correctness tie and no
practical benefit from Swarm's internal verification records. Planned checks produced the same
patch at substantially greater cost (4.5 times the wall, 3.0 times the tokens of ordinary Swarm)
and are not shown to improve results. D1's two recorded defects (per-requirement coverage, and a
throwing check read as a base disagreement) are addressed by that follow-up; see its README.
