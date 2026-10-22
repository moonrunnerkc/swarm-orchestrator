# Evaluator sensitivity beyond the upstream tests, with no model

The upstream test file of the alias task checks only `--t`; a fix that special-cased `t` would
pass it. So each task's hidden material also carries a behaviour check
([hidden/](hidden/)): every example its task text states, the required ones and the ones that
must not change, run in the scoring checkout after the upstream test file
(`hidden.extraArgv`). Read on the selection's checkouts (Node v24.15.0):

| task | tree | upstream test file overlaid | behaviour check |
| --- | --- | --- | --- |
| alias | base | exit 1 (38 passing, 1 failing) | exit 1: 7 of 16 examples do not hold, all of them required ones |
| alias | upstream | exit 0 (39 passing) | exit 0: all 16 hold |
| alias | partial: two-dash one-character aliases fixed for `t` only | the base's own file: 38 passing | exit 1: `--R dot`, `--r` twice, `--j 3`, no alias keys |
| unparse | base | exit 4 (3 passing, 4 failing) | exit 1: 5 of 8, all of them required ones |
| unparse | upstream | exit 0 (7 passing) | exit 0: all 8 hold |
| unparse | partial: `=` form for dotted names and names starting with `$` only | | exit 1: the reporter, require and timeout, number and leading-dash examples |

Every must-not-change example holds on the base, so the check refuses only missing behaviour.
The partial fixes of [selection.md](selection.md) (visible check passing, upstream test file
refusing) stand beside these.

The harness's own validator, run again with the behaviour checks registered
([validation-with-behaviour-checks.json](validation-with-behaviour-checks.json)): both tasks
VALID; the base fails the hidden reading (executed), the reference passes the upstream file, the
behaviour check and the project's tests.

The regression-test scorer ([score-tests.mjs](score-tests.mjs)) on the upstream patches
([tool-validation/](tool-validation/)): each adds one test, which passes on the reference and
fails over the base's source; on the alias reference's source alone it finds no test file and no
added test.
