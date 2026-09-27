# The coverage arm on Node 22

Until 2026-09-27 the changed-line coverage measurement was held to Node 24, because it spawns
node's test runner with `--test-isolation=process` and Node 22 rejects that spelling as a bad
option. The standalone verifier is advertised for Node 22, so the question was whether a sound
path exists there or the arm has to stay unmeasured. It exists from Node 22.8.

## What each runtime takes

Probed on 2026-09-27 by running node's test runner over a one-test fixture with each spelling
of the isolation flag, in the official `node:<version>-bookworm-slim` images through Docker
29.5.2 with the fixture mounted read-only, and on the Homebrew `node@22` build on the
development machine. "bad option" is the runtime's own refusal, printed verbatim; "1..1" is
the TAP plan the runner printed after running the one test.

| Runtime | `--test-isolation=process` | `--experimental-test-isolation=process` |
| --- | --- | --- |
| v22.0.0 | bad option | bad option |
| v22.7.0 | bad option | bad option |
| v22.8.0 | bad option | 1..1 |
| v22.22.3 (Homebrew and image) | bad option | 1..1 |
| v23.11.0 | 1..1 | 1..1 |
| v24.21.0 (image), v24.15.0 (development) | 1..1 | 1..1 |

The same fixture, installed from the packed 0.2.0-source tarball into an empty directory,
passes all eighteen cases of `scripts/verifier-matrix-smoke.mjs` on Node 24.15.0 and 22.22.3
(macOS) and on Node 22.0.0 (Linux container), the last with the coverage arm reporting
unmeasured by name.

Node 22.8 introduced `--experimental-test-isolation`; process isolation was already the only
mode before it, so on 22.8 through 23 the flag names the default explicitly. Node 23.6 added
the stable spelling and 24 carries it. The harness picks by version: stable on 24 and newer,
experimental on 22.8 through 23, none below 22.8, and confirms the chosen spelling on the
vector it built before spawning it (`src/node-floor.ts`, `src/gates/node-test-command.ts`).

## The measurement itself, on Node 22.22.3

`node --test --experimental-test-coverage --experimental-test-isolation=process` with the TAP
reporter on stdout and the lcov reporter on stderr, over the fixture, exits 0 and writes an
lcov report with `SF`, `LF`, `LH` and `end_of_record` for both files.

Then the whole command, under the Homebrew Node 22.22.3 with nothing else on `PATH` ahead of
it: `swarm-verify check` over the same fixture with one source file changed (a branch added to
`double`), `--json`. The report is
[check-node22-dirty.json](../evidence/2026-09-27/verifier-first/check-node22-dirty.json). In
its bundle, session `20260927T191208-06cd7b`:

- the tests gate-run record `sha256:6c278afb8bb22f7156da81ff4e2b4417d04fd2335b22bda86435074d208d65af`
  carries the spawned vector `node --test --experimental-test-coverage
  --experimental-test-isolation=process --test-reporter=tap --test-reporter-destination=stdout
  --test-reporter=lcov --test-reporter-destination=stderr`, `coverageUnmeasured: null`, and
  the parsed outcome 1 collected, 1 passed;
- the ratchet decision record `sha256:7e950afb03d6dfb25895b71bc0cea61caf9446584de9eadc3ff3c71bafb3170c`
  measures `changedLineCoverage: 1` after the change, read from the lcov the harness captured
  off the runner's stderr, against `null` before it (the base had no change to measure).

So on Node 22.22.3 the arm measured the changed lines rather than abstaining. The session
bundle stays in the development machine's session store; the JSON report above and the two
digests are what this note binds to.

## What changed in the tree

- `src/node-floor.ts`: the floor is 22.8, and `processIsolationFlag` returns the spelling for
  a version or null.
- `src/gates/node-test-command.ts`: the read-back accepts either spelling, only where the
  harness itself supplied it, and still refuses a project-declared isolation flag.
- `src/gates/harness-reporting.ts`, `src/gates/node-gates.ts`, `src/gates/oracle-instrumentation.ts`,
  `src/gates/base-control.ts`, `src/gates/contract-executor.ts`: each spawn site asks for the
  version's spelling and abstains below the floor instead of spawning a flag the runtime rejects.
  Two of those sites (`base-control.ts`, `contract-executor.ts`) had no floor check at all before.
- `src/install/health.ts` and the documents name the 22.8 floor.

## What is unchanged

Below 22.8 the arm reports `unmeasured` with the reason named and the ratchet cannot compare
it, exactly as before. Nothing here promotes an unavailable measurement, and the vitest and
pytest runners still carry no coverage authority on any Node.
