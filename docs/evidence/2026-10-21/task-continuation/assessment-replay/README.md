# Launch 2's final assessment, reproduced and corrected

No model is involved in anything here. The session comes from
`node scripts/evidence-pack.mjs restore docs/evidence/2026-10-21/task-continuation/packed-derived/payloads-2`
(`payloads/launch-2/session-20261021T165350-fe97b6`); the outputs are packed in
[../packed-derived/assessment-replay](../packed-derived/assessment-replay/) and `restore` gives them back.

| file | what it is |
| --- | --- |
| [replay-launch-2-assessment.mjs](replay-launch-2-assessment.mjs) | the worker and goal assessments recorded again over launch 2's chain by the product's own functions, both chains exported and re-derived by the standalone verifier; `--product <checkout>` picks the code |
| `before-173bce007.json` | on `173bce007`: identical to records 749 and 756, refused only for "the run stopped as max-wall-time"; all four re-derivations pass |
| `after-v5.json` | on the corrected code: `run-acceptance-v5`, `wallStop` `{ beforeDeadline: true, effectsSettled: true }`, worker and goal assessments acceptable, task accepted, lifecycle still `max-wall-time`; the launch's own records still re-derive as refused, and the replayed ones as accepted |
| [usage-account.mjs](usage-account.mjs), `usage-launch-1.json`, `usage-launch-2.json` | every model call of each launch counted from its records: launch 1, 56 of 56 reported; launch 2, 106 of 107, the 107th cancelled with its usage unknown |
| `regressions-on-173bce007/vitest.txt` | the new and changed tests run against the source of `173bce007` |

Commands, from the repository root, with `$SESSION` the restored launch-2 session:

    node docs/evidence/2026-10-21/task-continuation/assessment-replay/replay-launch-2-assessment.mjs --session $SESSION --out before.json --product <checkout of 173bce007>
    node docs/evidence/2026-10-21/task-continuation/assessment-replay/replay-launch-2-assessment.mjs --session $SESSION --out after.json
    node docs/evidence/2026-10-21/task-continuation/assessment-replay/usage-account.mjs $SESSION

## The tests that pin the correction

`src/evidence/run-assessment-deadline.test.ts` records each case on an injected clock at launch 2's
offsets, assesses it with `recordRunAssessment` and `recordGoalAssessment`, exports the chain and
has the bundled verifier re-derive every assessment:

| case | reading |
| --- | --- |
| model work cut before the deadline, every write settled, final checks and independent verification pass | accepted; lifecycle `max-wall-time`; the verdict's lifecycle reason says the checks decide and nothing is said of the model finishing |
| the same, final verification fails | refused, task rejected |
| the same, the required check fails in the final cycle | refused: required checks unmet |
| a write requested and never settled | refused: "with a write or shell call unsettled at the model-work cutoff" |
| a write that settled after the cutoff | refused (`effectsSettled: false`) |
| the loop's stop recorded at the deadline | refused: "at the run's deadline" |
| the allowance ended before the checks finished (recorded as cancelled), and the verification it cut | both refused, the verification's refusal named |
| cancellation (`interrupted`) | refused |
| a wall stop in a run with no reserve recorded | refused, as under every earlier policy |
| a final verification of a patch other than the delivered one | the goal assessment refuses to be recorded; one written by hand is not re-derived |
| the same artifact evidence after `completed`, `max-steps` and the model-work cut | identical goal verdicts, all accepted; `interrupted` and `max-tokens` still refused |
| a v4 record over a wall stop | re-derives as refused; a v4 record claiming acceptance does not re-derive |
| a v5 record whose `wallStop` says more than the chain | does not re-derive |

Through the real command line with a scripted endpoint (`src/cli-goal-budgets.integration.test.ts`,
real time, a one-minute allowance): the worker writes the change and its next call never answers,
model work is cut at its share, the delivered tree's checks and the final verification pass, and
the run exits 0 with status `accepted`, lifecycle `max-wall-time`, policy `run-acceptance-v5`, and
the hung call counted as unknown usage. In the same file, a check slower than the reserve is
stopped at the deadline and the run is not accepted, and a run cancelled by SIGINT is not
accepted. `src/core/loop.test.ts` pins the unknown-usage count (a call cut after it was sent, two
failed attempts, and no count for a call never sent); `src/cli-run-outcome.test.ts` the report line.

On `173bce007` ([regressions-on-173bce007/vitest.txt](../packed-derived/assessment-replay/)), 13 of
these fail. Eight fail on behaviour: the command-line run reads `not-accepted`; the assessment of
the cut with passing checks is refused; the equal-evidence comparison differs; the patch-mismatch
and failed-verification cases fail at their first step, the cut's acceptance; both unknown-usage
counts read 0; the report has no lifecycle line. The other five refuse there as here and fail only on
the new field (`policy`, `wallStop`) or the new refusal wording: the old policy refused those cases
too, for the wall stop alone.
