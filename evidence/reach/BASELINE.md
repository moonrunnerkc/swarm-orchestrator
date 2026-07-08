# Reach run: baseline

The left-to-do list, finished: miner definitional tightening, runner-agnostic
restoration proofs, one mine/review/fold cycle, pre-registered Hunt 6 (the first hunt
where an engine can genuinely execute on a wild cheat), and a commit-hygiene pass. The
pass-capability research problem stays parked.

## Branch point

- HEAD `12105fdf` (`docs(intake-rewire): capstone evidence report`), branch `main`.
- `git status --short`: one untracked file, `social-posts-behavioral-cheats.md`, the
  maintainer's and not touched by this run. Nothing else.
- Prior run's suite close: 2224 passing, 41 pending, 0 failing.

## Environment probes

| probe | result |
| --- | --- |
| `GITHUB_TOKEN` (`GET /rate_limit`) | HTTP 200 |
| `ANTHROPIC_API_KEY` (1-token haiku) | HTTP 200 |
| python3 / pytest | 3.12.3 / pytest 9.0.2 (present, live-validatable) |
| go | absent on PATH; installed user-local this run (below) |
| node | v18.19.1 ambient (engine pins its runtime via SWARM_EG_NODE_BIN) |

## Toolchain install (recorded)

Go was not on PATH and `sudo` needs a password, so the official go1.26.5 tarball was
installed **user-local** to `~/go-toolchain/go` (no sudo, no system change, reversible
by deleting the directory). The execution-grounded sandbox resolves a bare `go` against
the ambient PATH (`execEnv` appends `process.env.PATH`), so a command that prefixes
`PATH="$HOME/go-toolchain/go/bin:$PATH"` lets the engine's subprocess find it. This
unblocks Phase 2's Go live-validation and Phase 4's Hunt 6 vlebo execution, both of
which the absent toolchain would otherwise have gated.

## Spend cap

**$1.71** total Anthropic, the ceiling every prior run in this line held. The only paid
phase is the Phase 3 fresh mine (arbiter annotation, skippable under budget). Enforced
by the existing `CostLedger`; per-phase spend recorded in the evidence report.

## Phase 2 scope, decided at baseline (soundness-gated)

The two restoration engines share the runner-execution seam, but their portability
differs and the standing rule is "carries its full control set or it does not ship":

- **test-tamper (`test-restoration.ts`): portable.** Its controls (base-passes,
  tampered-passes, restored-fails-twice-same-identity, the re-specification refuter)
  all run through the runner seam and are language-neutral. Ships for pytest and Go.
- **no-op-fix (`no-op-fix-restoration.ts`): not portable this run.** Control 3
  (changed-line coverage) is implemented only against Istanbul JSON (jest/vitest/mocha
  via `coverage-delta.ts`); pytest (coverage.py) and Go (go cover) have no parser. Go
  additionally has no import-graph closure for affected-test selection
  (`test-import-closure` covers TS/JS and Python, not Go). Porting coverage.py and
  go-cover parsers is the bounded-but-separate work the run must not become, so no-op-fix
  keeps its fail-closed abstain on non-TS. Recorded as a deviation with its exact reason.
- **Elixir (nx#1685):** needs a mix provisioner and an ExUnit identity parser, plus the
  same missing coverage/closure. Out of bounded scope; the exclusion is recorded, not
  built.

## Halt conditions armed

Spend cap; any fold without an approved-ids list; any model verdict creating or
destroying a corpus entry; a proven trigger on a clean fixture or honest control; any
control/threshold/bar change while generalizing an engine; detection logic reading an
unfrozen candidate before Hunt 6's freeze; the Elixir provisioner exceeding bounded
scope; a failed probe on a dependent phase. None tripped at baseline.
