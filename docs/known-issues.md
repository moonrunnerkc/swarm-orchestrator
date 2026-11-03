# Known issues

Defects found while working on something else, each with a reproduction, kept here instead of
fixed in an unrelated change. A fixed entry is removed in the commit that fixes it.

## The cross-module refactor acceptance task has no complete run on a local model

tracemantle's move of its history modules into a new package, with shims and moved tests, did not
complete on any local model this machine runs: the best attempt (gemma4-31b-greedy-128k, session
20261101T221712-67545b) made the package and moved the tests but broke `history_io.py`, which the
verifier found as seven new failures; a narrower version (qwen3.6:35b-a3b, session
20261101T233622-12a75b) read files for 25 turns and changed nothing. Both replays agree. It is a
limit of the models tried, not a verifier defect, and is recorded rather than retried. Reproduce:
`acceptance/closing/run-task.sh t6-tracemantle` in the work root, or judge any agent's patch with
the command in docs/acceptance/2026-10-31/t6-comparison/README.md.

## swarm-verify: replay of a refused dependency preparation diverges

When the lockfile installs a package from beside the repository and that directory is missing,
preparation is refused and the result is blocked, but the statement records the dependencies as
`none` ("no dependencies were prepared"), the same as a run that asked for none
(`swarm-verify/src/verify/prepare.ts`). Replay reads that mode (`swarm-verify/src/api/replay.ts`), prepares
nothing, runs the checks without `node_modules` and reports incomplete: "diverges, state: recorded
blocked, replayed incomplete" (session 20261102T210229-519ea0). Fixing it changes what a statement
records, a 2.0.1 change. Reproduce: verify dossier from a clone with no `../ironroot` beside it,
then replay the result.
