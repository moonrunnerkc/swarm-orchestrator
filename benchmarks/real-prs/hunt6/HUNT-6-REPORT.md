# Hunt 6: the polyglot engine, and the barrier that moved

The first hunt run after the test-tamper restoration engine was generalized to pytest
and Go. Pre-registered before any run artifact (`PREREGISTRATION.md`, commit `3f266360`,
before this report). The result is a pre-registered zero, and the value is the deepest
autopsy this project has written: it names the exact next barrier, by file and line.

## Result

**Proven: 0 of 2 primary entries.** As pre-registered. Both audits ran on the frozen
pinned head SHAs through the live `swarm audit --pr` path (Go toolchain on PATH); records
under `benchmarks/real-prs/hunt6/records/`, funnel in `hunt6-summary.json`.

| entry | ecosystem | complaint | EG engines executed | advisory | proven |
|---|---|---|---|---|---|
| vlebo/ctx#24 | Go | error-swallow | 0 | 0 | no |
| elixir-nx/nx#1685 | Elixir | test-relaxation | 0 | 3 no-op-fix (advisory) | no |

## The barrier moved: engine → pipeline front-end

Hunt 5's barrier was the engine: the restoration proofs could not execute a non-Node
suite, so pytest/Go entries hit `runner-unsupported`. That barrier is gone: the
test-tamper engine now executes pytest and Go, fixture-validated (planted tampers prove
with full controls green, clean controls refute, 4/4,
`benchmarks/oracle-corpus/POLYGLOT-RESTORATION-REPORT.md`).

But both folded entries still abstain, and the empirical reason is the same for both and
sits **upstream of the engine**: `swarm audit` bails at the execution-grounded entry
gate with "no mutable source lines in diff", **0 engines executed, no workspace
provisioned**. The gate is `mutableSourceFilter` (`src/audit/execution-grounded/index.ts:81`):

```
const MUTABLE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;   // .js/.jsx/.ts/.tsx/.cjs/.mjs/.cts/.mts only
```

A Go, Elixir, or Python diff has no file matching that pattern, so the pipeline bails
before it ever reaches the (now polyglot) restoration engine. The engine is generalized;
the pipeline's candidate front-end that feeds it, the entry gate and the JS/TS structural
detectors, is not. The barrier moved from "the engine cannot execute non-Node" (Hunt 5)
to "the pipeline front-end does not admit non-JS/TS diffs to the now-capable engine"
(Hunt 6).

## Per-entry autopsy

**vlebo/ctx#24 (Go, error-swallow).** Two barriers, both upstream of the runner
generalization. (1) Category: error-swallow has no restoration proof at all (the
restoration categories are assertion-strip, test-relaxation, coverage-erosion), and the
PR adds tests rather than tampering one, so no test-tamper candidate would arise even if
the pipeline admitted the diff. (2) Entry gate: `mutableSourceFilter` sees no `.js/.ts`
file among the `.go` changes, so execution-grounded bails before provisioning. The Go
toolchain being installed and the engine being Go-capable changed nothing here, because
the diff never reaches either.

**elixir-nx/nx#1685 (Elixir, test-relaxation).** test-relaxation does have a restoration
proof, but the entry gate bails on the `.ex/.exs` diff for the same reason, and Elixir
additionally has no provisioner (recorded exclusion). The 3 advisory no-op-fix findings
are advisory-only (not a proven trigger) and do not change the 0.

## What this run delivered, stated precisely

- **The restoration engine is polyglot and sound** for pytest and Go: validated live on
  planted fixtures, every control travels, the TS path byte-identical. This is real: a
  Go or pytest test-tamper handed to `runTestRestoration` directly is proven with full
  controls green.
- **The audit pipeline does not yet route non-JS/TS wild cheats to it.** The next build
  is named exactly: generalize `mutableSourceFilter` and the structural cheat detectors
  (which produce the restoration candidates) to `.go`/`.py`, carrying the mutation and
  coverage stages' non-Node handling with them (or having those stages abstain fail-closed
  on non-Node). That was deliberately out of scope this run (it would change the JS/TS
  entry gate's behavior and pull in the unported mutation/coverage front-end), and it is
  the precise, bounded next step.

No stop-the-line (no proof to scrutinize). No `proven-not-replayed`. No control,
threshold, or bar was changed.

## Secondary set (the 27)

Not re-run; Hunt 4 is the record over the proof-executable slice (0 of 7).
`outline/outline#12197` remains spent. Hunt 6's primary set is the 2 folded entries only,
kept separate, as pre-registered.

## Bounds and deviations

- n is 2; 0 reached an engine. A zero over 2, reported with the barrier per entry.
- Deviation 1: no new entry was folded this session (Phase 3 halted for maintainer review
  with 0 clean cheats), so the primary set is unchanged from Hunt 5; Hunt 6's novelty is
  the engine-runner matrix and the empirical barrier location, not the entries.
- Deviation 2: the Go toolchain is user-local (`~/go-toolchain`, go1.26.5), on PATH for
  the audit subprocess via the sandbox's ambient-PATH passthrough. It changed nothing
  observably, because the pipeline bailed before provisioning; recorded for honesty.

## Reproduce

```sh
npm run build
PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/src/cli.js audit --pr vlebo/ctx#24 --output json
node dist/src/cli.js audit --pr elixir-nx/nx#1685 --output json
```
