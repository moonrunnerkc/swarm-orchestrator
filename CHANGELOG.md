# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Breaking

- Default provider changed from `anthropic` to `deterministic`. Users who
  relied on the previous default must explicitly opt in to a model provider
  via `--extractor anthropic --session anthropic`, the `EXTRACTOR_PROVIDER` /
  `SESSION_PROVIDER` env vars, or the equivalent project-config keys. See
  [docs/migration.md](docs/migration.md).

### Added

- Deterministic provider for both extractor and session. The tool now runs
  end-to-end with no network access, no model, and no API key. Three
  contract input forms (`--contract-file`, `--contract-module`, inline
  config block) and three patch input channels (`--external-patches-dir`,
  `--external-patches-queue`, `--external-patches-stdin`).
- Local provider supporting `openai-compatible`, `ollama`, `llama-cpp`, and
  `vllm` backends. Backend-agnostic; no model is hardcoded. Configuration
  through `LOCAL_LLM_*` env vars (see
  [docs/configuration.md](docs/configuration.md)).
- Grammar-constrained decoding for backends that support it (`json-schema`
  on `openai-compatible` / `ollama` / `vllm`, `gbnf` on `llama-cpp`). The
  unified-diff GBNF grammar ships at
  `src/inference/local/grammars/unified-diff.gbnf`.
- Ledger entries written by candidate-generation sites now carry optional
  provider-attribution fields: `provider`, `modelId`, `backend`, `grammar`,
  `seed`, `source`, `usageEstimated`. Existing consumers are unaffected.
- End-to-end test (`test/e2e/deterministic-full-cycle.test.ts`) proving the
  full compile + run + verify cycle works with `ANTHROPIC_API_KEY` unset
  and no network access.
- [docs/providers.md](docs/providers.md),
  [docs/configuration.md](docs/configuration.md),
  [docs/migration.md](docs/migration.md). Architecture overview gains a
  "Provider boundary" section.
- CLI flags for local-provider configuration on `swarm compile`,
  `swarm run`, and `swarm resume`: `--local-backend`, `--local-base-url`,
  `--local-model-extractor`, `--local-model-session`,
  `--local-persona-model-map`, `--local-grammar`,
  `--local-request-timeout-ms`, `--local-max-concurrency`,
  `--local-api-key`, `--local-seed`.
- Config-file `provider:` block parser at `.swarm/config.yaml`
  (`src/config/provider-config.ts`). The block sits below env vars in the
  precedence chain (flag > env > config > default); unknown keys, wrong
  types, and out-of-set enum values fail loud with the offending key
  path.
- Parameterized Session interface contract test running against
  `DeterministicSession`, `AnthropicSession`, and `LocalSession` with each
  of the four shipped local backends. Any new provider must pass the
  same battery to claim Session conformance.
- Provider-comparison benchmark harness at `benchmarks/provider-bench/`.
  Supports `--extractor`, `--session`, every `--local-*` flag, and a
  `--compare-providers` mode that runs all three providers sequentially
  and emits a Markdown report.

### Changed

- Contract JSON Schema extracted to
  `src/contract/extractor/contract-schema.ts`. The Anthropic extractor and
  the deterministic / local extractors all import from it; the LLM tool
  call binds the same bytes the deterministic validator uses.
- Anthropic provider records `provider: 'anthropic'` in ledger entries.
- README Quick Start no longer requires Anthropic credentials. The first
  runnable example produces a working result with zero external
  dependencies.
- `buildExtractor` and `buildSession` consolidated into
  `src/contract/extractor/factory.ts` and `src/session/factory.ts`. The
  duplicated session-building logic across `run-handler.ts` and
  `resume-handler.ts` is gone.
- The legacy `stub` and `stub-heuristic` provider names are no longer
  accepted by the CLI factories. `StubExtractor` and `StubSession` remain
  as library exports for the project's own integration tests and the
  synthetic benchmark; no flag, env var, or config key can reach them.
  The four-chars-per-token estimator moved from `stub-session.ts` to
  `src/session/token-estimator.ts` so production code does not import
  from an `@internal` module.

### Fixed

- README GitHub Action section incorrectly described the Action as
  defaulting to the Anthropic provider; `entrypoint.sh` does not set a
  provider, so the Action inherits the CLI's `deterministic` default.
- `docs/configuration.md` listed `stub` / `stub-heuristic` among the
  accepted `--extractor` / `--session` values; the row was removed after
  the CLI factories stopped accepting those names.

## [8.0.2] - 2026-05-11

Tag commit: set at release time. Previously-documented architectural
limitations closed out in this release; workspace rollback (landed on `main`
since `8.0.1` via [`584bca2`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/584bca2))
is the headline feature shipped under the `8.0.2` tag.

### Added (workspace rollback)

- **ARIES-style workspace rollback for falsified obligations.** A confirmed
  falsifier counter-example now flips the obligation back to failed *and*
  unwinds the patch: pre-apply bytes are restored from a content-addressed
  sidecar under `.swarm/snapshots/<run-id>/`, the restore is verified by
  re-hashing on-disk bytes against the logged pre-apply blob SHA, and
  out-of-band mutations between apply and rollback surface as a failed
  rollback ledger entry rather than being silently overwritten.
  The post-merge integration check reuses the same primitive to unwind
  every applied obligation in reverse order when cross-obligation regression
  is detected. Source: `src/population/rollback.ts`, snapshot manager wiring
  in `src/population/manager.ts`. Land commits
  [`584bca2`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/584bca2)
  and [`2c8effa`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/2c8effa);
  README narrative landed in [`2986159`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/2986159).
- **`swarm v8 stats` subcommand.** Reports per-adapter falsifier counters
  (success, regression-discovered, false-positive, latency-ms) from the
  same `.swarm/falsifier-stats.json` file used by the UCB1 dispatcher.
  Source: `src/cli/v8/index.ts`, README CLI reference landed in
  [`2986159`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/2986159).



- **Tournament streaming verification.** `--mode tournament` now routes
  every candidate through the same `runStreamingCompletion` pipeline used
  by `--mode single`. Streaming verifiers (forbid-import, regex, cost-cap)
  abort only the offending candidate; survivors continue and the
  deterministic tie-break still selects a winner. Aborted candidates are
  pre-populated in `verdictByHash` with a synthetic
  `{ score: -1, model: 'stream-aborted' }` verdict so a same-hash collision
  cannot promote them. Source: `src/population/tournament.ts`,
  `src/verification/streaming-verifier.ts`.
- **Snapshot cleanup.** `.swarm/snapshots/<run-id>/` is pruned once after
  the `run-finished` ledger entry via the new `--snapshot-cleanup <policy>`
  flag. Policies: `retain-on-failure` (default), `always`, `never`,
  `retain-last:N`, `max-age:<dur>`, `max-disk:<sz>`. Idempotent and
  crash-safe (tolerates concurrently-removed directories between scan and
  rm). Source: `src/population/snapshot-cleanup.ts`,
  `src/population/manager.ts`.
- **Live `--cost-cap`.** A single `LiveCostTracker` observes every
  concurrent stream, projects cumulative USD in real time, and triggers a
  cooperative abort once the projection crosses the cap. Aborts are
  recorded as `candidate-stream-aborted` with
  `reason='cost-cap exceeded'`; final per-stream usage is reconciled via
  `commitUsage` after each adapter response settles. Live by default;
  `--no-cost-cap-live` falls back to the old post-obligation enforcement.
  Source: `src/verification/live-cost-tracker.ts`.
- **UCB1 falsifier dispatch.** Opt in with `--falsifier-scheduler ucb1`.
  The dispatcher orders adapters by a UCB1 score over persisted (success,
  regression-discovered, false-positive, latency-ms) counters at
  `.swarm/falsifier-stats.json` (override with `--falsifier-stats-path`).
  Every decision is appended to the ledger as
  `falsifier-dispatch-decision`, so replay reproduces the same ordering.
  Default `none` preserves registration order. Source:
  `src/falsification/scheduler.ts`, `src/falsification/dispatcher.ts`,
  `src/ledger/types.ts`.

### Tests

- 38 new tests across `test/population/snapshot-cleanup.test.ts`,
  `test/verification/live-cost-tracker.test.ts`,
  `test/falsification/scheduler.test.ts`,
  `test/population/tournament-streaming.test.ts`, and extensions to
  `test/falsification/dispatcher.test.ts`. Suite total: **2196 passing**.

---

Adapter reintegration: the falsification dispatcher is wired into the v8 run path
behind the new `--falsifiers <on|off>` flag (default `on`). After the producer's
verifier accepts a patch, every registered adapter that handles the obligation
type runs sequentially against the patch SHA. A confirmed counter-example flips
the obligation back to failed and appends a `falsification-call` ledger entry
with cost and yield. Source: `src/falsification/dispatcher.ts`,
`src/cli/v8/run-handler.ts:163-167`, merge commit
[`d0a46f3`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/d0a46f3).

### Added

- `FalsifierAdapter` contract, in-process `AdapterRegistry`, and per-call
  `AdapterCostRecord` schema with dual-column cost reporting (`dollarsBilled`
  for real charges, `dollarsApiEquivalent` for like-for-like rate-card cost).
  `cost-attribution.json` carries optional `adapters[]` and `adapterDollarsTotal`
  fields. Source: `src/falsification/adapters/{types,registry,cost-aggregator}.ts`,
  `src/metrics-types.ts:103-176`. Pre-registration commit
  [`d813ce7`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/d813ce7).
- `CodexFalsifier`: `codex exec --sandbox workspace-write --ask-for-approval never`,
  three candidates per call. Strategy: adversarial test input generation against
  `property-must-hold`. Default on. Source:
  `src/falsification/adapters/codex/codex-falsifier.ts`. Land commit
  [`c62e8c1`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/c62e8c1).
- `CopilotFalsifier`: `copilot -p` with constrained per-tool permissions
  (`--allow-tool view`, no `--allow-all-tools`). Strategy: import-graph
  perturbation and function-signature drift against `import-graph-must-satisfy`
  and `function-must-have-signature`. Default on. Source:
  `src/falsification/adapters/copilot/copilot-falsifier.ts`. Pre-registration
  commit
  [`8536bc0`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/8536bc0).
- `ClaudeCodeFalsifier`: `claude -p --output-format json --max-budget-usd 1.00`.
  Strategy mirrored from Codex (`property-must-hold`); same family as the
  producer for the cross-family-diversity ablation arm. Default off; opt in
  via `defaultAdapterRegistry({ includeClaudeCode: true })`. Source:
  `src/falsification/adapters/claude-code/claude-code-falsifier.ts`.
- Methodology-fix invariants: pre-apply baseline predicate check (returns
  `no-falsification-found` with reason `baseline-predicate-failed` before any
  LLM spawn if the predicate already fails); workspace fixture isolation under
  `evidence/fixtures/` with hash validation; dual-column cost reporting at the
  `AdapterCostRecord` and `AdapterCostAggregate` layers. See
  [`docs/falsification-adapters.md`](docs/falsification-adapters.md).
- `docs/falsification-adapters.md` documenting the adapter contract, sandbox
  posture, and dual-column cost reporting.

### Not built or deferred

- **Phase 5 bandit dispatcher (not built).** Codex and Copilot have disjoint
  obligation types, so there is nothing for a bandit to arbitrate.
- **Phase 6 cross-vendor producer race (deferred).** Phase 2's predicate set
  lacked the high-stakes obligations the gate is meant to catch.

## [8.0.1] - 2026-05-08

Tag commit: [`c4efe20`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/c4efe20).

### Fixed

- v8 extractor and AST verifiers root-fix (the "big caveat"): the
  `import-graph-must-satisfy` extractor and the `function-must-have-signature`
  AST verifier now use the TypeScript compiler API for `.ts`/`.js` and the
  Python `ast` module for `.py`. Substring matches inside comments and string
  literals no longer produce false positives. Source: commit
  [`1211e11`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/1211e11),
  files `src/verification/ast-imports.ts`, `src/verification/ast-signature.ts`.

### Removed

- `.github/workflows/v8-ci.yml` (the `v8-dev`-branch shadow CI). Source:
  commit
  [`2f6c05e`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/2f6c05e).

## [8.0.0] - 2026-05-06

Tag commit: [`db820f5`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/db820f5)
("v8.0.0: contract-first AI coding swarm (#40)").

The v8 architectural rewrite. Contract compiler, single cached Anthropic
session, eight default personas, eight obligation types in the v1 schema,
hash-chained JSONL ledger with resume, WASM deterministic floor, streaming
verifier with mid-generation abort, post-merge integration check, and the
top-level `swarm run` defaulting to v8 with `--v6` opt-out for the legacy
verified-branch pipeline.

## Earlier releases

Per-release notes for v4.1.0 through v7.0.0 live under
[`docs/releases/`](docs/releases/). Those entries pre-date this changelog and
were not retroactively rewritten; the source-of-truth for those versions is
the git tag and the matching `RELEASE-vX.Y.Z.md` file.
