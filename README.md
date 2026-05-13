<div align="center">

<img src="assets/header.svg" alt="Swarm Orchestrator" width="100%">

**Deterministic-first code-change verifier. Hand-authored contracts, externally-sourced patches, hash-chained evidence, falsifier-gated commits. Opt-in providers for local and hosted models.**

[![License](https://img.shields.io/badge/license-ISC-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square)](package.json)
[![CI](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/ci.yml?branch=main&label=ci&style=flat-square)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/moonrunnerkc/swarm-orchestrator?style=flat-square)](package.json)

</div>

`swarm` is a verification and falsification engine for code changes, with three
opt-in input providers on top. The default `deterministic` provider takes a
hand-authored contract and externally-sourced patches and runs the entire
verification pipeline against them with zero network calls, zero model
installs, and zero API keys. The `local` provider lets you swap in any
OpenAI-compatible / Ollama / llama.cpp / vLLM endpoint as the source of
patches; the `anthropic` provider does the same against Claude. The verifier
never knows which provider produced its input.

After a candidate passes per-obligation verification, registered falsifier
adapters get a chance to break it before it merges. Every action lands in an
append-only hash-chained ledger you can audit, resume, or replay. The
architectural rule: nothing commits without passing the obligation's verifier
and the quality-gate pipeline.

## Status

Version `8.0.2` on `main`. Node `>= 20` (CI matrix: 20, 22). License ISC. The v8
architecture is the default — `swarm compile`, `swarm run`, `swarm resume`,
`swarm stats`, and `swarm doctor` all dispatch to it without a version prefix.
The legacy v6 verified-branch pipeline is preserved as opt-in under
`swarm run --v6` and the `swarm swarm` / `swarm execute` commands. The `swarm v8
<cmd>` form still works for anyone pinned to the explicit prefix.
Falsifier subsystem: Codex on, Copilot on, ClaudeCode opt-in (see
[Adapters](#adapters)).

## Quick start

Requires Node `>= 20` and git `>= 2.40`. No model, no API key, no network access
needed for the default provider.

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator && npm install && npm run build && npm link

# Author a contract directly — the deterministic extractor validates it.
cat > contract.yaml <<'EOF'
obligations:
  - type: test-must-pass
    command: npm test
EOF

# Compile (deterministic by default — no model call, no API key needed).
swarm compile "verify the test command exits zero" \
  --contract-file contract.yaml \
  --out .swarm/contracts/local

# Pre-stage external patches (empty here; pre-generation verification
# satisfies the test-must-pass obligation against the current workspace).
echo -n "" > patches.jsonl

# Run (deterministic session reads patches from the queue file).
swarm run .swarm/contracts/local --external-patches-queue patches.jsonl
```

That first run touches no external service. To opt into a model provider, see
[Providers](#providers) below.

```bash
# Resume a killed run from the ledger
swarm resume <run-id>
```

## Providers

Three providers implement the same Extractor and Session interfaces. The
verifier, ledger, manifest, canonicalization, falsifiers, snapshot/rollback,
quality gates, cost cap, and tournament logic are provider-agnostic.

### Deterministic (default; no model, no network)

Use when the contract can be hand-authored and patches come from an
external source (a model running outside the orchestrator, a human
patcher, a recorded session, anything that produces FORMAT 1/2/3 patch
envelopes). This is the only provider whose runtime guarantees no network
access and no model dependency.

```bash
swarm compile "<goal>" --contract-file contract.yaml --out <dir>
swarm run <dir> --external-patches-queue patches.jsonl
# Or:  --external-patches-dir <dir>
# Or:  --external-patches-stdin
```

### Local (opt-in; any OpenAI-compatible / Ollama / llama.cpp / vLLM endpoint)

Use when you want patch generation but no third-party API. The local
provider talks to whatever endpoint you run. No model is hardcoded; no
hardware is assumed. Configure via environment:

```bash
export LOCAL_LLM_BACKEND=openai-compatible      # or ollama | llama-cpp | vllm
export LOCAL_LLM_BASE_URL=http://localhost:8080/v1
export LOCAL_LLM_MODEL_EXTRACTOR=<your-chosen-model>
export LOCAL_LLM_MODEL_SESSION=<your-chosen-model>

swarm compile "<goal>" --extractor local
swarm run .swarm/contracts/<id> --session local
```

### Anthropic (opt-in; requires `ANTHROPIC_API_KEY`)

Use as a baseline benchmark, or when you want the convenience of a hosted
endpoint without standing up your own.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
swarm compile "<goal>" --extractor anthropic
swarm run .swarm/contracts/<id> --session anthropic
```

### Reference profiles (local provider)

Tested combinations, not recommendations. Any backend-compatible model
works with the local provider.

| Profile | Backend | Hardware | Representative model |
|---|---|---|---|
| Minimal | `openai-compatible` (Llamafile-server) | CPU only | small quantized 3-7B |
| Modest | `ollama` | Consumer GPU | mid-size code-trained model |
| Serious | `llama-cpp` | Workstation / high-end GPU | larger code model |
| Remote | `vllm` | Separate inference server | hosted on a GPU box |

See [docs/providers.md](docs/providers.md) for the full configuration
reference (env vars, config-file keys, grammar negotiation, prefix-cache
mapping per backend, determinism guarantees and limitations).

## How it works

```text
goal (text)
   |
   v
contract compiler  ->  contract.jsonl + manifest.json
   |
   v
+-------------------------------------------------+
|        population manager (single session)      |
|                                                 |
|  ledger (jsonl, hash-chain) <- personas (8)     |
|       ^                          |              |
|       | tournament + verifier scoring           |
|       |                                         |
|  WASM deterministic floor (zero-LLM obligs)     |
+-------------------------------------------------+
   |                              |
   v                              v
streaming verifier      post-merge integration
   |                              |
   +--------------+---------------+
                  v
       falsifier adapters (Codex, Copilot)
                  |
                  v
            committed diffs
```

1. **Compile.** `swarm compile <goal>` runs the configured extractor — the
   default deterministic extractor validates a hand-authored contract file; the
   local extractor issues a single call against a user-configured endpoint with
   grammar-constrained decoding; the Anthropic extractor uses a Sonnet
   tool-use call. All three emit the same canonical `contract.jsonl` plus a
   `manifest.json` carrying goal, repo context, extractor provenance, and a
   SHA-256 of the canonical bytes. Identical inputs produce identical hashes.
2. **Dispatch.** `swarm run` opens a session via the configured provider —
   the deterministic session pulls externally-staged patches; the local
   session calls the user-configured endpoint with the unified-diff
   grammar; the Anthropic session uses a cached prompt-cache-native
   prefix. The population manager picks the persona whose trigger
   predicate matches the obligation's type. In `tournament` mode, N
   candidates run in parallel; a verifier picks the top scorer; losers are
   logged but never committed.
3. **Verify at four points.** Pre-generation memoization, mid-stream abort,
   post-generation per-obligation verifier, post-merge integration check.
4. **Falsify.** Registered adapters take the satisfied patch and try to break it.
   A confirmed counter-example flips the obligation back to failed and triggers an
   ARIES-style workspace rollback: pre-apply bytes are restored from a
   content-addressed sidecar under `.swarm/snapshots/<run-id>/`, the restore is
   verified by re-hashing on-disk bytes against the logged pre-apply blob SHA, and
   out-of-band mutations between apply and rollback are detected rather than
   silently overwritten. The post-merge integration check uses the same primitive
   to unwind every applied obligation in reverse order when cross-obligation
   regression is detected.
5. **Record.** Every action is appended to `.swarm/ledger/<run-id>.jsonl` with the
   SHA of the prior entry. Tampering is detectable; runs resume from any prior state.

The architectural rule: nothing commits without passing the obligation's verifier.

Architecture deep-dive: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Adapters

There are two adapter subsystems. They are not the same thing.

**Producer adapters** (`src/adapters/`): wrap third-party coding CLIs as the worker
in the v6 verified-branch pipeline. Backends: Copilot, Claude Code, Codex, Claude
Code Teams. All four are opt-in via `swarm run --v6`. See
[`docs/adapters.md`](docs/adapters.md).

**Falsifier adapters** (`src/falsification/adapters/`): given a patch and an
obligation, try to falsify the obligation by surfacing a counter-example, regression
fixture, or property-violation trace. Run after the producer's verifier accepts the
patch.

| Falsifier | Default | Obligation types |
|---|---|---|
| `CodexFalsifier` | on | `property-must-hold` |
| `CopilotFalsifier` | on | `import-graph-must-satisfy`, `function-must-have-signature` |
| `ClaudeCodeFalsifier` | off (per-adapter opt-in) | `property-must-hold`, `import-graph-must-satisfy`, `function-must-have-signature` |

The CLI surface is one flag, `--falsifiers <on|off>` (default `on`). Per-adapter
selection is a registry-construction concern at the API layer
(`defaultAdapterRegistry({ includeCopilot, includeClaudeCode })`). Full reference,
sandbox posture, and dual-column cost reporting in
[`docs/falsification-adapters.md`](docs/falsification-adapters.md).

## CLI reference

```text
swarm compile <goal>  [--out <dir>] [--yes]
                      [--extractor deterministic|local|anthropic]
                      [--contract-file <path>] [--contract-module <path>]
                      [--model <id>] [--recipe <name>]
                      [--local-backend openai-compatible|ollama|llama-cpp|vllm]
                      [--local-base-url <url>]
                      [--local-model-extractor <id>]
                      [--local-grammar auto|json-schema|none]
                      [--local-request-timeout-ms <n>] [--local-max-concurrency <n>]
                      [--local-api-key <key>] [--local-seed <n>]
swarm run <contract>  [--session deterministic|local|anthropic]
                      [--external-patches-dir <path>] [--external-patches-queue <path>]
                      [--external-patches-stdin] [--external-patches-timeout-ms <n>]
                      [--mode single|tournament]
                      [--candidates <n>] [--falsifiers on|off]
                      [--forbid-import <names>] [--cost-cap <usd>]
                      [--no-cost-cap-live] [--snapshot-cleanup <policy>]
                      [--falsifier-scheduler none|ucb1] [--falsifier-stats-path <path>]
                      [--no-streaming] [--no-pre-generation] [--no-post-merge]
                      [--local-backend openai-compatible|ollama|llama-cpp|vllm]
                      [--local-base-url <url>]
                      [--local-model-session <id>]
                      [--local-persona-model-map <path-or-json>]
                      [--local-grammar auto|gbnf|json-schema|outlines|none]
                      [--local-request-timeout-ms <n>] [--local-max-concurrency <n>]
                      [--local-api-key <key>] [--local-seed <n>]
swarm resume <run-id> [--ledger <path>] [--contract <dir>]
swarm stats <run-id>  [--ledger <path>] [--json]
swarm doctor          [--cwd <path>] [--require-git]

swarm run --goal "<text>"  # compiles and runs; add --v6 for the legacy pipeline
swarm gates [path]         # run quality gates against a repo
swarm recipes              # list built-in recipes
swarm attest verify <commit>

# `swarm v8 <cmd>` is still accepted as an alias for any of the above.
```

Run any subcommand with `--help` for the full flag set. Full reference:
[`docs/cli.md`](docs/cli.md).

## GitHub Action

The action inherits the CLI's `deterministic` default and runs offline
unless the workflow opts in to the Anthropic or local provider. Set
`EXTRACTOR_PROVIDER` / `SESSION_PROVIDER` (or pass `--extractor` /
`--session`) to switch.

```yaml
- uses: moonrunnerkc/swarm-orchestrator@v8
  with:
    goal: "add a /health endpoint"
    contract-only: false   # true compiles and stops
    cost-cap: "5.00"       # hard ceiling in USD; run exits 6 if exceeded
  env:
    # Required only when the action is configured to use the Anthropic
    # provider (EXTRACTOR_PROVIDER=anthropic / SESSION_PROVIDER=anthropic).
    # The default is deterministic and needs no API key.
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

All inputs documented in [`action.yml`](action.yml).

## Configuration

| File | Purpose |
|---|---|
| `.env`, `~/.env` | Provider configuration and overrides (`ANTHROPIC_API_KEY`, `LOCAL_LLM_*`, etc.). Loaded cwd `.env`, then orchestrator install `.env`, then `~/.env`; first match wins per key. |
| `.swarm/contracts/<id>/contract.jsonl` | Compiled obligations, schema-validated. |
| `.swarm/contracts/<id>/manifest.json` | Goal, repo context, extractor provenance, contract hash. |
| `.swarm/ledger/<run-id>.jsonl` | Append-only hash-chained ledger of every persona action and verifier result. |
| `config/quality-gates.yaml` | v6 quality-gate engine config. |
| `config/default-agents.yaml` | v6 worker/reviewer agent profiles. |

Reference: [`docs/configuration.md`](docs/configuration.md), config precedence in
[`CLAUDE.md`](CLAUDE.md).

## Project layout

`src/` is grouped by responsibility: `contract/`, `session/`, `persona/`,
`population/`, `ledger/`, `wasm/`, `verification/`, `falsification/adapters/`,
`adapters/` (v6 producer CLIs), `quality-gates/`, `cli/`.

## Limitations

- **Cross-vendor producer race is deferred (Phase 6).**

Previously documented limitations resolved in the current build:

- **Tournament streaming.** `--mode tournament` now routes each candidate
  through the same `runStreamingCompletion` pipeline used by single mode;
  streaming verifiers (forbid-import, regex, cost-cap) abort only the
  offending candidate while survivors continue. Replay reproduces the same
  winner.
- **Snapshot cleanup.** `.swarm/snapshots/<run-id>/` is pruned automatically
  after the `run-finished` ledger entry via `--snapshot-cleanup` (default
  `retain-on-failure`; also `always`, `never`, `retain-last:N`,
  `max-age:<dur>`, `max-disk:<sz>`).
- **Live `--cost-cap`.** Cumulative spend is now projected from streaming
  token usage in real time across every concurrent stream; once the cap is
  crossed, in-flight streams are cooperatively aborted with a
  `candidate-stream-aborted` ledger entry (`reason='cost-cap exceeded'`).
  Opt out with `--no-cost-cap-live` to fall back to post-obligation
  enforcement.
- **Adaptive falsifier dispatch.** Opt in with `--falsifier-scheduler ucb1`;
  the dispatcher orders adapters by UCB1 over persisted (success,
  regression-discovered, false-positive, latency) counters at
  `.swarm/falsifier-stats.json`. Each decision is ledgered as
  `falsifier-dispatch-decision` for replay determinism. Default `none`
  preserves registration order.

## Documentation

| Document | What it covers |
|---|---|
| [Architecture](ARCHITECTURE.md) | Module layout, scheduling, falsification battery, output artifacts. |
| [Falsification adapters](docs/falsification-adapters.md) | Adapter contract, sandbox posture, cost reporting, methodology invariants. |
| [Producer adapters](docs/adapters.md) | v6 producer-CLI capabilities, end-of-turn contract. |
| [Quality gates](docs/quality-gates.md) | The 9 built-in gates, how to register custom ones. |
| [CLI reference](docs/cli.md) | Every subcommand and flag. |
| [Verification](docs/verification.md) | Per-step verifier, transcript checks, hook evidence. |
| [Changelog](CHANGELOG.md) | Per-release changes. |
| [Contributing](CONTRIBUTING.md) | Development setup, code style, PR workflow. |
| [Security policy](SECURITY.md) | How to report vulnerabilities. |

## Contributing

```bash
npm install
npm run build
npm test
```

Before any PR: `npm test`, then `node dist/src/cli.js gates .`. Code style and the
full PR workflow are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[ISC](LICENSE) (c) 2026 Bradley R. Kinnard / [moonrunnerkc](https://github.com/moonrunnerkc).
