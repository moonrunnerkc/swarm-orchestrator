# Falsification Adapters

This document describes the *falsification adapter* subsystem under
`src/falsification/adapters/`. Adapters are **falsifiers, not alternative
producers**: given a patch and an obligation, an adapter tries to falsify
the obligation by surfacing a counter-example, a regression fixture, or a
property-violation trace. The producer side of v8.0.1 is unchanged.

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

Three invariants are load-bearing for the falsifier subsystem:

1. **Pre-apply baseline predicate check.** Every adapter that runs a
   shell predicate (currently Codex and ClaudeCode for
   `property-must-hold`) checks the predicate against the unmodified
   workspace before any LLM spawn. If the predicate fails pre-apply,
   the adapter returns `no-falsification-found` with reason
   `baseline-predicate-failed`, no spawn, no billed dollars.
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
   cross-adapter ratios.

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
midpoint). The constant is overridable via
`COPILOT_USD_PER_PREMIUM_REQUEST_API_EQUIV`.

## CLI flag

`swarm run` accepts `--falsifiers <on|off>`. The default depends on the
session provider: `off` for `deterministic` (the adapters require separate
CLI tools that are not installed by default), `on` for `anthropic` and
`local`. Setting `off` explicitly makes `dispatchFalsifiers()` short-circuit
regardless of session provider; adapter code stays in the tree but is never
invoked.

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

## Sandbox posture

| Adapter | Posture |
|---|---|
| Codex | `--sandbox workspace-write --ask-for-approval never --skip-git-repo-check`. No `--yolo`, no `--dangerously-bypass-approvals-and-sandbox`. |
| Copilot | `--allow-tool view --allow-all-paths --no-ask-user --no-color --output-format text`. No `--allow-all-tools`, no `--allow-all-urls`, no `--yolo`. The integration test (`SWARM_E2E_COPILOT=1`) may relax to `--allow-all-tools` because it runs in an isolated temp workspace. |
| ClaudeCode | `-p --output-format json --max-budget-usd 1.00 --add-dir <workspace> --no-session-persistence --exclude-dynamic-system-prompt-sections`. No `--dangerously-skip-permissions`, no `--allow-dangerously-skip-permissions`, no `--bare`. |

Adding any of the omitted "danger" flags is a deliberate trust
expansion and should be reviewed against the threat model before merge.

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

- Plugin SDK, signature verification, plugin signing.
- Multiple strategies per adapter beyond the one each currently ships
  (Codex: adversarial inputs; Copilot: graph perturbation + signature
  drift; ClaudeCode: adversarial inputs mirrored from Codex).
- Stigmergic evidence board, pheromone propagation, neighbor signaling.
- Cross-run posterior persistence.
- Cross-vendor producer race.
- Dashboard or UI surface for falsification results.
- Auto-installation of adapter CLIs.

## Bandit dispatcher (UCB1)

When `--falsifier-scheduler ucb1` is passed, the dispatcher orders the
adapters that handle the current obligation type by their UCB1 score
based on persisted historical outcomes. Adapters with no observations
are tried first (UCB1 score `+Infinity`), so every falsifier gets at
least one trial before the scheduler starts exploiting. After each
trial the scheduler records (success, regression-discovered,
false-positive, latency-ms) for that adapter and persists the running
counters to `.swarm/falsifier-stats.json` (override with
`--falsifier-stats-path`).

Each scheduling decision is appended to the ledger as a
`falsifier-dispatch-decision` entry containing the ordered adapter
list, the per-adapter UCB1 score (with `+Infinity` serialised as
`null`), and the count of observations consulted. Replay reads the
same persisted stats and ledger, so dispatch order is reproducible.

Default policy is `none` (registration order, no scoring), preserving
existing behaviour for callers that don't opt in.

## Streaming verification in tournament mode

Tournament mode (`--mode tournament`) reuses the same
`runStreamingCompletion` pipeline that single mode uses. Each
candidate streams independently; if a streaming verifier (forbid-
import, regex, cost-cap) trips on one candidate the tournament aborts
*only* that candidate's stream and continues running the others.
Aborted candidates are recorded in the ledger as
`candidate-stream-aborted` and assigned a synthetic verdict
(`score = -1`, `model = 'stream-aborted'`) that is pre-populated into
the verdict-by-hash memo so a same-hash collision cannot promote them
to winner. Surviving candidates are scored normally and the
deterministic tie-break selects the winner. Replay over the same
inputs reproduces identical winner selection.

## Mid-stream cost-cap enforcement

`--cost-cap <usd>` (default behaviour: live; opt out with
`--no-cost-cap-live`) installs a single `LiveCostTracker` shared by
every concurrent stream in the run. The tracker observes each
streaming chunk, projects the run's cumulative spend in real time, and
returns an `abort` decision once the cap is crossed. Aborts propagate
through the same `candidate-stream-aborted` ledger entry used by other
streaming verifiers, with `reason = 'cost-cap exceeded'` and the
estimated spend at the abort moment. Final per-stream usage is
committed via `commitUsage` so post-run reconciliation matches the
real adapter response. Partial outputs remain replay-safe because the
abort marker and the partial text are both ledgered before the next
candidate starts.

## Snapshot cleanup

Per-obligation snapshots written under `.swarm/snapshots/<run-id>/`
were previously never pruned. The run lifecycle now invokes
`cleanupSnapshots()` once after the `run-finished` ledger entry is
written, so cleanup never races an active writer. Policies, set with
`--snapshot-cleanup`:

- `retain-on-failure` (default) — drop the current run's directory on
  success, keep everything on failure.
- `always` — always drop the current run's directory after run-end.
- `never` — never prune anything.
- `retain-last:N` — keep the N most-recent run directories by mtime.
- `max-age:<duration>` — prune any run directory whose newest mtime is
  older than the given duration (`500ms`, `30m`, `7d`).
- `max-disk:<size>` — prune oldest-first until the snapshot root is
  under the given size (`100MB`, `2GB`).

Cleanup is idempotent and tolerates concurrently-removed directories
between scan and rm, so an interrupted cleanup re-run reaches the same
final state.

## See also

- [`src/verification/battery-runner.ts`](../src/verification/battery-runner.ts) —
  the v7 battery's entry point. The adapter system runs *alongside* the
  battery, not instead of it.
