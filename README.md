<div align="center">

<img src="assets/header.svg" alt="Swarm Orchestrator" width="100%">

**Contract-first AI coding swarm with hash-chained evidence and verifier-gated commits.**

[![License](https://img.shields.io/badge/license-ISC-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square)](package.json)
[![CI](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/ci.yml?branch=main&label=ci&style=flat-square)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/moonrunnerkc/swarm-orchestrator?style=flat-square)](package.json)

</div>

`swarm` compiles a natural-language goal into a typed contract, dispatches it to a
population of personas inside one cached Anthropic session, and commits only the
diffs that pass verification. The default `single` mode runs one purpose-built
persona per obligation; opt in to `--mode tournament` to race multiple candidates
per obligation when adversarial selection is worth the extra cost. After the
producer's verifier accepts a patch, registered falsifier adapters get a chance to
break it before it merges. Every action lands in an append-only hash-chained ledger
you can audit, resume, or replay.

Before your first run, sanity-check the environment with `swarm doctor` —
it probes ANTHROPIC_API_KEY, falsifier CLIs (codex/copilot/claude), and the
package manager so a misconfigured prerequisite surfaces immediately instead of
producing a confusing run summary.

It wraps an LLM; it does not replace one. The model writes the code, the orchestrator
decides what reaches your repo.

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

Requires Node `>= 20`, git `>= 2.40`, and `ANTHROPIC_API_KEY`. Pass
`--extractor stub --session stub` to run offline.

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator && npm install && npm run build && npm link

# Compile a goal into a contract, then run it
swarm compile "add a /health endpoint that returns 200 OK" --yes
swarm run .swarm/contracts/<contract-id>

# Or both in one step
swarm run --goal "add a /health endpoint that returns 200 OK"

# Opt into the legacy v6 verified-branch pipeline
swarm run --v6 --goal "add a /health endpoint that returns 200 OK"

# Resume a killed run from the ledger
swarm resume <run-id>
```

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

1. **Compile.** `swarm compile <goal>` calls Anthropic with a tool-use schema and
   writes a typed `contract.jsonl` plus a `manifest.json` carrying goal, repo
   context, extractor provenance, and a SHA-256 of the canonical contract bytes.
   Identical inputs produce identical contract hashes.
2. **Dispatch.** `swarm run` opens one cached Anthropic session and walks each
   obligation. The population manager picks the persona whose trigger predicate
   matches the obligation's type. In `tournament` mode, N candidates run in parallel;
   a verifier picks the top scorer; losers are logged but never committed.
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
swarm compile <goal>  [--out <dir>] [--yes] [--extractor anthropic|stub]
                      [--model <id>] [--recipe <name>]
swarm run <contract>  [--session anthropic|stub] [--mode single|tournament]
                      [--candidates <n>] [--falsifiers on|off]
                      [--forbid-import <names>] [--cost-cap <usd>]
                      [--no-cost-cap-live] [--snapshot-cleanup <policy>]
                      [--falsifier-scheduler none|ucb1] [--falsifier-stats-path <path>]
                      [--no-streaming] [--no-pre-generation] [--no-post-merge]
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

```yaml
- uses: moonrunnerkc/swarm-orchestrator@v8
  with:
    goal: "add a /health endpoint"
    contract-only: false   # true compiles and stops
    cost-cap: "5.00"       # hard ceiling in USD; run exits 6 if exceeded
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

All inputs documented in [`action.yml`](action.yml).

## Configuration

| File | Purpose |
|---|---|
| `.env`, `~/.env` | API keys and overrides. Loaded cwd `.env`, then orchestrator install `.env`, then `~/.env`; first match wins per key. |
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
