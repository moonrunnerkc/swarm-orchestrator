# Known issues

Defects found while working on something else, each with a reproduction, kept here instead of
fixed in an unrelated change. A fixed entry is removed in the commit that fixes it.

## The cross-module refactor acceptance task has no complete run on a local model

tracemantle's move of its history modules into a new package, with shims and moved tests, did not
complete on any local model this machine runs: the best attempt (gemma4-31b-greedy-128k, session
20261101T221712-67545b) moved `test_history_io.py` without the fixture path its seven fixture tests
read, and the narrower version (qwen3.6:35b-a3b, session 20261101T233622-12a75b) changed nothing.
This was recorded as a limit of the models and not a verifier defect; that is withdrawn. swarm-verify
2.0.0 also refused the correct move, which edits that path, reading the file as deleted (fixed in
2.0.1; docs/acceptance/2026-10-31/README.md, Comparison). Rerun once against 2.0.1 with the same
model (session 20261103T175257-900062), it moved the three test files byte for byte again, the same
7 fixture tests failed, and 2.0.1 read the moves and attributed the failures correctly. Reproduce: `acceptance/closing/run-task.sh t6-tracemantle` in the work root, or judge any
agent's patch with the command in docs/acceptance/2026-10-31/t6-comparison/README.md.

## The agent is not told its commands run on macOS, and BSD `sed -i` fails it

The agent's commands run on the host, and nothing in the system prompt (`src/agent/prompt.ts`)
names the operating system or its tools. On macOS, `sed -i "s/a/b/" file` reads the script as
`-i`'s backup suffix and the file name as the script, and fails with "bad flag in substitute
command". Both local-model runs of 2026-11-03 met it: the clean-install dossier run (session
20261103T205635-acc4bd, ledger records 28 and 31) never changed `dossier/src/adversarial/fs-walk.ts`, then
read it three turns running and stopped for no progress; the t6 rerun (session
20261103T175257-900062) met it in six commands, 23 `sed -i` edits failing the same way (ledger
records 15 to 36), and the model's own note blamed "the environment's sed implementation". The error is in the output the model reads, so this is not
the verifier or the chokepoint misreporting; a prompt that names the platform is a change past
16.0.1. Reproduce: on macOS, `sed -i "s/x/y/" README.md` in any repository, or rerun
`acceptance/closing/run-task.sh smoke-dossier --model auto` in the work root.
