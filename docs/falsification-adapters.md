# Falsification Adapters

This document describes the *falsification adapter* subsystem under
`src/falsification/adapters/`. Adapters are **falsifiers, not alternative
producers**: given a patch and an obligation, an adapter tries to falsify
the obligation by surfacing a counter-example, a regression fixture, or a
property-violation trace. The producer side of v8.0.1 is unchanged.

The plan that drove this work is [`docs/adapter-integration.md`](adapter-integration.md);
architectural decisions and per-phase close-outs are in [`DECISIONS.md`](../DECISIONS.md).
The 2026-05-09 "Adapter integration close-out" entry in `DECISIONS.md` is
the historical record of the final state.

## Status (final, post-audit-and-corrections)

| Phase | Outcome | Cite |
|---|---|---|
| Phase 0 — contract, registry, cost schema | shipped | 2026-05-08 entries in `DECISIONS.md`. |
| Phase 1 — Codex falsifier, dispatcher, `--falsifiers` flag | shipped; dev gate passed (`evidence/phase1-dev-gate/run-1`) | 2026-05-09 "Phase 1 dev gate: PASSED". |
| Phase 2 — Codex vs producer-only baseline (N=30) | shipped C2.1 (Codex default-on) | 2026-05-09 "Phase 2 close-out". |
| Phase 3 — Copilot ablation (N=20, `import-graph` + `function-signature`) | ship-B' (Copilot default-on) | 2026-05-09 corrected close-out. Original 6.5× headline replaced by a four-ratio table; ship decision survives every API-equivalent cell. |
| Phase 4 redo — ClaudeCode ablation on `property-must-hold` (N=20) | cross-family-diversity thesis confirmed | 2026-05-09 "Phase 4 redo close-out". B' caught 18/19 analyzable; ClaudeCode unique = 0; ClaudeCode ships behind a per-adapter flag default-off. |
| Phase 5 — bandit dispatcher | NOT BUILT (operational skip) | 2026-05-09 "Phase 5 skip rationale". Two adapters with disjoint obligation types — no within-type overlap for the bandit to arbitrate. |
| Phase 6 — cross-vendor producer race | deferred | 2026-05-09 "Phase 6 status (final close-out)". Phase 2's predicate set lacked high-stakes obligations; the gate had no input. |

The original Phase 4 (ClaudeCode on Phase 3's obligation set) is
**INVALIDATED** — see the status banner on `evidence/phase4/analysis.md`.
The redo is the authoritative Phase 4 result.

## Production adapter set

| Adapter | Default | Obligation types it handles |
|---|---|---|
| `CodexFalsifier` | **on** | `property-must-hold` (adversarial test input generation). |
| `CopilotFalsifier` | **on** | `import-graph-must-satisfy`, `function-must-have-signature` (import-graph perturbation, signature drift). |
| `ClaudeCodeFalsifier` | **off** (per-adapter opt-in) | `property-must-hold` (mirrored from Codex; same-family control arm for ablation / research). |

Construction: `defaultAdapterRegistry()` returns a registry with Codex
and Copilot registered. Pass `{ includeCopilot: false }` for a
Codex-only registry, or `{ includeClaudeCode: true }` to add the
same-family control arm. The CLI surface is the single
`--falsifiers <on|off>` flag (see below); per-adapter selection is a
registry-construction concern at the API layer, not a CLI flag.

## Module layout

| File | Responsibility |
|---|---|
| `src/falsification/adapters/types.ts` | `FalsifierAdapter` interface and the four-variant `FalsificationResult` union (counter-example-input, regression-fixture, property-violation-trace, no-falsification-found). Per-call `AdapterCostRecord` carries `dollarsBilled` (real charge) and `dollarsApiEquivalent` (rate-card-derived; see "Cost reporting" below). |
| `src/falsification/adapters/registry.ts` | `AdapterRegistry`: in-process keyed map. Registration order is part of the contract — the dispatcher walks adapters in registration order. |
| `src/falsification/adapters/cost-aggregator.ts` | Reduces per-call records into the per-`(adapter, obligation-type)` `AdapterCostAggregate` shape written to `runs/<id>/cost-attribution.json`. Sums both `dollarsBilled` and `dollarsApiEquivalent`. |
| `src/falsification/adapters/index.ts` | Public entry point. `defaultAdapterRegistry({ includeCopilot?, includeClaudeCode? })` returns a registry pre-populated with the production adapters. |
| `src/falsification/adapters/codex/` | Codex falsifier (Phase 1). `codex exec --sandbox workspace-write --ask-for-approval never`. Strategy: adversarial test input generation, three candidates per call. |
| `src/falsification/adapters/copilot/` | Copilot falsifier (Phase 3). `copilot -p` with constrained per-tool permissions. Strategy: import-graph perturbation + function-signature drift, three candidates per call. |
| `src/falsification/adapters/claude-code/` | ClaudeCode falsifier (Phase 4). `claude -p --output-format json --max-budget-usd 1.00`. Strategy: mirrored from Codex (adversarial test input generation against `property-must-hold`); same family as the producer for the cross-family-diversity ablation. |
| `src/falsification/dispatcher.ts` | Sequential dispatcher. Honors `--falsifiers off` by short-circuiting before any adapter runs. |
| `src/falsification/inspection/heuristic-classifier.ts` | AST-based heuristic classifier for inspection skeletons. **Verdict-aid, not a verdict source** — operator hand inspection is the authoritative verdict. The 2026-05-09 close-out used the heuristic as the verdict source under explicit operator-bypass approval and reported bounds rather than point estimates; that is an exception, not the rule. |

## Contract summary

```ts
interface FalsifierAdapter {
  readonly name: string;                       // kebab-case, unique
  readonly handles: readonly ObligationType[]; // declared obligation types
  falsify(input: FalsificationInput): Promise<FalsifyOutcome>;
}

type FalsificationResult =
  | CounterExampleResult         // confirmed inputs that make the predicate fail
  | RegressionFixtureResult      // promoted fixture (unused by current adapters)
  | PropertyViolationTraceResult // step trace (unused by current adapters)
  | NoFalsificationFoundResult;  // first-class "did not falsify" outcome
```

The full type definitions live in
[`src/falsification/adapters/types.ts`](../src/falsification/adapters/types.ts).
`NoFalsificationFoundResult.reason` includes the value
`baseline-predicate-failed` for the methodology-fix invariant
documented below.

## Methodology-fix invariants

Three invariants are load-bearing for any future falsifier work and
must not be removed without a dated decision entry in `DECISIONS.md`:

1. **Pre-apply baseline predicate check.** Every adapter that runs a
   shell predicate (currently Codex and ClaudeCode for
   `property-must-hold`) checks the predicate against the unmodified
   workspace before any LLM spawn. If the predicate fails pre-apply,
   the adapter returns `no-falsification-found` with reason
   `baseline-predicate-failed`, no spawn, no billed dollars. The gate
   runner surfaces this as a distinct row in `summary.md`. The
   contamination incident in `evidence/phase1-dev-gate/run-1-aborted/`
   is the "why" — leaving the check implicit produced 12 spurious
   yields when the workspace had committed evidence files containing
   the marker tokens the predicates searched for.
2. **Fixture isolation.** Gate runs source workspaces from purpose-built
   fixtures under `evidence/fixtures/` (e.g.
   `evidence/fixtures/phase-1-gate/`, `evidence/fixtures/phase-3/`),
   not from `git archive` of HEAD. Fixture content hashes are recorded
   in each run's `environment.json` and validated by per-phase
   contamination tests
   (`test/falsification/phase{1,2,3}-gate-fixture.test.ts`). A swapped
   fixture during `--resume` is detected by the recorded hash.
3. **Dual-column cost reporting.** `AdapterCostRecord` and
   `AdapterCostAggregate` carry both `dollarsBilled` (real charge;
   subscription auth = $0) and `dollarsApiEquivalent`
   (rate-card-derived API equivalent for cross-adapter comparison).
   Subscription-imputed `dollarsBilled = 0` no longer flatters
   cross-adapter ratios. The Phase 3 close-out's original 6.5× headline
   conflated subscription-imputed token estimates with API-billed
   dollars; the dual-column reporting prevents that confusion at the
   data layer.

## Cost reporting

`runs/<execution-id>/cost-attribution.json` carries:

| Field | Type | Semantics |
|---|---|---|
| `adapters` | `AdapterCostAggregate[]` | One entry per `(adapterName, obligationType)` pair. Sums `dollarsBilled`, `dollarsApiEquivalent`, `wallClockMs`, `counterExamplesFound`, `falsePositives`, `calls`. Sorted by `(adapterName, obligationType)` for byte-stable JSON. |
| `adapterDollarsTotal` | `number` | Materialized sum of `adapters[].dollarsBilled`. |

Both fields are omitted when no falsifier ran (default behaviour in
`--falsifiers off` mode). Older readers stay valid.

**Rate-card-derived API equivalent.** Codex and ClaudeCode meter at
API token rates regardless of auth, so
`dollarsApiEquivalent === dollarsTokenEstimate` for those adapters.
Copilot is subscription-only; `dollarsApiEquivalent` is computed as
`Premium requests × $0.05/request` (GPT-4-Turbo-equivalent rate-card
midpoint per the 2026-05-09 "Cost normalization" entry in
`DECISIONS.md`). The constant is overridable via
`COPILOT_USD_PER_PREMIUM_REQUEST_API_EQUIV`.

## CLI flag

`swarm v8 run` accepts `--falsifiers <on|off>` (default `on`). Setting
`off` makes `dispatchFalsifiers()` short-circuit; adapter code stays in
the tree but is never invoked.

Per-adapter selection is **not** a CLI flag. Construct a registry with
the desired adapters at the API layer:

```ts
import { defaultAdapterRegistry } from '@swarm/falsification';

// Production default: Codex + Copilot, ClaudeCode off.
const registry = defaultAdapterRegistry();

// Codex-only: e.g. for testing the Codex adapter in isolation.
const codexOnly = defaultAdapterRegistry({ includeCopilot: false });

// Add ClaudeCode (same-family control arm) for ablation / research.
const withClaudeCode = defaultAdapterRegistry({ includeClaudeCode: true });
```

If a future phase earns ClaudeCode default-on, the close-out will flip
the default in `defaultAdapterRegistry()` and update this section.

## Sandbox posture

| Adapter | Posture |
|---|---|
| Codex | `--sandbox workspace-write --ask-for-approval never --skip-git-repo-check`. No `--yolo`, no `--dangerously-bypass-approvals-and-sandbox`. |
| Copilot | `--allow-tool view --allow-all-paths --no-ask-user --no-color --output-format text`. No `--allow-all-tools`, no `--allow-all-urls`, no `--yolo`. The integration test (`SWARM_E2E_COPILOT=1`) may relax to `--allow-all-tools` because it runs in an isolated temp workspace. |
| ClaudeCode | `-p --output-format json --max-budget-usd 1.00 --add-dir <workspace> --no-session-persistence --exclude-dynamic-system-prompt-sections`. No `--dangerously-skip-permissions`, no `--allow-dangerously-skip-permissions`, no `--bare`. |

Adding any of the omitted "danger" flags requires its own decision
entry in `DECISIONS.md` first.

## Running adapter integration tests against the real CLIs

Each adapter has an env-gated integration test. To run them locally:

| Test | Env gate | CLI requirement |
|---|---|---|
| `test/falsification/adapters/codex/codex-falsifier.integration.test.ts` | `SWARM_E2E_CODEX=1` | `npm i -g @openai/codex`; `OPENAI_API_KEY` in env. |
| `test/falsification/adapters/copilot/copilot-falsifier.integration.test.ts` | `SWARM_E2E_COPILOT=1` | `gh extension install github/gh-copilot` (or whichever distribution provides the `copilot` binary); GitHub Copilot Pro+ subscription. |
| `test/falsification/adapters/claude-code/claude-code-falsifier.integration.test.ts` | `SWARM_E2E_CLAUDE_CODE=1` | `npm i -g @anthropic-ai/claude-code`; either `ANTHROPIC_API_KEY` or an OAuth/Max session. |

Build first (`npm run build`), then run the env-gated test:

```sh
SWARM_E2E_CODEX=1 npx mocha 'dist/test/falsification/adapters/codex/codex-falsifier.integration.test.js'
```

The Codex weekly canary (`.github/workflows/codex-canary.yml`) runs
`SWARM_E2E_CODEX=1` against the unpinned `@openai/codex` and opens an
`adapter-drift` issue on schedule failure. Equivalent canaries for
Copilot and ClaudeCode are not currently scheduled; vendor-CLI version
drift for those adapters is detected by the integration tests on demand.

## What is NOT in this subsystem

The plan's "What's Explicitly Out of Scope" section continues to
govern. None of the following landed during the adapter integration
work:

- Plugin SDK, signature verification, plugin signing.
- Multiple strategies per adapter beyond the one each currently ships
  (Codex: adversarial inputs; Copilot: graph perturbation + signature
  drift; ClaudeCode: adversarial inputs mirrored from Codex).
- Stigmergic evidence board, pheromone propagation, neighbor signaling.
- Cross-run posterior persistence (would be a Phase 5 concern; Phase 5
  is skipped on operational grounds).
- Bandit dispatcher (Phase 5; not built).
- Cross-vendor producer race (Phase 6; deferred — Phase 2 found no
  high-stakes obligations).
- Dashboard or UI surface for falsification results.
- Auto-installation of adapter CLIs.

## See also

- [`docs/adapter-integration.md`](adapter-integration.md) — the
  multi-phase plan this subsystem implemented. Bears a final-status
  header on top with the close-out date and per-phase outcomes.
- [`DECISIONS.md`](../DECISIONS.md) — Adapter Decisions section,
  including the audit-and-corrections sweep and the 2026-05-09
  "Adapter integration close-out" entry that this document mirrors.
- [`docs/falsification-battery-current.md`](falsification-battery-current.md) —
  the existing v7 battery that the adapter system runs *alongside*, not
  instead of.
- [`src/verification/battery-runner.ts`](../src/verification/battery-runner.ts) —
  the v7 battery's entry point.
