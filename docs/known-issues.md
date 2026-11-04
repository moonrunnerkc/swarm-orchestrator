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
Every t6 run before it was invalidated by a defect of the product, not a limit of the model: swarm-verify 2.0.0 refused the correct
move (fixed in 2.0.1), BSD `sed -i` failed every in-place edit on macOS (fixed in 16.0.2), and the
first 16.0.2 attempt (session 20261103T213819-76ab1e) read a diff cut so that its second shim showed
under the first file's header (fixed in 16.0.2). Evidence: docs/acceptance/2026-10-31/README.md,
Reruns for 16.0.2. Reproduce: `acceptance/closing/run-task.sh t6-tracemantle --model auto` in the
work root, or judge any agent's patch with the command in
docs/acceptance/2026-10-31/t6-comparison/README.md.
