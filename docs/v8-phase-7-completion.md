# Phase 7 Completion Report

**Phase status:** CLOSED 2026-05-08 (milestone for v8.0 release;
Phase 7 itself is ongoing per impl guide §10)
**Self-review completed:** 2026-05-08
**Branch:** v8-dev

Phase 7 (impl guide §10) is open-ended: "Iterative expansion of
personas and contract obligation types based on real-world usage."
The §10 milestone gate for v8.0 release is "at least 7 personas in
the library and at least 8 contract obligation types". This phase
delivers both gates plus end-to-end verifiable evidence that every
new piece is wired through the population manager.

## §13 Definition of Done: three conditions

### Condition 1: all exit criteria for the phase are met

§10 names two exit gates for "Phase 7 complete enough for v8.0
release":

(a) "at least 7 personas in the library"

The default registry now exposes **8** personas (impl guide §10
priority list, items 1–5 plus the Phase 2 baseline trio):

```
architect (file-must-exist) — Phase 2
implementer (build-must-pass) — Phase 2
verifier (test-must-pass) — Phase 2
security-reviewer (property-must-hold) — Phase 7
dependency-auditor (import-graph-must-satisfy) — Phase 7
documentation-writer (function-must-have-signature) — Phase 7
migration-specialist (performance-must-not-regress) — Phase 7
test-author (coverage-must-exceed) — Phase 7
```

Source: `src/persona/persona-registry.ts`. The
`createDefaultRegistry()` factory wires all eight, exported via
`DEFAULT_PERSONA_IDS`.

The CI gate `test/benchmarks/v8-phase7-bench.test.ts` ("default
registry exposes at least 7 personas (§10)") asserts this directly.

(b) "at least 8 contract obligation types"

The v1 `OBLIGATION_TYPES` tuple now has **8** entries, with the
Phase 1 ordering preserved so contract hashes from earlier phases
remain stable:

```
file-must-exist                — Phase 1
build-must-pass                — Phase 1
test-must-pass                 — Phase 1
function-must-have-signature   — Phase 7 (impl guide §10 item 1)
property-must-hold             — Phase 7 (impl guide §10 item 2)
import-graph-must-satisfy      — Phase 7 (impl guide §10 item 3)
coverage-must-exceed           — Phase 7 (impl guide §10 item 4)
performance-must-not-regress   — Phase 7 (impl guide §10 item 5)
```

Source: `src/contract/types.ts`, `src/contract/schema/v1.json`.
Every new type lands with:
- a typed branch in the `ObligationV1` discriminated union
- a `oneOf` schema branch with required-field constraints
- a validator branch with a dedicated duplicate-detection code
- a canonicalSort + canonicalSerialize branch (stable property order)
- a memoization-key branch (`obligationKey`)
- a tournament-config default
- a `renderDynamicMessage` persona prompt
- a `verifyObligation` switch arm with a verifiable on-disk check

The CI gate `test/benchmarks/v8-phase7-bench.test.ts` ("contract
schema declares at least 8 obligation types (§10)") asserts this
directly.

(c) Phase 7 milestone benchmark gate (`scripts/v8-bench/run-phase7.ts`)

§10 is open-ended; this phase adds a **§10 milestone benchmark**
that drives every Phase 7 obligation type end-to-end against a
`StubSession` and reports four boolean ship gates:

```
[bench7] personaCount=8 obligationTypeCount=8 happy.failed=0 failure.failed=5 (expected 5)
[bench7] personas >= 7: PASS
[bench7] obligation types >= 8: PASS
[bench7] dispatch correct: PASS
[bench7] failure suite catches every new type: PASS
```

The benchmark report (`docs/v8-phase-7-benchmark.md`) is
auto-generated and regenerable. The history row appended to
`docs/benchmarks/v8-history.jsonl` (suite=`phase7-milestone`)
captures the gate booleans and the persona/type counts for
longitudinal tracking.

### Condition 2: documentation is updated

- README: deferred to the v8 cutover commit per Phase 6
  precedent (the README block for v8 lands in the phase that
  crosses the v8-default cutover, not in each phase that sits on
  v8-dev). Phase 7 does not change this stance.
- Per-module JSDoc: every new public export carries a JSDoc block
  per impl guide §1 ("Full JSDoc on all public functions"):
  - `src/contract/types.ts` — five new obligation interfaces with
    full field documentation
  - `src/contract/validator.ts` — extended doc and per-type
    validation comments
  - `src/contract/canonicalize.ts` — doc on the new `payloadValue`
    branches and per-type stable-stringify rules
  - `src/verification/run-verifier.ts` — doc on each new verifier
    branch (`verifyFunctionSignature`, `verifyImportGraph`,
    `verifyCoverage`, `verifyPerformance`)
  - `src/persona/persona-registry.ts` — doc per new persona spec
  - `src/ledger/memoization.ts` — doc on the extended `obligationKey`
- Architecture deviations: `docs/v8-architecture-deviations.md`
  updated with five Phase 7 deviations:
  1. function-must-have-signature uses substring match, not AST
  2. import-graph-must-satisfy uses regex, not module resolver
  3. each Phase 7 persona owns exactly one type, 1:1
  4. Anthropic extractor unchanged for Phase 7; new types are
     user-edited or stub-emitted
  5. tricky-bench responder routes by obligation type, not persona id
- Benchmark report: `docs/v8-phase-7-benchmark.md` (auto-generated
  from `dist/scripts/v8-bench/run-phase7.js`, regenerable on
  demand).
- Benchmark history: `docs/benchmarks/v8-history.jsonl` extended
  with one `phase7-milestone` row.

### Condition 3: CI is green on v8-dev

Local-darwin:
- `npm run build`: success.
- `npm run typecheck`: success (zero errors).
- `npm run lint`: success (0 errors, 0 warnings).
- v8 targeted suite (contract / persona / ledger / verification /
  population / wasm / integration:v8-* / benchmarks:v8-*):
  **392 passing**, 0 failing.
- Phase 7 added **41 new tests** on top of Phase 6's 1877:
  full `npx mocha --recursive 'dist/test/**/*.test.js'` reports
  **1918 passing**, 6 failing, 8 pending. The 6 failures are the
  same pre-existing macOS-baseline issues documented in Phase 0–6
  completion reports (3 macOS path-symlink, 1 stale pytest
  conftest, 2 local-toolchain). Linux CI does not reproduce them.

Linux CI: `.github/workflows/v8-ci.yml` jobs (`lint`, `typecheck`,
`test`) run unchanged from Phase 0. The `test` job picks up the
new Phase 7 tests via the existing `dist/test/**/*.test.js` glob.

## What landed

### Production source

- `src/contract/types.ts` — five new obligation interfaces:
  `FunctionMustHaveSignatureObligation`,
  `PropertyMustHoldObligation`,
  `ImportGraphMustSatisfyObligation`,
  `CoverageMustExceedObligation`,
  `PerformanceMustNotRegressObligation`. `ObligationV1` union
  extended; `OBLIGATION_TYPES` tuple grows from 3 to 8 (Phase 1
  ordering preserved).
- `src/contract/schema/v1.json` — five new `oneOf` branches with
  required-field constraints, `additionalProperties: false`, and the
  optional `deterministicStrategy` slot for Phase 5 forward-compat.
- `src/contract/validator.ts` — five new duplicate-detection codes
  (`duplicate-function-must-have-signature`,
  `duplicate-property-must-hold`,
  `duplicate-import-graph-must-satisfy`,
  `duplicate-coverage-must-exceed`,
  `duplicate-performance-must-not-regress`); switch refactored from
  if/else to exhaustive `switch` for compiler exhaustiveness.
- `src/contract/canonicalize.ts` — `payloadValue` and
  `stableStringifyObligation` extended with switch arms for every
  new type; stable property order preserved per type.
- `src/contract/index.ts` — barrel re-exports the five new types.
- `src/contract/approval.ts` — `formatObligation` extended to render
  every new type for the user-approval step.
- `src/ledger/memoization.ts` — `obligationKey` switches over every
  type with a deterministic, type-specific identity tuple. Used by
  resume + memoization paths.
- `src/ledger/resume.ts` — `keyForObligation` delegates to
  `obligationKey` to avoid drift across the two call sites.
- `src/verification/run-verifier.ts` — five new verifier
  implementations:
  - `verifyFunctionSignature`: whitespace-insensitive substring
    match (`<name><signature>`).
  - `verifyCommand` (existing) reused for `property-must-hold` with
    the obligation's `target` carried into the detail label.
  - `verifyImportGraph`: walks `.ts/.tsx/.js/.mjs/.cjs/.py` files
    under scope, parses imports with per-language regex, evaluates
    `no-upward-imports` and `no-cycles` constraints (DFS back-edge
    reconstruction).
  - `verifyCoverage`: reads `coverage-summary.json`-shaped JSON,
    looks up `total[metric].pct`, compares to threshold.
  - `verifyPerformance`: spawns the benchmark, takes the last
    numeric token of stdout as the current value, compares to
    `baseline.value` with the contract's fractional threshold.
- `src/persona/persona-registry.ts` — five new persona specs:
  `SECURITY_REVIEWER_PERSONA`, `DEPENDENCY_AUDITOR_PERSONA`,
  `DOCUMENTATION_WRITER_PERSONA`, `MIGRATION_SPECIALIST_PERSONA`,
  `TEST_AUTHOR_PERSONA`. `createDefaultRegistry()` wires all eight;
  `DEFAULT_PERSONA_IDS` lists all eight. Each persona's
  `systemSuffix` carries domain-specific constraints (security
  reviewer's least-privilege rule, dependency auditor's no-dynamic-
  require rule, documentation writer's preserve-bodies rule,
  migration specialist's never-tamper-with-baseline rule, test
  author's never-lower-threshold rule).
- `src/persona/index.ts` — barrel re-exports the five new persona
  consts.
- `src/population/tournament.ts` — `DEFAULT_TOURNAMENT_CONFIG`
  extended with five new entries (3 candidates / 3 rounds /
  threshold 0.5 for build-shaped types; 2 candidates for
  signature/import-graph/performance which converge faster).
- `src/population/manager.ts` — `renderDynamicMessage` switch
  refactored from if/else to exhaustive `switch` and extended with
  per-type prompt branches for every new type. Single-mode apply
  path now treats `responseText.trim() === 'no-op'` as a leave-the-
  workspace-alone signal across all types (matched the existing
  tournament-mode behaviour).

### Bench harness (under scripts/v8-bench/)

- `scripts/v8-bench/run-phase7.ts` — Phase 7 §10 milestone
  benchmark CLI. Runs a happy-path suite (workspace pre-populated;
  every persona's "no-op" reply suffices) and a failure suite (every
  Phase 7 obligation surfaces a verifiable failure). Writes
  `docs/v8-phase-7-benchmark.md`, appends a row to
  `docs/benchmarks/v8-history.jsonl`, refuses (exit 1) when any of
  the four §10 gates fail.
- `scripts/v8-bench/run-tricky-goal.ts` — responder updated to
  route by obligation type (extracted from the rendered user
  message) rather than persona id, so the Phase 3 §6 ship gate
  remains invariant to registry size (Phase 7 architecture
  deviation 5).

### Tests (41 new)

- `test/contract/phase7-types.test.ts` (15 tests):
  - `OBLIGATION_TYPES` shape (1)
  - per-type schema validation (8)
  - per-type duplicate detection (2)
  - canonicalization round-trip and ordering (2)
  - memoization key uniqueness (1)
  - performance-threshold range check (1)
- `test/contract/schema-loader.test.ts` (1 test updated to assert
  8 oneOf branches) — counts as +0 net since it was a rewrite.
- `test/persona/persona-registry.test.ts` (3 tests updated to
  assert the eight-persona shape) — counts as +0 net since it was
  a rewrite.
- `test/verification/run-verifier-phase7.test.ts` (19 tests):
  - function-must-have-signature: 4 (pass, whitespace-insensitive,
    missing signature, missing file)
  - property-must-hold: 2 (predicate exits 0, predicate exits ≠0)
  - import-graph-must-satisfy: 4 (no-upward pass, no-upward fail,
    no-cycles pass, no-cycles fail)
  - coverage-must-exceed: 4 (above threshold, below threshold,
    missing metric, missing report)
  - performance-must-not-regress: 5 (within threshold, regression,
    last-numeric-token, missing baseline, benchmark errors)
- `test/integration/v8-phase7.test.ts` (2 tests):
  - drives every Phase 7 obligation type through the right persona
  - Phase 7 obligation types fail loudly on a non-compliant
    workspace
- `test/benchmarks/v8-phase7-bench.test.ts` (5 tests):
  - default registry exposes at least 7 personas
  - schema declares at least 8 obligation types
  - every Phase 7 obligation type is in `OBLIGATION_TYPES`
  - every Phase 7 persona id is in `DEFAULT_PERSONA_IDS`
  - the §10 ship gate passes end-to-end (subprocess-runs the CLI)

Net new tests: 15 (phase7-types) + 19 (run-verifier-phase7) + 2
(integration:v8-phase7) + 5 (benchmarks:v8-phase7-bench) = 41.
The schema-loader and persona-registry test rewrites kept the same
test count (1 and 3 respectively); they don't add to the new-test
total.

### Build / config

- `tsconfig.build.json` — unchanged from Phase 6; the new
  verification, persona, and contract additions compile under the
  existing `src/**/*` include and the new bench script under
  `scripts/v8-bench/**/*`.

## Self-review findings

**BLOCKER findings:** none.

**NON-BLOCKER findings:**

- `function-must-have-signature` uses a whitespace-stripped
  substring match instead of an AST parser; revisitable at Phase 8
  when tree-sitter integration lands. Logged as Phase 7
  architecture deviation 1.

- `import-graph-must-satisfy` parses imports via regex, not a
  language-aware module resolver; bare specifiers and TS path
  aliases are deliberately ignored. Logged as Phase 7 architecture
  deviation 2.

- The Anthropic extractor's prompt and tool schema continue to
  reference only Phase 1 obligation types. Phase 7 types reach
  contracts via user editing or custom extractors. Production
  prompt-engineering for Phase 7 types is post-v8.0 roadmap.
  Logged as Phase 7 architecture deviation 4.

- Each Phase 7 persona owns exactly one obligation type. This is
  a Phase 2 dispatcher constraint (predicate fires the first
  registered match); future predicate-language expansion can let
  one persona own multiple types disambiguated by ledger conditions.
  Logged as Phase 7 architecture deviation 3.

- Phase 6 carry-over: tournament-mode streaming still single-mode
  only (Phase 6 deviation 1). Phase 7 did not extend the tournament
  loop with mid-round abort. Target: revisit when the tournament
  surface grows a race-fairness-preserving abort path.

- Phase 6 carry-over: post-merge failure marks the run failed but
  does NOT auto-roll back (Phase 6 deviation 2). Phase 7 did not
  add a per-obligation snapshot stack. Target: revisit when a
  worktree-per-obligation primitive lands.

- Phase 4 carry-over: IRONROOT primitive integration. Still
  pending; Phase 7 did not pull on the IRONROOT primitives.
  Target: separate IRONROOT-package PR, not gated to any v8 phase.

- Phase 1 carry-over: `discoverRepoContext` reimplements a small
  subset of `src/test-command-discovery.ts`. Phase 7 did not need
  richer repo context. Target: revisit at Phase 8.

- Local-darwin baseline carries the same 6 pre-existing test
  failures unrelated to v8 work (carry-over from Phase 0). Linux
  CI unaffected. Target: separate cleanup PR on main, not gated
  to any v8 phase.

## Phase 7 commit log (target)

```
feat(v8): five new obligation types — function-must-have-signature, property-must-hold, import-graph-must-satisfy, coverage-must-exceed, performance-must-not-regress (Phase 7)
feat(v8): five new personas — security-reviewer, dependency-auditor, documentation-writer, migration-specialist, test-author (Phase 7)
feat(v8): per-type verifier implementations under run-verifier (Phase 7)
feat(v8): tournament + render + memoization branches for every new obligation type (Phase 7)
test(v8): 36 new tests across schema, validator, canonicalize, verifier, persona, integration, bench (Phase 7)
feat(v8-bench): Phase 7 §10 milestone benchmark with happy-path + failure suites
fix(v8-bench): tricky-bench responder routes by obligation type to be invariant to registry size (Phase 7 deviation 5)
docs(v8): Phase 7 completion + 5 architecture deviations + benchmark report
```

## Notes for Phase 8 (post-v8.0)

- Tree-sitter integration for AST-aware verifiers
  (function-must-have-signature is the first beneficiary; future
  obligation types like `function-must-have-decorator` follow).

- Anthropic-extractor prompt expansion for Phase 7 types. Each new
  type ships with at least one calibration goal in
  `test/contract/extractor-stub.test.ts` so prompt regressions
  surface fast.

- A predicate language richer than Phase 2's "wake on type X" so a
  single persona can own multiple types disambiguated by ledger
  conditions (overhaul guide §4.3 anticipates this).

- Tournament-mode streaming with race-fairness preservation
  (Phase 6 deviation 1 carry-over).

- Per-obligation worktree snapshot for auto-rollback on post-merge
  failure (Phase 6 deviation 2 carry-over).

- A Phase 7 deterministic-strategy library: `import-sort` and
  `format-prettier` already auto-tag for `file-must-exist`; an
  obvious next strategy is `coverage-floor-bumper` that adds a
  trivial test until coverage clears the threshold (cheap miss path
  for the LLM).
