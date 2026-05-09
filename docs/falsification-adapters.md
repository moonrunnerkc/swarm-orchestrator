# Falsification Adapters

This document describes the *falsification adapter* subsystem under
`src/falsification/adapters/`. Adapters are **falsifiers, not alternative
producers**: given a patch and an obligation, an adapter tries to falsify
the obligation by surfacing a counter-example, a regression fixture, or a
property-violation trace. The producer side of v8.0.1 is unchanged.

The plan that drives this work is [`docs/adapter-integration.md`](adapter-integration.md);
architectural decisions are recorded in [`DECISIONS.md`](../DECISIONS.md).

## Status

| Phase | Status | Branch |
|---|---|---|
| Phase 0 — contract, registry, cost schema | shipped | `feat/adapter-reintegration-v8` |
| Phase 1 — Codex falsifier, dispatcher, `--falsifiers` flag | shipped, dev gate gated on local Codex install | `feat/adapter-reintegration-v8` |
| Phase 2 — empirical comparison N=30 | not started; gated on Phase 1 dev gate plus the open 48-hour-regression decision in `DECISIONS.md` | — |
| Phase 3+ | not started; conditional on Phase 2 | — |

## Module layout

| File | Responsibility |
|---|---|
| `src/falsification/adapters/types.ts` | `FalsifierAdapter` interface and the four-variant `FalsificationResult` union (counter-example-input, regression-fixture, property-violation-trace, no-falsification-found). Per-call `AdapterCostRecord`. |
| `src/falsification/adapters/registry.ts` | `AdapterRegistry`: in-process keyed map. Registration order is part of the contract — Phase 1's sequential dispatcher walks adapters in registration order. |
| `src/falsification/adapters/cost-aggregator.ts` | Reduces per-call records into the per-`(adapter, obligation-type)` `AdapterCostAggregate` shape written to `runs/<id>/cost-attribution.json`. |
| `src/falsification/adapters/index.ts` | Public entry point. `defaultAdapterRegistry()` returns a registry pre-populated with the built-in adapters (Phase 1: `CodexFalsifier`). |
| `src/falsification/adapters/codex/codex-falsifier.ts` | The Codex adapter. Spawns the real `codex exec` binary in `--sandbox workspace-write --ask-for-approval never`. |
| `src/falsification/adapters/codex/codex-prompt.ts` | Prompt construction. One strategy: adversarial test input generation against `property-must-hold`. Three candidates per call. |
| `src/falsification/adapters/codex/codex-output-parser.ts` | Strict JSON parser for Codex's response. Malformed output is a real error, not a `no-falsification-found` outcome. |
| `src/falsification/adapters/codex/predicate-runner.ts` | Applies a candidate to the workspace, runs the obligation predicate, classifies confirmed counter-examples vs. false positives, restores the workspace. |
| `src/falsification/adapters/codex/codex-cost.ts` | Token-to-dollar pricing. Source-cited rate table; conservative fallback when the model is not in the table. |
| `src/falsification/dispatcher.ts` | Sequential dispatcher. Honors `--falsifiers off` by short-circuiting before any adapter runs. |

## Contract summary

```ts
interface FalsifierAdapter {
  readonly name: string;                       // kebab-case, unique
  readonly handles: readonly ObligationType[]; // declared obligation types
  falsify(input: FalsificationInput): Promise<FalsifyOutcome>;
}

type FalsificationResult =
  | CounterExampleResult        // confirmed inputs that make the predicate fail
  | RegressionFixtureResult     // promoted fixture (not produced in Phase 1)
  | PropertyViolationTraceResult // step trace (not produced in Phase 1)
  | NoFalsificationFoundResult; // first-class "did not falsify" outcome
```

The full type definitions live in
[`src/falsification/adapters/types.ts`](../src/falsification/adapters/types.ts).

## Cost attribution

The Phase 0 schema decision in [`DECISIONS.md`](../DECISIONS.md) extended
`runs/<execution-id>/cost-attribution.json` additively. New optional fields:

| Field | Type | Semantics |
|---|---|---|
| `adapters` | `AdapterCostAggregate[]` | One entry per `(adapterName, obligationType)` pair, summing `dollarsSpent`, `wallClockMs`, `counterExamplesFound`, `falsePositives`, `calls`. Sorted by `(adapterName, obligationType)` for byte-stable JSON. |
| `adapterDollarsTotal` | `number` | Materialized sum of `adapters[].dollarsSpent`. |

Both fields are omitted entirely when no falsifier ran (default behavior
in v8.0.1 production). Older readers stay valid.

## CLI flag

`swarm v8 run` accepts `--falsifiers <on|off>` (default `on`). Setting
`off` makes `dispatchFalsifiers()` short-circuit; adapter code stays in
the tree but is never invoked. Phase 1 does not yet wire the dispatcher
into the run loop — that is Phase 2 measurement infrastructure work.
The flag is parsed and propagated so the wiring lands clean when Phase 2
starts.

## Sandbox posture (Codex Phase 1)

Codex runs with:

- `--sandbox workspace-write` — file writes confined to the supplied
  workspace, no network, no system-level state.
- `--ask-for-approval never` — non-interactive; all sandbox-violating
  operations fail closed.
- `--skip-git-repo-check` — the workspace may be a temp directory not
  initialized as a git repo, so the safety check that requires a git repo
  is bypassed (the sandbox is the actual safety boundary).

No `--yolo`, no `--dangerously-bypass-approvals-and-sandbox`. Adding
either requires its own decision entry in `DECISIONS.md` first.

## Running the integration test against the real Codex CLI

The integration test
[`test/falsification/adapters/codex/codex-falsifier.integration.test.ts`](../test/falsification/adapters/codex/codex-falsifier.integration.test.ts)
is gated on the `SWARM_E2E_CODEX=1` environment variable. To run it
locally:

1. Install Codex: `npm i -g @openai/codex`
2. Authenticate: see Codex's own docs (typically `OPENAI_API_KEY` in the
   environment).
3. Build: `npm run build`
4. Run: `SWARM_E2E_CODEX=1 npx mocha 'dist/test/falsification/adapters/codex/codex-falsifier.integration.test.js'`

The test uses a trivial property (`! grep -r FORBIDDEN_TOKEN_XYZ_12345`)
that Codex should be able to falsify on the first try. A
`no-falsification-found` outcome on this property is treated as a
Phase 1 dev-gate failure and asserts.

## What is NOT in this subsystem

To keep the Phase 0/1 surface small and reviewable, the following are
explicitly out of scope (mirrored in `DECISIONS.md` and in the plan):

- Plugin SDK, signature verification, plugin signing.
- Multiple strategies per adapter (one strategy per adapter for now).
- Stigmergic evidence board, pheromone propagation.
- Cross-run posterior persistence.
- Dashboard or UI surface for falsification results.
- Auto-installation of adapter CLIs.
- Any Phase 2–6 deliverable (empirical comparison, additional adapters,
  bandit dispatch, cross-vendor producer race).

## See also

- [`docs/adapter-integration.md`](adapter-integration.md) — the
  multi-phase plan this subsystem implements.
- [`DECISIONS.md`](../DECISIONS.md) — Adapter Decisions section,
  including the still-open question on the 48-hour post-merge
  regression check that gates Phase 2.
- [`docs/falsification-battery-current.md`](falsification-battery-current.md) —
  the existing v7 battery that the adapter system runs *alongside*, not
  instead of.
- [`src/verification/battery-runner.ts`](../src/verification/battery-runner.ts) —
  the v7 battery's entry point.
