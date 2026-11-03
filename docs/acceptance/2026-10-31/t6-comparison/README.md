# The cross-module refactor, for comparison with another agent

The acceptance task no local model completed (see `../README.md`, t6 tracemantle). Everything
needed to give the same task to another agent and judge its patch by the same verifier, on the
same base, under the same requirement record.

| File | What it is |
| --- | --- |
| `task.txt` | The task, as every attempt was given it |
| `start.txt` | The starting commit of github.com/moonrunnerkc/tracemantle |
| `seed.patch` | The starting state's uncommitted edits: none (empty), the runs began at that commit |
| `requirements.json` | The acceptance criteria, as a swarm-verify requirement record |
| `attempt-full-scope/` | gemma4-31b-greedy-128k, session 20261101T221712-67545b: `delivered.patch`, `report.json`, `result.json`, `replay.out`, and `judged-with-requirements.txt` |
| `attempt-narrower/` | qwen3.6:35b-a3b on a narrower wording (`task.txt` there), session 20261101T233622-12a75b: an empty patch |

## The acceptance criteria

`requirements.json` holds one requirement, R1, the task's own wording, kind refactor: behavior
preserved (the project's declared `test` check, `python3 -m pytest -q`, with no new failure
against the base) and the structure the task asks for (the new package, the old paths still
present as shims, the three test files under `tests/history/` and gone from `tests/`). It is fixed
for every patch and was written from the wording, not from any attempt.

Read this before judging the task itself: the wording does not match the repository at the
starting commit. `history_store.py` is `src/tracemantle/history_store.py`, not under `core/`; and
the mypy `files` list (`src/tracemantle`, `scripts`) and hatch `packages` (`src/tracemantle`,
`src/skillcheck`) already take the whole tree, so neither needs an edit to include a new
subpackage. The record's assumptions say so, and its structure claims do not ask for either edit.
The module names inside the new package are left to the mover.

## Judging a patch

With swarm-verify 2.0.0 and docker (the image is pulled on first use), in a clone of the
repository at the starting commit:

```sh
git clone https://github.com/moonrunnerkc/tracemantle.git
cd tracemantle
git checkout 47203d2903394cbb8904637cad71b7b525b9ada7
npx -y swarm-verify@2.0.0 verify \
  --base 47203d2903394cbb8904637cad71b7b525b9ada7 \
  --patch /path/to/their.patch \
  --requirements /path/to/t6-comparison/requirements.json \
  --out ./verdict
```

The patch is a `git diff` against the starting commit, binary changes included
(`git diff --binary 47203d29...`). The verdict is the printed state, R1's status and the
regression, with a signed statement in `./verdict`; `exit 0` means complete. Checks run isolated
in a container with the network closed after dependencies are prepared, as they did for the
attempts here.

Applied to the full-scope attempt's patch, this command printed the result in
`attempt-full-scope/judged-with-requirements.txt`: state incomplete, R1 failed, seven new failures
in `tests.test_history_io`, three failures the base already has (a tiktoken cache, two
pre-commit network tests) inherited. That matches the attempt's own final verification. The 7 are
the tests that read `tests/fixtures/history`: the attempt moved `test_history_io.py` without
changing it, so it looks for its fixtures beside itself, and `history_io.py` is a working
re-export. A rerun against 2.0.1 with the same model (`../t6-tracemantle/closing-attempt-3/`)
made the same move with the same 7 failures.
