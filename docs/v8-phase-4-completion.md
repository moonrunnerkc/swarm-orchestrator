# Phase 4 Completion Report

**Phase status:** CLOSED 2026-05-08
**Self-review completed:** 2026-05-08
**Branch:** v8-dev (unmerged from main per §12; v8 stays on v8-dev
through Phase 6)

## §13 Definition of Done: three conditions

### Condition 1: all exit criteria for the phase are met

§7 lists three exit criteria. Each is satisfied below with direct
evidence.

(a) "A run that completes 5 obligations, gets killed mid-6th, can be
resumed and finish without redoing work."

The integration test
`test/integration/v8-resume.test.ts` builds an 8-obligation contract
(6 file-must-exist + build-must-pass + test-must-pass), runs it with
`--max-obligations 5` to simulate a kill after the 5th obligation,
then invokes `swarm v8 resume` against the same ledger. The
assertions:

- `r2.memoizedObligations === 5` — five prior-satisfied obligations
  are memoized via `obligation-memoized` ledger entries.
- `r2.memoizedObligations + r2.outcomes.length === contract.obligations.length`
  — the resumed run's outcomes plus the memoized skips cover the
  whole contract.
- `r2.failed === 0` — no obligations regress on resume.
- `verifyChainAt(ledgerPath)` succeeds after the resume —
  hash-chain integrity persists across runs in the same ledger
  file.
- The ledger's entry-type histogram includes `run-resumed` and
  exactly five `obligation-memoized` entries.

(b) "Memoization measurably reduces cost on a goal that contains
repeated obligation patterns (e.g., 'add health checks to 4
services' should share work)."

The Phase 4 cost-and-accuracy benchmark
(`scripts/v8-bench/run-phase4.ts`) runs three repeated-pattern goals
through the population manager twice — once without a `MemoStore`
(baseline) and once with one (memoized) — and reports verifier-call
savings plus effective-input token reduction. Latest run:

```
[bench4] health-checks-3 (5 oblig): baseline saves=10 memo saves=12 extra=2 cost-ratio=1.068× (>1 means memo cheaper)
[bench4] health-checks-4 (6 oblig): baseline saves=12 memo saves=15 extra=3 cost-ratio=1.093× (>1 means memo cheaper)
[bench4] health-checks-6 (8 oblig): baseline saves=16 memo saves=21 extra=5 cost-ratio=1.131× (>1 means memo cheaper)
[bench4] verifier-savings >0 every goal: PASS
[bench4] effective-input strictly lower every goal: PASS
[bench4] every memoized run satisfied 100% of obligations: PASS
```

The savings scale with the repetition count: 2 → 3 → 5 extra
verifier calls saved as the file-must-exist count grows from 3 to
4 to 6. The 4-service goal — the literal §7 example — saves 3
extra verifier calls beyond baseline plus ~33K effective input
tokens (8.5%).

The benchmark report lives at `docs/v8-phase-4-benchmark.md` and is
regenerable on demand. The CI gate runs in
`test/benchmarks/v8-phase4-bench.test.ts` (3 tests) and refuses to
ship Phase 4 if any goal's memoized run fails to strictly improve on
both verifier savings and effective input.

(c) "Ledger tamper detection passes: a manually edited ledger entry
is detected and run aborts."

`test/ledger/hash-chain.test.ts` covers four tamper modes, each
asserting that `verifyChainAt` (or the
`HashChainedLedger` constructor on resume) throws
`ChainTamperedError`:

- **edited payload**: a goal-string field gets rewritten on disk; the
  recomputed entry hash diverges from the stored one
  (`kind: 'entry-hash-mismatch'`).
- **removed entry**: the first entry is dropped; the second entry's
  `prevHash` no longer chains from the genesis digest
  (`kind: 'prev-hash-mismatch'`).
- **reordered entries**: two entries are swapped; the chain breaks at
  the new front of the file.
- **stripped entry hash**: the `entryHash` field is removed from a
  line; the verifier rejects with `kind: 'malformed-header'`.

The integration test
`test/integration/v8-resume.test.ts` ("aborts when the ledger chain
is tampered") covers the end-to-end case: a tampered ledger is fed
to `swarm v8 resume`, which exits with code 4 (the dedicated
tamper exit code declared in `resume-handler.ts`) and the resume
never invokes the population manager.

### Condition 2: documentation is updated

- README: Phase 4 ships `swarm v8 resume <run-id>` as an opt-in
  v8-dev surface; v8 itself is not yet user-facing on main per §12.
  The README block lands in the phase that crosses the v8-default
  cutover (post-Phase 6 per §12). §13's clause is "(when shipped)";
  Phase 4 is not yet that phase.
- Per-module JSDoc: every public function in
  `src/ledger/ledger.ts`, `src/ledger/memoization.ts`,
  `src/ledger/resume.ts`, `src/cli/v8/resume-handler.ts`, and the
  new ledger entry types in `src/ledger/types.ts` carries JSDoc per
  impl guide §1 ("Full JSDoc on all public functions").
- Architecture deviations: `docs/v8-architecture-deviations.md`
  updated with three Phase 4 deviations (IRONROOT primitive
  in-tree replication; in-tournament dedup is implicit, not gated
  on `memoStore`; resume default-discovery is repo-relative).
- Benchmark report: `docs/v8-phase-4-benchmark.md` (auto-generated
  from `dist/scripts/v8-bench/run-phase4.js`, regenerable on
  demand).
- Benchmark history: `docs/benchmarks/v8-history.jsonl` extended
  with `phase4-memoization` (one row per goal) and `phase4-summary`
  rows.

### Condition 3: CI is green on v8-dev

Local-darwin:
- `npm run build`: success.
- `npm run typecheck`: success.
- `npm run lint`: success (0 errors, 0 warnings).
- `npx mocha 'dist/test/contract/**/*.test.js' 'dist/test/session/**/*.test.js' 'dist/test/persona/**/*.test.js' 'dist/test/ledger/**/*.test.js' 'dist/test/verification/run-verifier.test.js' 'dist/test/population/**/*.test.js' 'dist/test/integration/v8-*.test.js' 'dist/test/benchmarks/v8-bench.test.js' 'dist/test/benchmarks/v8-phase3-bench.test.js' 'dist/test/benchmarks/v8-phase4-bench.test.js'`:
  **246 passing**, 0 failing.
- Full `npx mocha --recursive 'dist/test/**/*.test.js'`:
  **1772 passing**, 6 failing, 8 pending. The 6 failures are the
  same pre-existing macOS-baseline issues documented in
  `docs/v8-phase-0-completion.md`, `docs/v8-phase-1-completion.md`,
  `docs/v8-phase-2-completion.md`, and
  `docs/v8-phase-3-completion.md` (3 macOS path-symlink, 1 stale
  pytest conftest, 2 local-toolchain). Linux CI does not reproduce
  them. Phase 4 added **43 new tests** (1772 − 1729 from Phase 3).

Linux CI: `.github/workflows/v8-ci.yml` jobs (`lint`, `typecheck`,
`test`) run unchanged from Phase 0. The `test` job picks up the
new Phase 4 tests via the existing `dist/test/**/*.test.js` glob.

## What landed

### Production source

- `src/ledger/ledger.ts` — Phase 4 deliverable per §7.
  `HashChainedLedger`, `verifyChainAt`, `verifyChainEntries`,
  `ChainTamperedError`, `canonicalJson`, `computeEntryHash`,
  `GENESIS_PREV_HASH`. Each appended entry now carries `prevHash`
  (the prior entry's `entryHash`, or 64 hex zeros for the genesis)
  and `entryHash` (sha256 of the canonical JSON form of the entry
  with `entryHash` excluded). Verification walks the file from disk
  and rejects on the first divergence with a 1-indexed line number
  and a kind tag.
- `src/ledger/memoization.ts` — Phase 4 deliverable per §7.
  `MemoStore` indexes prior tournament winners by response sha256
  per obligation type; `priorSatisfiedIndexes` /
  `priorFailedIndexes` summarize prior-run obligation status by
  contract hash; `obligationKey` computes a stable key for any
  obligation. Both in-run (cross-obligation) and cross-run (resume)
  memoization paths share this module.
- `src/ledger/resume.ts` — Phase 4 deliverable per §7.
  `deriveResumeState` reads a ledger entry list and returns the
  set of satisfied/failed/pending obligation indexes for a given
  contract; `memoizedEntriesForResume` builds the
  `obligation-memoized` ledger entries the population manager
  emits at the start of a resumed run.
- `src/ledger/jsonl-ledger.ts` — re-exports `HashChainedLedger as
  JsonlLedger` so Phase 2/3 call sites continue to import the same
  symbol with hash-chain semantics now baked in.
- `src/ledger/index.ts` — barrel updated with the new public
  surface (HashChainedLedger, ChainTamperedError, MemoStore,
  deriveResumeState, ResumeError, plus the new entry types).
- `src/ledger/types.ts` — `LedgerEntryHeader` extended with
  `prevHash` and `entryHash` chain fields. Two new entry types:
  `RunResumedEntry` and `ObligationMemoizedEntry`.
- `src/population/manager.ts` — extended with
  `skipObligationIndexes` (a `ReadonlySet<number>` the resume path
  uses to short-circuit prior-satisfied obligations) and
  `memoStore` (a `MemoStore` the manager passes down to each
  tournament). Returns extra fields on `RunPopulationResult`:
  `memoizedObligations` and `verifierCallsSavedByMemoization`.
- `src/population/tournament.ts` — extended with `memoStore` on
  `RunTournamentOptions`. Pre-populates `verdictByHash` from prior
  tournament winners; in-round dedup is implicit (always-on); both
  paths feed the `verifierCallsSavedByMemoization` counter on the
  returned `TournamentResult`.
- `src/cli/v8/resume-handler.ts` — Phase 4 deliverable per §7.
  Implements `swarm v8 resume <run-id>`: verifies the chain,
  derives resume state, infers the contract directory when
  unspecified, writes a `run-resumed` marker, and dispatches the
  population manager with `skipObligationIndexes` pre-set.
- `src/cli/v8/index.ts` — `resume` subcommand wired up; the Phase
  3 stub error handler is gone.
- `src/cli/v8/run-handler.ts` — result file extended with
  memoization fields (`memoizedObligations`,
  `verifierCallsSavedByMemoization`, plus per-tournament savings).

### Bench harness (under scripts/v8-bench/)

- `scripts/v8-bench/repeated-pattern-goals.ts` — 3-goal
  repeated-pattern suite (3, 4, 6 services). The 4-service goal is
  the literal §7 example.
- `scripts/v8-bench/run-repeated-pattern.ts` — single-goal runner
  that drives the population manager twice (baseline / memoized)
  and reports per-run verifier savings + effective-input tokens.
- `scripts/v8-bench/run-phase4.ts` — Phase 4 §7 benchmark CLI.
  Drives the suite, writes `docs/v8-phase-4-benchmark.md`, appends
  history rows to `docs/benchmarks/v8-history.jsonl`, and refuses
  (exit 1) when any goal fails the memoization strict-improvement
  gate.

### Tests (43 new)

- `test/ledger/hash-chain.test.ts` — `canonicalJson` determinism,
  `computeEntryHash` determinism, append + readAll, chain
  validity, and four tamper modes (edited payload, removed entry,
  reordered entries, stripped `entryHash`), plus the constructor's
  refuse-to-chain-onto-tampered-file path.
- `test/ledger/memoization.test.ts` — `obligationKey`,
  `MemoStore` indexing happy path, type-mismatch rejection,
  `ingestWinner` incremental update, `priorSatisfiedIndexes`
  contract-hash filtering, exclude-self, last-status-wins,
  obligation-memoized recognition, and `hitFromMemoized`.
- `test/ledger/resume.test.ts` — `deriveResumeState` happy paths,
  no-run-started rejection, no-obligations rejection, partial
  5-of-6 derivation, failed-vs-satisfied separation,
  `memoizedEntriesForResume` shape.
- `test/integration/v8-resume.test.ts` — end-to-end
  resume-after-kill against a fresh ledger, tamper-aborts-resume
  (exit 4), missing-run-id rejection, missing-ledger rejection.
- `test/integration/v8-memoization.test.ts` — repeated-pattern
  in-run memoization measurably reduces verifier calls; winner
  ingestion lets later identical-hash candidates inherit the
  verdict.
- `test/benchmarks/v8-phase4-bench.test.ts` — repeated-pattern
  suite shape, the §7 (b) memoization gate (strictly more savings
  than baseline + strictly lower effective input on every goal),
  and the saving-scales-with-repetition assertion.

### Build / config

- `tsconfig.build.json` — unchanged from Phase 3; the new bench
  scripts compile under the existing `scripts/v8-bench/**/*`
  include.

## Self-review findings

**BLOCKER findings:** none.

**NON-BLOCKER findings:**

- IRONROOT primitive is replicated in-tree rather than imported
  from the npm package. The pattern (sha256 of canonical JSON,
  prevHash + entryHash on every entry) is the same IRONROOT
  exposes; future swap is mechanical. Logged as Phase 4
  architecture deviation 1.

- In-tournament dedup (two same-hash candidates in a single round
  share one verifier call) is implicit and active even when no
  `MemoStore` is supplied. The §7 spec language is "If two
  candidates are diff-identical, the second is a free skip" — the
  implementation honors that as a property of the tournament
  harness, not an opt-in feature. Logged as Phase 4 architecture
  deviation 2; the Phase 4 benchmark accounts for it by comparing
  baseline (in-round only) against memoized (in-round +
  cross-obligation), so the §7 gate measures the *delta* memoization
  contributes.

- Resume's contract-directory inference walks the ledger backward
  for a `run-started` and tries
  `<repo>/.swarm/contracts/<contractId>/`. If the user wrote the
  contract elsewhere, the inference fails and `--contract <dir>`
  is required. Logged as Phase 4 architecture deviation 3; opt-out
  via the explicit flag.

- Real-API cost benchmark replication (Phase 2 NON-BLOCKER 1
  carry-over) remains a Phase 2 / Phase 3 / Phase 4 follow-up.
  Phase 4's memoization claim is a structural one (verifier-call
  count) that holds regardless of token costs, but a real-API
  replication would tighten the effective-input savings claim.

- `discoverRepoContext` in the contract compiler still
  reimplements a small subset of `src/test-command-discovery.ts`
  (carry-over from Phase 1's NON-BLOCKER list). Phase 4 did not
  resolve this; the resume path doesn't yet need richer repo
  context. Target: Phase 5 transition; revisit when WASM
  deterministic obligations need project-shape probing.

- Local-darwin baseline carries the same 6 pre-existing test
  failures unrelated to v8 work (carry-over from Phase 0). Linux
  CI unaffected. Target: separate cleanup PR on main, not gated
  to any v8 phase.

## Phase 4 commit log (target)

```
feat(v8): hash-chained ledger with tamper detection (Phase 4)
feat(v8): memoization layer indexing prior tournament winners (Phase 4)
feat(v8): resume helper deriving population state from ledger (Phase 4)
feat(v8): swarm v8 resume CLI with chain verification + state recovery (Phase 4)
feat(v8): in-run cross-obligation memoization in tournament harness (Phase 4)
test(v8): 40 new tests across ledger/memoization/resume/integration/bench (Phase 4)
feat(v8-bench): Phase 4 memoization benchmark with repeated-pattern suite
docs(v8): Phase 4 completion + architecture deviations + benchmark report
```

## Notes for Phase 5

- Phase 5 (WASM deterministic floor) extends the contract schema
  with a `deterministic-strategy: <strategy-name>` tag. Phase 4
  memoization composes naturally: a deterministic obligation that
  emits the same bytes for two distinct contract obligations
  inherits the prior winner's verdict via `MemoStore`, just like
  the synthesis path does. No Phase 4 surface needs to move.
- WASM module failures route obligations back to synthesis; the
  resume / memoization plumbing already handles this case
  (the obligation re-attempts as if it were never tagged
  deterministic).
- The IRONROOT npm-package swap can land in Phase 5 as a separate
  refactor: replace `src/ledger/ledger.ts`'s sha256 helpers with
  the IRONROOT primitives without touching anything that imports
  `HashChainedLedger`. The deviation entry stays open until the
  swap lands.
- Cross-run memoization (resume) is bounded by contract identity:
  re-running the same contract against a different repository tree
  silently shortcuts obligations whose effects depend on the
  workspace state. The current ledger captures the contract hash;
  Phase 5 should consider whether to also fingerprint the
  workspace at run start to detect "same contract, different
  starting state."
