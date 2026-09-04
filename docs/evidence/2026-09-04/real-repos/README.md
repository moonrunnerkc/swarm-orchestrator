# Real repositories, 2026-09-04

Three public TypeScript repositories, one task each, run three times by the swarm arm and, where
it ran, three times by a baseline that is Claude Code headless against the same local model.
Both arms are scored by the same harness with no model involved. This file and everything
beside it that a run could be shaped by, the task text and the hidden acceptance test, were
committed before the first run.

| Repository | License | Lines | Pinned commit | Task | Test runner |
| --- | --- | --- | --- | --- | --- |
| `gvergnaud/ts-pattern` | MIT | 16,283 | `c92ca435c7` | `ts-pattern/task.md`, from open issue #230 | jest |
| `gigobyte/purify` | ISC | 8,123 | `d440252d40` | `purify/task.md`, self-authored | vitest |
| `darkreader/darkreader` | MIT | 29,409 | `ace67ae13e` | `darkreader/task.md`, self-authored | jest |

The three come from the campaign's sealed selection (`../../../campaign/selection/repos.json`):
each is MIT or ISC, between 5k and 50k lines, has a `test` script, and its suite was shown
passing at the pinned commit inside the campaign's container. The lines and commits above are
copied from that file. The clones under `campaign/work/` are the seeded workspaces' parents and
are not the workspaces the runs use: each run gets a fresh clone at the pinned commit.

## Hidden acceptance tests

One per task, under `<repo>/hidden/`, written before any run and never shown to either arm. A
hidden test is copied into a scratch copy of the produced tree, at the path named in its
header, and the project's own runner runs that one file. Passing it is recorded beside the
harness measures and is not a gate: it says whether the produced change does what the task
asked, by one test the model never saw.

## Scoring

`swarm gates --workspace <clone> --base <commit>` over each produced tree, which seals the
criteria, runs every gate once with no model and no retries, and writes a bundle whose base
comparison carries the harness measures: tests declared, assertions, skip markers, tests
collected and coverage of changed lines where the runner could be vouched for. The bundle is
the record; the report reads from it.
