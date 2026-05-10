<div align="center">

<img src="assets/header.svg" alt="Swarm Orchestrator" width="100%">

# Swarm Orchestrator

**Contract-first AI coding swarm with hash-chained evidence and verifier-gated commits.**

[![License](https://img.shields.io/badge/license-ISC-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square)](package.json)
[![CI](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/ci.yml?branch=main&label=ci&style=flat-square)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/moonrunnerkc/swarm-orchestrator?style=flat-square)](package.json)

</div>

`swarm` compiles a natural-language goal into a typed contract, dispatches it to a
population of personas inside one cached Anthropic session, races candidate diffs per
obligation, and commits only the diffs that pass verification. After the producer's
verifier accepts a patch, registered falsifier adapters get a chance to break it
before it merges. Every action lands in an append-only hash-chained ledger you can
audit, resume, or replay.

It wraps an LLM; it does not replace one. The model writes the code, the orchestrator
decides what reaches your repo.

## Status

Version `8.0.1` on `main`. Node `>= 20` (CI matrix: 20, 22). License ISC. The v8
architecture is the default for `swarm run`; the v6 verified-branch pipeline is
preserved under `swarm run --v6` and the `swarm swarm` / `swarm execute` commands.
Falsifier subsystem: Codex on, Copilot on, ClaudeCode opt-in (see
[Adapters](#adapters)).

## Quick start

Requires Node `>= 20`, git `>= 2.40`, and `ANTHROPIC_API_KEY`. Pass
`--extractor stub --session stub` to run offline.

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator && npm install && npm run build && npm link

# Compile a goal into a contract, then run it
swarm v8 compile "add a /health endpoint that returns 200 OK" --yes
swarm v8 run .swarm/contracts/<contract-id>

# Or both in one step (defaults to v8)
swarm run --goal "add a /health endpoint that returns 200 OK"

# Resume a killed run from the ledger
swarm v8 resume <run-id>
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

1. **Compile.** `swarm v8 compile <goal>` calls Anthropic with a tool-use schema and
   writes a typed `contract.jsonl` plus a `manifest.json` carrying goal, repo
   context, extractor provenance, and a SHA-256 of the canonical contract bytes.
   Identical inputs produce identical contract hashes.
2. **Dispatch.** `swarm v8 run` opens one cached Anthropic session and walks each
   obligation. The population manager picks the persona whose trigger predicate
   matches the obligation's type. In `tournament` mode, N candidates run in parallel;
   a verifier picks the top scorer; losers are logged but never committed.
3. **Verify at four points.** Pre-generation memoization, mid-stream abort,
   post-generation per-obligation verifier, post-merge integration check.
4. **Falsify.** Registered adapters take the satisfied patch and try to break it.
   A confirmed counter-example flips the obligation back to failed.
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
swarm v8 compile <goal> [--out <dir>] [--yes] [--extractor anthropic|stub]
                        [--model <id>] [--recipe <name>]
swarm v8 run <contract>  [--session anthropic|stub] [--mode single|tournament]
                         [--candidates <n>] [--falsifiers on|off]
                         [--forbid-import <names>] [--cost-cap <usd>]
                         [--no-streaming] [--no-pre-generation] [--no-post-merge]
swarm v8 resume <run-id> [--ledger <path>] [--contract <dir>]

swarm run --goal "<text>"  # compiles and runs via v8 (use --v6 for legacy pipeline)
swarm gates [path]         # run quality gates against a repo
swarm recipes              # list built-in recipes
swarm attest verify <commit>
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

- **Tournament mode does not stream.** `--mode tournament` plus `--forbid-import`
  skips the streaming abort; streaming verification is `--mode single` only.
- **Cleanup.** Per-obligation snapshot sidecars under `.swarm/snapshots/<run-id>/`
  are written before each apply and not pruned at end of run; remove them when
  reclaiming disk space.
- **`--cost-cap` is enforced post-obligation, not mid-call.** Cumulative spend is
  checked at the end of each obligation against estimated Sonnet 4 pricing.
- **Bandit dispatch is not built (Phase 5).** Codex and Copilot have disjoint
  obligation types, so there is nothing to arbitrate between. See
  [`docs/falsification-adapters.md`](docs/falsification-adapters.md).
- **Cross-vendor producer race is deferred (Phase 6).**

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
