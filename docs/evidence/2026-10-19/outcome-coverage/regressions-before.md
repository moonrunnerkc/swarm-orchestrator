# The new regressions against the starting implementation

[regressions-before.sh](regressions-before.sh) gave a detached worktree of `3e99b6305` (the branch
head before this work) the test files of the tested commit `b148573e3` and ran only this work's
new or extended tests by name. Deterministic and scripted-model tests only; no live model.
Output, verbatim (durations stripped):

```
=== src/workers/planned-check-program.test.ts -t "names a case thrown"
     × names a case thrown in the program's own code, or where no frame names a file, on its line
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 28 skipped (29)
=== src/cli-planned-checks.test.ts -t "a case that throws on the base"
     × refuses a check whose program throws in its own code, and does not read it as the base disagreeing
     × refuses a check whose adapter throws before it reaches the project
     × keeps a valid check whose every case finds the project throwing, as a diagnostic of the base
     × admits a declared throw the project raises, beside an answer that varies
     × does not let a throw in the program's own code meet a declared throw
     × admits a change check whose changed case finds the project throwing while its kept case agrees
     × refuses a check one of whose cases throws in the program while the others answer
     × records a throw no stack frame attributes as uncertain, and reads it as the base's answer
     × refuses a relation whose program throws in its own code at every position
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯
      Tests  9 failed | 15 skipped (24)
=== src/cli-plan-checks.test.ts -t "keeps an outcome unresolved|names a revision whose allowance ended"
     × names a revision whose allowance ended before it declared anything
     × keeps an outcome unresolved when its check is refused and a sibling under the same requirement passes
     × keeps an outcome unresolved when its revision is withheld for time
     × keeps an outcome unresolved when its check is declared again stating other words
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
      Tests  4 failed | 16 skipped (20)
=== src/cli-task-contract.test.ts -t "names an unresolved outcome"
   × names an unresolved outcome in the brief though another outcome of its requirement is checked
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 6 skipped (7)
=== src/cli-run-outcome.test.ts -t "scopes an accepted run"
     × scopes an accepted run to the supplied contract and names an unresolved outcome under its covered requirement
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 15 skipped (16)
=== src/cli-planned-checks.integration.test.ts -t "beside a checked sibling"
     × names the unresolved outcome in the brief, the report and the JSON, and scopes accepted to the supplied contract
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 24 skipped (25)
```

Every one fails there. Some could fail only because the old admission record has no `thrown`
field, so the nine thrown-case tests were run again on `3e99b6305` with the `thrown`
expectations and the notes assertions removed, keeping every finding and admission expectation:

```
     × refuses a check whose program throws in its own code, and does not read it as the base disagreeing
     × refuses a check whose adapter throws before it reaches the project
     × does not let a throw in the program's own code meet a declared throw
     × refuses a check one of whose cases throws in the program while the others answer
     × refuses a relation whose program throws in its own code at every position
      Tests  5 failed | 4 passed | 15 skipped (24)
```

Five fail on behaviour: the starting implementation reads a case thrown in the check program as
the base disagreeing (D1's shape, the adapter that throws before reaching the project, and one
throwing case among answering ones), it **admits** a check whose program throws in its own code
where a throw is declared, and it **admits** a preserve relation whose program throws at every
position, as holding. The four that pass with the new field removed are behaviour this work keeps:
a valid check whose every case finds the project throwing stays as a diagnostic, a declared throw
the project raises is admitted, a changed case the project throws on beside an agreeing kept case
is admitted, and an unattributed throw is still read as the base's answer.
