# Tool-limitations resolution evidence — 2026-05-09

Resolves the 9 unresolved tool limitations enumerated in the session-end audit
on `feat/adapter-reintegration-v8`. Numbered #1–#7, #9, #10 (the #8 entry was
a numbering skip, not a missing item — confirmed by user).

## Summary

| #   | Item                                              | Fix landed                                             | Evidence                                  |
| --- | ------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| 1   | No pre-apply baseline predicate check             | `checkPredicateBaseline` short-circuits the falsifier  | unit test + snapshot baseline runs        |
| 2   | Gate workspace re-entrant against own evidence    | Pinned snapshot at `a7e5455` (v8.0.1)                  | `git archive a7e5455` is evidence-free    |
| 3   | CodexFalsifier truncates stderr at 1024 bytes     | Full stderr attached to `Error.cause`                  | unit test asserts 4 KB preserved          |
| 4   | Dev-gate has no checkpoint or resume              | `--start-from`, `--skip`, `--resume` + progress file   | help text + new flag plumbing             |
| 5   | Cost dollars conflate flat-rate and per-token     | `authMethod` enum + `dollarsBilled`/`dollarsTokenEst.` | unit tests for chatgpt vs api auth        |
| 6   | Six pre-existing test failures on v8.0.1 main     | Real bugs fixed; macOS realpath wrapped at test setup  | `npm test` → 0 failing (was 6)            |
| 7   | Self-gate test-coverage failure                   | Tests for `run-wrapper.ts` and `env-loader.ts`         | `gates .` → `test-coverage: 0 issue(s)`   |
| 9   | `eval()` doc string trips A1's predicate          | Subsumed by #2 — pinned snapshot is evidence-free      | A1 baseline passes against v8.0.1         |
| 10  | No CI canary against codex CLI                    | `.github/workflows/codex-canary.yml` weekly + dispatch | workflow file + risk-register pointer     |

## Per-item evidence

### #1 — baseline predicate check

Before any candidate is applied, the codex adapter now runs
`checkPredicateBaseline(predicate, workspaceRoot)`. If the predicate already
fails (exit ≠ 0), the falsifier returns
`no-falsification-found / baseline-predicate-failed` with zero spend and
**does not invoke codex**. New `NoFalsificationReason` variant
`'baseline-predicate-failed'` and `setup-skipped` row tag in dev-gate
summaries make this visible to operators.

- Code: `src/falsification/adapters/codex/predicate-runner.ts:104–125`,
  `src/falsification/adapters/codex/codex-falsifier.ts:130–162`.
- Unit test: `test/falsification/adapters/codex/codex-falsifier.unit.test.ts`
  → `returns baseline-predicate-failed without invoking codex when workspace is pre-tainted`.
- Unit test: `test/falsification/adapters/codex/predicate-runner.test.ts`
  → `preserves the baseline contract: predicate must pass against an unmodified workspace`.

### #2 — pinned snapshot SHA

`scripts/phase1-dev-gate/run-gate.ts` snapshots from `a7e5455` (v8.0.1 tag) by
default. That SHA pre-dates the `evidence/phase1-dev-gate/` subtree, so the
gate workspace is no longer re-entrant against its own committed evidence
(which contaminated A2/A3/A8/C5 in `run-1-aborted/`).

- Default SHA in `scripts/phase1-dev-gate/run-gate.ts:64`.
- `evidence/phase1-dev-gate/sample-obligations.json` fixture note updated.
- Verified live: `git archive a7e5455 | tar -t | grep phase1-dev-gate` returns
  nothing; `grep -rln 'XXX_FORBIDDEN_TOKEN_PHASE1_GATE'` against the extracted
  snapshot returns nothing.
- `--snapshot-sha <sha>` flag is supported for future obligations that need a
  custom tree.

### #3 — full stderr on Error.cause

The codex falsifier still puts `truncate(stderr, 1024)` in the user-facing
error message (so operator-visible logs stay readable) but now attaches the
full stderr to `Error.cause` for test/audit harnesses.

- Code: `src/falsification/adapters/codex/codex-falsifier.ts:192–204`.
- Unit test: `test/falsification/adapters/codex/codex-falsifier.unit.test.ts`
  → `preserves full stderr on Error.cause when codex exits non-zero` (asserts
  4 KB stderr is preserved verbatim).

### #4 — checkpoint and resume

New CLI flags on `run-gate.ts`:
- `--start-from <id>` — skip until `<id>` is reached
- `--skip <id1,id2,...>` — comma-separated skip list
- `--resume` — re-enter an existing `run-N/`, replaying the
  `runtime-progress.json` it wrote after each obligation

Progress is written via atomic rename (`runtime-progress.json.tmp` → final
name) so crashes mid-write don't corrupt state. The runner refuses to
`--resume` across mismatched snapshot SHAs to keep cross-obligation
comparisons valid.

- Code: `scripts/phase1-dev-gate/run-gate.ts:84–134` (parseFlags),
  `:191–204` (writeProgress), `:368–407` (resume gate).
- Help text shows the new flags:
  `Usage: ... [--snapshot-sha SHA] [--start-from ID] [--skip ID1,ID2,...] [--resume]`.

### #5 — cost-attribution auth-method awareness

`AdapterCostRecord` (and `AdapterCostAggregate`) gained three fields:
- `authMethod: 'chatgpt' | 'api' | 'unknown'`
- `dollarsBilled` — real charge to the operator's account (0 under
  flat-rate ChatGPT auth)
- `dollarsTokenEstimate` — upper bound from token counts × rate card

`dollarsSpent` is preserved as an alias for `dollarsTokenEstimate` so
existing consumers see no breaking change. Auth method is detected via
`codex login status` (cached per process) with a test seam
`authMethodOverride`. Aggregated columns appear in
`summary.tsv`/`summary.md` (`$billed`, `$tokenEst`, `auth`).

- Schema: `src/falsification/adapters/types.ts:108–186`.
- Detection: `src/falsification/adapters/codex/codex-cost.ts:80–124`.
- Wiring: `src/falsification/adapters/codex/codex-falsifier.ts:215–227`.
- Unit tests: `test/falsification/adapters/codex/codex-falsifier.unit.test.ts`
  → `reports dollarsBilled=0 under chatgpt auth but populates dollarsTokenEstimate`,
  `reports dollarsBilled === dollarsTokenEstimate under api auth`.

### #6 — pre-existing test failures (6 → 0)

Three real-bug categories addressed:

1. **Differential-gate scope-fallback** (2 tests). Root cause: on macOS,
   `os.tmpdir()` returns `/var/folders/...` but Node stack traces contain
   `/private/var/folders/...` (symlink resolution). `path.relative` between
   the two produces a `../`-prefix that the location extractor filters out,
   so `commandFinding()` fell through to `summaryFinding()`.
   Fix: realpath both ends in `extractSourceLocations()`
   (`src/verification/source-locations.ts:14–60`).

2. **pytest --slow option collision** (1 test). Root cause: pytest 8.x
   `--ignore` ignores absolute paths but honors relative paths (this is
   undocumented behaviour we proved with a controlled probe). The verifier
   was passing absolute paths.
   Fix: pass relative paths `--ignore=runs --ignore=.swarm`
   (`src/verifier/outcome-checks.ts:347–360`).

3. **macOS realpath in tmpdir** (3 tests in `worktree-manager` and
   `plan-files`). Same root cause as the differential-gate bug. Fix: wrap
   the `mkdtempSync` in `fs.realpathSync` at test setup so all subsequent
   path-equality assertions use the canonical form.

Final test counts:
```
2039 passing (56s)
9 pending
0 failing
```
(Was: 1970 passing, 8 pending, 6 failing on v8.0.1; 2002 passing, 9 pending,
6 failing on this branch pre-fix.)

### #7 — self-gate test-coverage finding cleared

Added two new test files:
- `test/cli/v8/run-wrapper.test.ts` — covers `splitArgv`,
  `findLatestContractDir`, `requireValue`, and `handleRunV8` (happy path,
  missing `--goal`, compile failure, missing contract dir). The wrapper
  gained an optional `RunV8Deps` injection seam so tests can substitute
  fakes without spawning real handlers.
- `test/env-loader.test.ts` — covers `parseDotenvFile` (bare, quoted,
  `export`, comments, no-overwrite invariant) and `loadDotenv` (cwd
  precedence, orchestrator fallback, no double-load). Added because
  removing the run-wrapper finding exposed `env-loader.ts` next.

Self-gate confirmation:
```
$ node dist/src/cli.js gates .
...
   ✅ test-coverage: 0 issue(s)
```
Gate exits 0. Remaining non-fatal findings (duplicate-blocks on codex
stderr evidence files, npm audit on `fast-uri` transitive dep) are unrelated
to the 10-item list.

### #9 — eval() doc-string footgun

Subsumed by #2: pinning the snapshot to `a7e5455` makes the workspace
evidence-free, and the contract-extractor doc string lives outside
`src/falsification`, so A1's predicate
(`! grep -rn 'eval(' src/falsification --include='*.ts'`) passes cleanly.
Verified live:

```
$ ( cd /tmp/v8-snapshot-verify && ! grep -rn 'eval(' src/falsification --include='*.ts' )
A1 baseline: PASS (no eval() in src/falsification)
```

The `eval()` literal in `src/contract/extractor/anthropic-extractor.ts:179`
remains as documentation for the prompt's own example list — that is the
intended behaviour, and it is now decoupled from the gate's predicate
target by the snapshot pinning.

### #10 — codex CLI canary

`.github/workflows/codex-canary.yml` runs the env-gated
`codex-falsifier.integration.test.ts` against the unpinned
`@openai/codex` CLI:

- Schedule: weekly Monday 09:00 UTC (`cron: '0 9 * * 1'`)
- Manual: `workflow_dispatch` for on-demand verification before Monday
- Env: `SWARM_E2E_CODEX=1` and `OPENAI_API_KEY` (fails fast with exit 78
  if the secret isn't set; manual maintainer action)
- On scheduled failure: opens a labelled issue
  (`adapter-drift`, `codex`) with a link to the failed run

Risk-register entry in `docs/adapter-integration.md:155` updated to point
at the implementation. CLAUDE.md "Where things live" gained a one-line
pointer.

## Reproduction

```bash
# 1. Type-check
npm run typecheck                                  # exit 0

# 2. Lint
npm run lint                                       # exit 0

# 3. Full test suite
npm test                                           # 2039 passing, 0 failing

# 4. Self-gate
node dist/src/cli.js gates .                       # test-coverage: 0 issues

# 5. Snapshot evidence-free check (item #2 + #9)
git archive a7e5455 | tar -t | grep -E 'phase1-dev-gate|XXX_FORBIDDEN'
# → empty (good)

# 6. Dev-gate runner CLI (item #4)
node dist/scripts/phase1-dev-gate/run-gate.js --help
# → shows --snapshot-sha, --start-from, --skip, --resume

# 7. Codex canary (item #10) — operator action
gh workflow run codex-canary.yml
gh run watch
```

## Out of scope

The npm-audit `fast-uri` finding flagged by `runtime-checks` is unrelated to
the 10-item list and not addressed here. The `duplicate-blocks` findings
against `evidence/phase1-dev-gate/run-1/*/codex-stderr.txt` are pure evidence
files (each codex invocation prints the same JSON schema in its prompt
preamble) and are not a code-quality issue. Both predate the resolutions
above and the self-gate exits 0 either way.
