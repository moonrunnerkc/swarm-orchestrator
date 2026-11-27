# Known issues

Defects found while working on something else, each with a reproduction, kept here instead of
fixed in an unrelated change. A fixed entry is removed in the commit that fixes it.

## The cross-module refactor acceptance task has no complete run on a local model

tracemantle's move of its history modules into a new package, with shims and moved tests, has not
completed on a local model. The first run that met no defect of the product (16.0.2 candidate,
session 20261103T231418-6662f6, gemma4:31b then swarm-redesign-qwen36-32k, isolated, replay agrees)
moved both modules and the three test files and wrote both shims as `from ... import *`, which does
not re-export an underscore name; the moved `history_store.py` imports `_entry_from_dict` from the
old path, so test collection fails with ImportError and the verifier reports the regression. The
model ran no test, then both models repeated a read until the run stopped for no progress.
Named on 2026-11-04, qwen3.6:35b-a3b added two files of the move and stopped, and swarm-verify 2.0.2
called it complete through a defect fixed in 2.0.3 (incomplete when judged again); mistral-small3.2:24b
moved the test files, ran its module moves from the wrong directory, and the regression was found.
Every t6 run before it was invalidated by a defect of the product, not a limit of the model: swarm-verify 2.0.0 refused the correct
move (fixed in 2.0.1), BSD `sed -i` failed every in-place edit on macOS (fixed in 16.0.2), and the
first 16.0.2 attempt (session 20261103T213819-76ab1e) read a diff cut so that its second shim showed
under the first file's header (fixed in 16.0.2). Evidence: docs/acceptance/2026-10-31/README.md,
Reruns for 16.0.2. Reproduce: `acceptance/closing/run-task.sh t6-tracemantle --model auto` in the
work root, or judge any agent's patch with the command in
docs/acceptance/2026-10-31/t6-comparison/README.md.

## Drafted checks and bindings depend on the drafting model

The check for a task and the binding for a security obligation are drafted by the model the run
uses. On the invoice example's seeded-fault task (`examples/invoice-api-checks/seeded`),
gemma4:31b drafted a sound test and binding; qwen3.6:35b-a3b drafted a control that asserts the
new field is absent, which passes at the base and fails every correct change, so its run ended
incomplete on a correct first edit; mistral-small3.2:24b did not open its reply with the `kind:`
line and its run was blocked before editing. A draft that is wrong in a way the base cannot show
(a control like that one, a wrong record, a wrong value the owner should see) refuses a correct
change; it does not pass a wrong one. Read the drafts (`--write-checks`, or approve them at a
terminal) where the model is not one whose drafts you have seen. Evidence:
docs/acceptance/2026-11-26-closeout/README.md, runs `dev-invoice-seeded-2-qwen` and
`dev-invoice-seeded-3-mistral`.

## A test that leaves a server listening holds its check until the timeout

`node --test` does not exit while a test's server, timer or connection is open. A test that
asserts before it closes its server leaves it listening when the assertion fails, and the check
then waits out its time limit: twenty minutes in the verifier, ten in the harness's own run
between turns. On the notes example a model added such a test and one run spent its budget
there (docs/acceptance/2026-11-26-closeout/README.md, run `dev-notes-feature-1`). The model is
now told what a timed-out check usually means. Forcing the runner to exit was tried and not
kept: it cut the runner's report short. Reproduce: add a `node:test` file that calls
`server.listen(0)`, fails an assertion and only then calls `server.close()`, and run
`node --test`.
