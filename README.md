<div align="center">

<img src="assets/header.svg" alt="Swarm Orchestrator" width="100%">

# Swarm Orchestrator

**Contract-first AI coding swarm with hash-chained evidence and verifier-gated commits.**

[![License](https://img.shields.io/badge/license-ISC-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square)](package.json)
[![CI](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/ci.yml?branch=main&label=ci&style=flat-square)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/moonrunnerkc/swarm-orchestrator?style=flat-square)](https://github.com/moonrunnerkc/swarm-orchestrator/stargazers)

</div>

> Compile a natural-language goal into a machine-checkable **contract**, dispatch it to a population of **personas** running in a single cached inference session, race **tournament candidates** per obligation, and commit only the diffs that pass verification. Every action is recorded in a hash-chained ledger you can audit, resume, or replay.

`swarm` is what you wrap around an LLM, not a replacement for one. The model writes code; the orchestrator decides what reaches your repo.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [v6 → v8 in plain language](#v6--v8-in-plain-language)
- [What's new in v8](#whats-new-in-v8)
- [End-to-end results](#end-to-end-results)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Personas and obligation types](#personas-and-obligation-types)
- [CLI reference](#cli-reference)
- [GitHub Action](#github-action)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Limitations](#limitations)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Why this exists

Most agent orchestrators have two structural cost problems:

1. **Each agent boots fresh.** N CLI subprocesses each rebuild project context from scratch. Cost scales linearly with N before any useful work happens.
2. **Failures cost as much as successes.** Repair loops retry up to 3× per step, burning budget on semantic failures that rarely recover.

Swarm Orchestrator inverts both:

- One **shared inference session** with the project context as a cached prefix; personas differ only by system-prompt slice and sampling regime.
- No repair loops. Each obligation is satisfied by a **tournament**: parallel candidates from different personas, a cheap verifier picks the winner, losers are discarded with their diff hashes logged.

The cost model and the architecture rationale are in [`docs/v8-overhaul-guide.md`](docs/v8-overhaul-guide.md).

## v6 → v8 in plain language

### What v6 did

You gave it a goal. It planned numbered steps. For each step it spawned an external coding CLI as a child process (Copilot, Claude Code, or Codex), up to two at a time on isolated git branches. After each step it parsed the agent's `/share` transcript, ran nine quality checks against the merged result, and retried failed steps up to three times via a "repair" agent. Steps that passed merged to `main`; failed ones rolled back. Source: `src/swarm-orchestrator.ts`, `src/adapters/`, `src/scheduling/`, `src/repair-agent.ts`, `src/quality-gates/registry.ts`.

### What v8 changes

| | v6 | v8 |
|---|---|---|
| How it talks to the model | spawns one external CLI per step | one Anthropic API session, switches personas by changing the system prompt |
| Goal format | natural-language plan | typed contract with 8 rule types you can edit before execution |
| Parallelism | up to 2 steps at a time, in waves | N candidate solutions racing inside one tournament per rule |
| On failure | retry up to 3 times via a repair agent | discard the candidate, try a different persona; **no retry loop** |
| Verification | once, after the step | 4 checkpoints: pre-generation skip, mid-stream abort, post-generation, post-merge integration |
| Audit trail | run artifacts under `runs/` | append-only hash-chained log under `.swarm/ledger/` (tampering breaks the chain) |
| Resume after kill | not supported | `swarm v8 resume <run-id>` replays the log |
| Some work skips the model entirely | no | yes — file scaffolding, formatters, etc. dispatch through `src/wasm/` for zero tokens |
| Cost economics | pays full project context per step | cached prefix + cheap candidates ⇒ **58.88% lower input tokens** measured against the v6 cost model on the 10-goal suite ([`docs/v8-phase-2-benchmark.md`](docs/v8-phase-2-benchmark.md)) |

### What stayed the same

- The nine quality gates from v6 still ship and still run via `swarm gates`. Source: `src/quality-gates/registry.ts`.
- The four CLI adapters (Copilot, Claude Code, Codex, Claude Code Teams) still ship. They're now opt-in via `swarm run --v6`. Source: `src/adapters/`.
- The `runs/` layout, OWASP report renderer, post-run reporter, and signed attestation are preserved verbatim.

### What v8 actually produces today

A 23-second run from a fresh `git init` + minimal TypeScript scaffold against the goal *"add `src/hello.ts` that exports a `hello()` function returning the string 'hello, world', plus `src/hello.test.ts` that asserts it"*:

| Result | Number |
|---|---|
| Rules in contract | 4 |
| Rules satisfied | 4 / 4 |
| Post-merge integration check | PASS |
| Input tokens | 1,675 |
| Output tokens | 1,342 |
| Estimated cost | ~$0.025 (Sonnet 4 at $3 / $15 per million tokens) |
| Wall time | 23 s |
| Stray files / framework mismatches | 0 |
| `npm run build` after | exit 0 |
| `npm test` after | 1 passed, 0 failed |

Source: ledger entries 0–14 in `/tmp/swarm-v8-proof5/.swarm/ledger/run-moxkfmln-77a270.jsonl`, captured during the four-fix validation in commit [`4e56b4a`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/4e56b4a).

## What's new in v8

v8 is a structural overhaul, not a feature pass. The current `v8-dev` branch ships the following:

| Capability | Where it lives |
|---|---|
| **Contract compiler** — turns a goal into typed obligations the verifier can check | `src/contract/`, `src/cli/v8/compile-handler.ts` |
| **Single cached inference session** with prompt caching | `src/session/anthropic-session.ts` |
| **Population manager** with eight default personas | `src/population/manager.ts`, `src/persona/persona-registry.ts` |
| **Speculative tournament** synthesis (`--mode tournament`) | `src/population/tournament.ts` |
| **Hash-chained JSONL ledger** with tamper detection and resume | `src/ledger/` |
| **Memoization** by obligation key | `src/ledger/memoization.ts` |
| **WASM deterministic floor** for zero-LLM obligations | `src/wasm/` |
| **Streaming verifier** with mid-generation abort | `src/verification/streaming-verifier.ts` |
| **Pre-generation skip** and **post-merge integration check** | `src/verification/pre-generation.ts`, `post-merge.ts` |
| **`swarm v8` CLI** — `compile`, `run`, `resume` subcommands | `src/cli/v8/` |
| **Top-level `swarm run` defaults to v8**, with `--v6` opt-out | `src/cli.ts:226` |
| **GitHub Action** gains `contract-only` and `cost-cap` inputs | [`action.yml`](action.yml) |
| **Eight obligation types** in the v1 schema | `src/contract/schema/v1.json` |
| **Eight personas** wired by default | `src/persona/persona-registry.ts` |

The v6 verified-branch pipeline (worker/reviewer steps, octopus merge, nine quality gates) is preserved verbatim under `swarm run --v6`, `swarm swarm`, and the lower-level commands. v8 is opt-out at the top-level `swarm run` only.

For the phase-by-phase build sequence and exit gates, see [`docs/v8-implementation-guide.md`](docs/v8-implementation-guide.md). Intentional divergences from the spec are logged in [`docs/v8-architecture-deviations.md`](docs/v8-architecture-deviations.md).

## End-to-end results

A 15-flow real-user verification was executed against `v8-dev` on 2026-05-08. Every claim below is backed by a captured artifact under [`docs/v8-e2e/`](docs/v8-e2e/).

| Result | Number | Source |
|---|---|---|
| Surfaces tested | **15** | [`docs/v8-e2e/matrix.md`](docs/v8-e2e/matrix.md) |
| Surfaces passing | **15** | [`docs/v8-e2e/REPORT.md`](docs/v8-e2e/REPORT.md) |
| Defects found | **4** (D1, D2, D3, D5) | [`docs/v8-e2e/REPORT.md`](docs/v8-e2e/REPORT.md) |
| Defects fixed | **4** (commit `8524d88`, 9 regression tests) | [`test/v8-defects-regression.test.ts`](test/v8-defects-regression.test.ts) |
| Anthropic API spend | **~$0.86** across ~33 real calls | [`docs/v8-e2e/captures-postfix/api-spend-audit.txt`](docs/v8-e2e/captures-postfix/api-spend-audit.txt) |

What the run actually proved against the live Anthropic API:

- **F2** — `swarm v8 compile --extractor anthropic` produced a v1-schema-valid contract from a real Sonnet 4 tool-use call.
- **F3** — `swarm v8 run --session anthropic` dispatched 4 calls (architect ×2, implementer, verifier) against a 3-obligation contract; the ledger captured each entry with real `response.usage`; the hash chain validated post-run.
- **F4 + F5** — All 8 personas dispatched against the all-8-types contract; every persona-to-type mapping fired correctly.
- **F6** — Tournament mode with `--candidates 2` produced real candidate diversity; per-round verifier scores ranged 0.7–0.9.
- **F8** — A goal that provoked `lodash` imports plus `--forbid-import lodash` triggered the streaming verifier's mid-stream abort on all 3 candidates (at 144, 588, and 676 chars). Three `candidate-stream-aborted` ledger entries captured the partial-response SHA and abort reason.

**Cost benchmarks** (deterministic, reproducible):

- **Phase 2 §5 floor:** 58.88% effective-input reduction vs the v6 model across 10 goals (54 obligations); pass-rate delta 0.00 pp; mean cache hit rate 76.18%. Re-run with `node dist/scripts/v8-bench/run.js`. Source: [`docs/v8-phase-2-benchmark.md`](docs/v8-phase-2-benchmark.md).
- **Phase 6 streaming:** every doomed goal aborts mid-generation; output tokens strictly lower than baseline on every doomed goal; clean goals produce zero false aborts. Source: [`docs/v8-phase-6-benchmark.md`](docs/v8-phase-6-benchmark.md).
- **Phase 7 §10 milestone:** 8 personas, 8 obligation types, full happy-path dispatch correct, every Phase 7 type catches its failure mode. Source: [`docs/v8-phase-7-benchmark.md`](docs/v8-phase-7-benchmark.md).

These benchmarks run against `StubSession` with deterministic token estimation; the methodology and cost-model assumptions are documented in each report. The real-Anthropic replication target is the weekly cost benchmark in [`docs/v8-implementation-guide.md`](docs/v8-implementation-guide.md) §11.

## Quick start

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| [Node.js](https://nodejs.org/) | `>= 20` | Engines-enforced. CI runs 20 and 22. |
| [git](https://git-scm.com/) | `>= 2.40` | Worktrees are required by the v6/v7 pipeline. |
| Anthropic API key | — | Set `ANTHROPIC_API_KEY`. Required for v8 with real models. Use `--extractor stub` and `--session stub` to run offline. |

### Install

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm install
npm run build
npm link    # exposes the `swarm` and `swarm-orchestrator` binaries on $PATH
```

### Compile, then run

```bash
# 1. Compile a goal into a contract (writes .swarm/contracts/<id>/)
swarm v8 compile "add a /health endpoint that returns 200 OK" --yes

# 2. Run the contract (writes .swarm/ledger/<run-id>.jsonl)
swarm v8 run .swarm/contracts/<contract-id>
```

Or do both in one step (defaults to v8):

```bash
swarm run --goal "add a /health endpoint that returns 200 OK"
```

### Run a built-in recipe

```bash
swarm v8 compile --recipe add-tests --yes
swarm v8 run .swarm/contracts/<contract-id>
```

The seven recipes — `add-tests`, `add-auth`, `add-ci`, `add-api-docs`, `migrate-to-ts`, `refactor-modularize`, `security-audit` — compose a goal from the recipe's description and steps and run through the standard extractor pipeline.

### Run offline (no API key)

```bash
swarm v8 compile "add a hello function" --extractor stub --yes
swarm v8 run .swarm/contracts/<contract-id> --session stub
```

### Resume a killed run

```bash
swarm v8 resume <run-id>
```

The ledger replays prior obligations, skips work that was already satisfied (memoization), and continues.

## How it works

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  goal (text)    │ ──▶ │ contract compiler│ ──▶ │ contract.jsonl + manifest │
└─────────────────┘     └──────────────────┘     └──────────┬───────────┘
                                                            │
                                                            ▼
                  ┌────────────────────────────────────────────────────────┐
                  │             population manager (single session)         │
                  │                                                         │
                  │  ┌────────────┐  trigger predicates  ┌──────────────┐   │
                  │  │  ledger    │ ◀──────────────────  │  personas    │   │
                  │  │ (jsonl,    │                      │  (8 default) │   │
                  │  │ hash-chain)│  candidate writes    └──────────────┘   │
                  │  └─────┬──────┘ ───────────────▶                       │
                  │        │              ▲                                 │
                  │        │              │ tournament + verifier scoring   │
                  │        ▼              │                                 │
                  │  ┌────────────────────┴────────┐                        │
                  │  │ WASM deterministic floor    │ (zero-LLM obligations) │
                  │  └─────────────────────────────┘                        │
                  └─────────────────────┬───────────────────────────────────┘
                                        │
                          ┌─────────────┴────────────┐
                          ▼                          ▼
              ┌────────────────────┐     ┌─────────────────────┐
              │ streaming verifier │     │ post-merge integration │
              │ (mid-stream abort) │     │       check           │
              └─────────┬──────────┘     └──────────┬──────────┘
                        │                           │
                        └─────────────┬─────────────┘
                                      ▼
                              committed diffs
```

1. **Compile.** `swarm v8 compile <goal>` calls Anthropic with a tool-use schema and produces a typed contract: a `contract.jsonl` of obligations plus a `manifest.json` with the goal, repo context, extractor provenance, and a SHA-256 over the canonical JSONL bytes. Identical inputs produce identical contract hashes.
2. **Approve.** The compiled contract is shown to the user, who can edit, accept, or reject before execution. Pass `--yes` to skip the prompt.
3. **Dispatch.** `swarm v8 run <contract>` opens a single cached Anthropic session and walks each obligation. The population manager picks the persona whose trigger predicate matches the obligation's type.
4. **Synthesise.** In `single` mode (default), one candidate is generated per obligation. In `tournament` mode, N candidates run in parallel; a Haiku verifier scores them and the top scorer is applied. Losers are logged to the ledger with their diff hash but never committed.
5. **Verify, four points.**
   - **Pre-generation:** if the ledger says this obligation is already satisfied (memoization key match), skip.
   - **Mid-generation:** the streaming verifier samples partial output and aborts on contract violations (e.g., a forbidden import).
   - **Post-generation, pre-commit:** the obligation's verifier runs against the worktree (file existence, build, test, signature, coverage, etc.).
   - **Post-merge:** an integration check runs the full obligation suite against the merged result.
6. **Record.** Every action is appended to `.swarm/ledger/<run-id>.jsonl` with the SHA of the prior entry. Tampering is detectable; a run can be resumed from any prior state.

The architectural rule: **nothing is committed without passing its obligation's verifier**. Don't introduce a code path that bypasses it.

## Personas and obligation types

The default population is eight personas, each owning exactly one of the eight v1 obligation types:

| Persona | Owns | Phase added |
|---|---|---|
| `architect` | `file-must-exist` | 2 |
| `implementer` | `build-must-pass` | 2 |
| `verifier` | `test-must-pass` | 2 |
| `documentation-writer` | `function-must-have-signature` | 7 |
| `security-reviewer` | `property-must-hold` | 7 |
| `dependency-auditor` | `import-graph-must-satisfy` | 7 |
| `test-author` | `coverage-must-exceed` | 7 |
| `migration-specialist` | `performance-must-not-regress` | 7 |

Source: [`src/persona/persona-registry.ts`](src/persona/persona-registry.ts), [`src/contract/schema/v1.json`](src/contract/schema/v1.json). Adding a persona or an obligation type is documented in [`docs/v8-implementation-guide.md`](docs/v8-implementation-guide.md) §10.

## CLI reference

### `swarm v8`

```text
swarm v8 <subcommand> [args]

subcommands:
  compile <goal>   compile a natural-language goal into a contract
  run <contract>   run a compiled contract
  resume <run-id>  resume a partially-completed run
```

#### `swarm v8 compile <goal>`

```text
--out <dir>           where to write the contract (default .swarm/contracts/<id>/)
--repo-root <path>    project root for repo-context discovery (default cwd)
--yes, -y             auto-approve without prompting
--no-editor           disable the [e]dit option in the approval prompt
--extractor <name>    anthropic (default) | stub | stub-heuristic
--model <id>          Anthropic model id override (default claude-sonnet-4-6)
--temperature <n>     sampling temperature override (default 0)
--api-key <key>       Anthropic API key override (default $ANTHROPIC_API_KEY)
--recipe <name>       compile from a built-in recipe (see `swarm recipes`)
```

#### `swarm v8 run <contract-path>`

```text
--repo-root <path>           project root (default cwd)
--session anthropic|stub     session kind (default anthropic)
--model <id>                 model id override
--api-key <key>              Anthropic API key override
--ledger <path>              ledger jsonl path (default .swarm/ledger/<run-id>.jsonl)
--max-obligations <n>        cap on obligations attempted
--command-timeout-ms <ms>    per-command timeout (default 300000)
--run-id <id>                run id override (default time-based)
--result <path>              write structured run result to this JSON file
--mode single|tournament     execution mode (default single)
--candidates <n>             tournament candidates per round (1-8)
--no-deterministic           disable the WASM deterministic floor
--no-streaming               disable streaming verification
--no-pre-generation          disable pre-generation skip pass
--no-post-merge              disable post-merge integration check
--forbid-import <names>      comma-separated module names the streaming verifier rejects
--cost-cap <usd>             hard cost ceiling in USD; exit 6 if exceeded
```

#### `swarm v8 resume <run-id>`

Same flag set as `run`, plus `--ledger <path>` and `--contract <dir>`.

### Top-level commands

| Command | What it does |
|---|---|
| `swarm run --goal "<text>"` | Compile and run via v8 (default after Phase 4). Use `--v6` to opt into the legacy verified-branch pipeline. |
| `swarm v8 compile <goal>` | Compile a goal into a contract. |
| `swarm v8 run <contract>` | Execute a compiled contract. |
| `swarm v8 resume <run-id>` | Resume from the ledger. |
| `swarm bootstrap <paths> "<goal>"` | Multi-repo deep analysis and plan generation (v6). |
| `swarm plan <goal>` | Generate a v6 plan from a goal. |
| `swarm execute <planfile>` | Execute a saved v6 plan step-by-step. |
| `swarm swarm <planfile>` | Execute a v6 plan with the verified branch + worktree workflow and analyzer-gated concurrency. |
| `swarm quick "<task>"` | Single-agent quick-fix mode. |
| `swarm gates [path]` | Run the quality gates (nine built-in) against a repo. |
| `swarm recipes` | List the seven built-in recipes. |
| `swarm recipe-info <name>` | Show recipe details and parameters. |
| `swarm templates` | List v6 plan templates. |
| `swarm demo [list\|<scenario>]` | Run a pre-configured demo scenario. |
| `swarm status <execid>` | Show execution status. |
| `swarm report <run-id>` | Generate a structured run report. |
| `swarm audit <session-id>` | Generate a Markdown audit report. |
| `swarm metrics <session-id>` | Show metrics summary for a session. |
| `swarm attest verify <commit>` | Verify the swarm attestation git note on a commit. |

Run any command with `--help` for its full flag set. Full reference: [`docs/cli.md`](docs/cli.md).

## GitHub Action

Use Swarm Orchestrator from a workflow:

```yaml
- uses: moonrunnerkc/swarm-orchestrator@v8
  with:
    goal: "add a /health endpoint"
    contract-only: false   # true ⇒ compile + stop, do not execute
    cost-cap: "5.00"       # hard ceiling in USD; run exits 6 if exceeded
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

All inputs are documented in [`action.yml`](action.yml). The two new v8 inputs:

- **`contract-only`** — when `true`, `entrypoint.sh` dispatches to `swarm v8 compile <goal>` and stops. The contract directory under `.swarm/contracts/` is the output.
- **`cost-cap`** — appended as `--cost-cap <usd>` to the run. Cumulative spend is estimated from `response.usage` against Anthropic Sonnet 4 pricing; the run aborts with exit 6 if the cap is exceeded.

## Configuration

| File | Purpose |
|---|---|
| `.env`, `~/.env` | API keys and overrides. Loaded in order: cwd `.env` → orchestrator install `.env` → `~/.env`. First match wins per key. |
| `.swarm/contracts/<id>/contract.jsonl` | Compiled obligations (one per line, schema-validated). |
| `.swarm/contracts/<id>/manifest.json` | Goal, repo context, extractor provenance, contract hash, contract id. |
| `.swarm/ledger/<run-id>.jsonl` | Append-only hash-chained ledger of every persona action and verifier result. |
| `config/quality-gates.yaml` | v6 quality-gate engine config (nine built-in gates). |
| `config/default-agents.yaml` | v6 worker/reviewer agent profiles. |
| `agents/worker.agent.md`, `agents/reviewer.agent.md` | v6 default agent role definitions. |

Full reference: [`docs/configuration.md`](docs/configuration.md).

## Project layout

```
src/
├── cli.ts                       # top-level dispatcher
├── cli/
│   └── v8/                      # v8 subcommands: compile, run, resume, run-wrapper
├── contract/                    # schema, compiler, extractor, validator, canonicalize
│   └── schema/v1.json           # 8 obligation types
├── session/                     # AnthropicSession + StubSession
├── persona/                     # 8 default personas + registry + predicates
├── population/                  # manager, tournament, diff-applier
├── ledger/                      # JSONL ledger + memoization + resume
├── wasm/                        # deterministic floor + first-party strategies
├── verification/                # run-verifier, streaming-verifier, pre/post checks
├── quality-gates/               # v6 nine-gate engine
├── adapters/                    # v6 CLI adapters (claude-code, copilot, codex, …)
└── …                            # v6 scheduling, planning, reporting, etc.

scripts/v8-bench/                # phase-2 / phase-3 / phase-6 / phase-7 benchmarks
docs/                            # architecture, e2e report, phase reports, deviations
config/                          # YAML config for v6 gates and agent profiles
```

A full file inventory and v6→v8 reuse audit lives in [`docs/v8-reuse-audit.md`](docs/v8-reuse-audit.md).

## Limitations

The following are deliberately deferred and documented; each fails cleanly when reached rather than producing wrong output. See [`docs/v8-architecture-deviations.md`](docs/v8-architecture-deviations.md) and [`docs/v8-e2e/REPORT.md`](docs/v8-e2e/REPORT.md) for the full list.

- **Anthropic extractor emits Phase 1 obligations only.** `function-must-have-signature`, `property-must-hold`, `import-graph-must-satisfy`, `coverage-must-exceed`, `performance-must-not-regress` reach contracts via the stub extractor or by hand-editing `contract.jsonl`. Prompt-engineering the Anthropic extractor for Phase 7 types is post-v8.0 roadmap.
- **`function-must-have-signature` is a substring match**, not a tree-sitter AST check. Whitespace-insensitive. Tree-sitter integration is post-v8.0.
- **`import-graph-must-satisfy` parses imports with regex**, not a language-aware module resolver. Bare specifiers and TypeScript path aliases are deliberately ignored.
- **Tournament mode does not stream.** `--mode tournament` plus `--forbid-import` skips the streaming abort cleanly; streaming verification is single-mode only.
- **Post-merge failure does not auto-rollback.** The run is marked failed; per-obligation worktree snapshots are post-v8.0.
- **`--cost-cap` is enforced post-run, not mid-run.** Cumulative spend is checked at the end of each obligation against estimated Sonnet 4 pricing; mid-run abort is post-v8.0.
- **The `swarm` package is published as `7.0.0` on npm.** v8 ships from the `v8-dev` branch; install from source until the v8 cutover commit.
- **The legacy `claude-code-teams`, `copilot`, and `codex` adapters compile and spawn**, but full multi-adapter validation against the post-v8 dispatch is deferred per the multi-adapter validation roadmap.

## Documentation

| Document | What's covered |
|---|---|
| [v8 overhaul guide](docs/v8-overhaul-guide.md) | Architecture rationale, the three inversions, cost model, references. |
| [v8 implementation guide](docs/v8-implementation-guide.md) | Phased build sequence (0–7), exit gates, migration plan. |
| [v8 e2e verification report](docs/v8-e2e/REPORT.md) | The 15-flow real-user run with captures and the four-defect fix log. |
| [v8 architecture deviations](docs/v8-architecture-deviations.md) | Every intentional divergence from the spec, with rationale and revisit timing. |
| [v8 reuse audit](docs/v8-reuse-audit.md) | What v6 modules were kept, modified, or deleted. |
| [Phase 2 benchmark](docs/v8-phase-2-benchmark.md) | Cost-economics gate (≥30% reduction floor). |
| [Phase 6 benchmark](docs/v8-phase-6-benchmark.md) | Streaming-abort gate. |
| [Phase 7 benchmark](docs/v8-phase-7-benchmark.md) | Persona/obligation expansion gate. |
| [Verification](docs/verification.md) | Per-step verifier, outcome checks, transcript checks, hook evidence. |
| [Adapters](docs/adapters.md) | v6 CLI adapter capabilities, options, supervisor. |
| [Quality gates](docs/quality-gates.md) | The nine built-in gates and how to register custom ones. |
| [Configuration](docs/configuration.md) | Config file precedence, schema, overrides. |
| [Architecture (v6/v7)](ARCHITECTURE.md) | Module layout, scheduling, merge strategy, governance for the legacy pipeline. |
| [Contributing](CONTRIBUTING.md) | Development setup, code style, PR workflow. |
| [Security policy](SECURITY.md) | How to report vulnerabilities. |

## Contributing

PRs welcome. Code-style rules are enforced:

- Named exports only, kebab-case filenames, 300-line file soft limit.
- No `any` types in `src/` (`@typescript-eslint/no-explicit-any: error`).
- Structured logger only — no `console.*` in `src/`.
- `preserve-caught-error: error` — attach `cause` when rethrowing.
- Conventional-commit-ish messages with scoped tags (`feat(v8):`, `fix(v8-bench):`, `docs(v8):`, …).

Before any PR:

```bash
npm test
node dist/src/cli.js gates .
```

The full standards live in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2026 Bradley R. Kinnard / [moonrunnerkc](https://github.com/moonrunnerkc)
