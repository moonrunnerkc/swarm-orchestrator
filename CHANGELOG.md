# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- `docs/falsification-adapters.md`, `docs/adapter-integration.md`, expanded
  Adapter Decisions section in `DECISIONS.md`.

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

Architecture rationale: [`docs/v8-overhaul-guide.md`](docs/v8-overhaul-guide.md).
Phased build sequence:
[`docs/v8-implementation-guide.md`](docs/v8-implementation-guide.md).
Module reuse audit: [`docs/v8-reuse-audit.md`](docs/v8-reuse-audit.md).

## Earlier releases

Per-release notes for v4.1.0 through v7.0.0 live under
[`docs/releases/`](docs/releases/). Those entries pre-date this changelog and
were not retroactively rewritten; the source-of-truth for those versions is
the git tag and the matching `RELEASE-vX.Y.Z.md` file.
