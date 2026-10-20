# The new regressions against the previous implementation

[regressions-before.sh](regressions-before.sh) gave a detached worktree of PR #89's head
`9db7ec3d4` the test files of `64b68d0cf` and ran only this work's new tests by
name. Deterministic and scripted-model tests only; no live model. Output, verbatim (durations
stripped):

```
=== src/cli-planned-checks.test.ts -t "a preserve check the base fails"
     × drops a preserve check the base fails, and says when its answers were one value
     × records a disagreement on an input the task names, not a finding that the requested behaviour is wrong
     × records a genuinely wrong expectation on an input the task does not name as unnamed
     × admits a check reclassified to change only by the change control, for a case the task names
     × refuses a reclassification whose changed case the task does not name, however it quotes the task
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
      Tests  5 failed | 1 passed | 9 skipped (15)
=== src/cli-plan-checks.test.ts -t "a requirement whose only generated check is rejected"
     × hands the revision the task's words, each case with the base's answer, and the choice between correcting and reclassifying
     × keeps a requirement whose revision declares nothing visible as uncovered, with the reason and the next action
     × does not count a coverage review that names a rejected check as covering anything
     × names a withheld revision in the uncovered requirement's reason
     × names a revision whose allowance ended before it declared anything
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
      Tests  5 failed | 12 skipped (17)
=== src/cli-task-contract.test.ts -t "generated check covers|every planned requirement has a check"
   × names each requirement no generated check covers in the worker's brief, with why and what to do
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 1 passed | 4 skipped (6)
=== src/cli-run-outcome.test.ts -t "the reason planning recorded"
     × gives a planned requirement with no check the reason planning recorded and the next action
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 14 skipped (15)
=== src/cli-planned-checks.integration.test.ts -t "a requested outcome the task describes as kept"
     × keeps the requirement in the worker's brief and the result when the revision replaces nothing
     × admits the planner's reclassification as a change, with its justification, by the change control
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 22 skipped (24)
=== src/tools/output-view.test.ts -t ""
Error: Cannot find module './output-view.ts' imported from /private/tmp/claude-501/-Users-brad-projects-swarm-orchestrator/e803d825-eee7-415d-b22d-2188a205b710/scratchpad/reg/before/src/tools/output-view.test.ts
      Tests  no tests
=== src/tools/recorded-output-tool.test.ts -t ""
Error: Cannot find module './recorded-output-tool.ts' imported from /private/tmp/claude-501/-Users-brad-projects-swarm-orchestrator/e803d825-eee7-415d-b22d-2188a205b710/scratchpad/reg/before/src/tools/recorded-output-tool.test.ts
      Tests  no tests
=== src/agent-run.test.ts -t "a verbose command in the worker's loop|the gates after a loop that spent its wall"
     × is resent as a bounded view, its omitted lines come back by reference, and the gates decide as before
     × still runs the required checks on the exact tree the loop delivered
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 2 passed | 36 skipped (40)
=== src/core/loop.test.ts -t "past its own wall"
     × stops as max-wall-time when the abort arrives past its own wall, mid-tool
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 1 passed | 39 skipped (41)
=== src/cli-run-settings.test.ts -t ""
     × holds the policy floor where nothing was measured
     × holds four times the measured preparation and checks, C1's 22.4 s preflight giving 89.6 s
     × never holds more than a quarter of the total, so earlier phases keep the rest
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
TypeError: verificationReserve is not a function
TypeError: verificationReserve is not a function
TypeError: verificationReserve is not a function
      Tests  3 failed (3)
=== src/cli-goal-budgets.integration.test.ts -t "final checks' share|cancelling a goal run"
     × runs the required checks on the exact delivered tree after the worker spends its allocation
     × stops a check slower than the reserve at the end of the total, and reports the run incomplete
     × stops the run and its checks, and the result says it was cancelled
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
      Tests  3 failed | 4 skipped (7)
```

Reading it:

- Every new regression fails on the previous implementation. The two new modules and the reserve
  policy do not exist there, so their files fail at import or with `is not a function`.
- Passing there, as intended: the guard that a reclassified check whose kept case the base
  contradicts is still refused; the guard that the brief adds nothing when every planned
  requirement has a check; the cancellation and end-of-allowance scenarios at the `runAgentTask`
  level, which assert refusal and not-green and held already; and the loop's mid-call case, which
  the call's own deadline already classified.
- `drops a preserve check the base fails, and says when its answers were one value` is an existing
  test whose name the selection matched; its expectation was changed on purpose (the finding is
  now `disagrees-with-base`), so it fails on the old code by design.
- `stops the run and its checks, and the result says it was cancelled` fails on the old build only
  on the refusal's wording: there cancellation already stopped the run and refused the tests gate,
  with the fixed text "the run was cancelled" instead of the signal's own "the run was cancelled
  from the keyboard". It is not evidence that cancellation was broken before.
- The two `cli-goal-budgets` reserve scenarios fail on the old build at their first assertions
  (no `verification-reserve-v1` record; no "total allowance ended" refusal). The substantive old
  failure, C1's refused final gates, is the one `still runs the required checks on the exact tree
  the loop delivered` shows: the tests gate reads `not-applicable` there.
