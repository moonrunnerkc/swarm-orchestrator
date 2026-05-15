<div align="center">

<img src="docs/assets/hero.svg" alt="Swarm Orchestrator - contract-first verification for code changes" width="100%">

<p>
  <a href="https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/ci.yml?branch=main&label=CI&logo=github&style=flat-square" alt="CI"></a>
  <a href="https://github.com/moonrunnerkc/swarm-orchestrator/releases/latest"><img src="https://img.shields.io/github/v/release/moonrunnerkc/swarm-orchestrator?label=release&style=flat-square&color=22d3ee" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/moonrunnerkc/swarm-orchestrator?style=flat-square&color=a78bfa" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2020-3c873a?style=flat-square&logo=node.js&logoColor=white" alt="Node >= 20"></a>
  <img src="https://img.shields.io/badge/tests-908%20passing-34d399?style=flat-square" alt="908 tests passing">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict">
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-fb7185?style=flat-square" alt="PRs welcome"></a>
</p>

<p>
  <a href="#install"><b>Install</b></a> ·
  <a href="#how-it-works"><b>How It Works</b></a> ·
  <a href="#quick-start"><b>Quick Start</b></a> ·
  <a href="#common-workflows"><b>Workflows</b></a> ·
  <a href="#contracts"><b>Contracts</b></a> ·
  <a href="#github-action"><b>GitHub Action</b></a> ·
  <a href="#reference"><b>Reference</b></a>
</p>

</div>

---

# Swarm Orchestrator

Swarm Orchestrator is a safety check for code changes. It gives a proposed
change a clear checklist, runs the checklist, and records what happened.

Plain English:

- A `patch` is a proposed code change.
- A `contract` is the checklist the change must satisfy.
- A `provider` is where the proposed change comes from: a file, a queue, a
  hosted model, or your own local model server.
- A `ledger` is the audit log written after the run.
- A `falsifier` is an optional second checker that tries to prove an accepted
  change is still wrong.

Use it when you want:

- AI-generated or externally generated patches checked before merge.
- A CI gate that fails when required checks do not pass.
- A local-only verification path, with optional model-driven generation when
  you want it.

It does not replace tests, review, or CI. It gives them a structured checklist
and saves a record of the decision.

## How It Works

1. You provide a goal, a contract, or both.
2. `swarm` turns that into exact checks, or reads the checks you already wrote.
3. A patch is supplied by a queue, stdin, a directory, or a model provider.
4. `swarm` applies and verifies the patch.
5. Passing runs leave evidence in `.swarm/`; failing runs exit non-zero.

Every important format is linked below so the README stays readable while the
details remain verifiable.

## Install

Requirements:

- Node `>=20`
- git `>=2.40`
- `npm`, `yarn`, or `pnpm` in projects whose contracts run package commands

Install from a clone:

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm install
npm run build
npm link
```

Check the CLI:

```bash
swarm --help
swarm doctor
```

## Quick Start

This checks two simple things: `package.json` exists, and a harmless Node test
command exits successfully. It runs locally, does not call a model, and does
not need an API key.

```bash
cat > contract.yaml <<'EOF'
obligations:
  - type: test-must-pass
    command: node -e "process.exit(0)"
  - type: file-must-exist
    path: package.json
EOF

printf '{"patch":"no-op","source":"readme-smoke"}\n' > patches.jsonl

swarm run --goal "check this project has package metadata" \
  --contract-file contract.yaml \
  --external-patches-queue patches.jsonl \
  --falsifiers off
```

That should exit `0` in this repository. It also creates `.swarm/` evidence
files. After that works, replace `contract.yaml` with checks that matter for
your project, then replace `no-op` with a real patch source or choose a model
provider.

## Common Workflows

### Verify a Hand-Written Checklist

Use this when another tool, person, or agent is producing patches and you want
`swarm` to judge them.

```bash
swarm run --goal "verify the release gate" \
  --contract-file ./swarm/contract.yaml \
  --external-patches-queue ./swarm/patches.jsonl \
  --falsifiers off
```

Patch queues are JSONL. Each line is an envelope:

```json
{"patch":"no-op","source":"manual"}
```

`patch` can be `no-op`, a unified diff, or a whole-file patch block. See the
deterministic provider notes in [docs/providers.md](docs/providers.md) for the
full patch input formats.

### Let a Hosted Model Suggest Changes

Use Anthropic when you want `swarm` to turn the goal into checks and ask the
hosted API for proposed changes.

```bash
export ANTHROPIC_API_KEY=...

swarm run --goal "add a /health endpoint" \
  --extractor anthropic \
  --session anthropic \
  --falsifiers off
```

Pass `--model <id>` if you want to pin a specific Anthropic model. Provider
setup and local-model options are covered in [docs/providers.md](docs/providers.md).
Remove `--falsifiers off` after the optional adapter CLIs are configured.

### Run an Existing Contract Directory

Use this when compile and run happen in separate steps.

```bash
swarm compile "verify the release gate" \
  --contract-file ./swarm/contract.yaml \
  --out .swarm/contracts/release-gate \
  --yes \
  --no-editor

swarm run .swarm/contracts/release-gate \
  --external-patches-queue ./swarm/patches.jsonl \
  --falsifiers off
```

## Contracts

A contract is the machine-readable checklist. It can be YAML, JSON, or a
CommonJS-loadable module. Every contract needs at least one `test-must-pass`
check. Most projects start with build and test checks:

```yaml
obligations:
  - type: build-must-pass
    command: npm run build
  - type: test-must-pass
    command: npm test
```

Common check types:

| Type | Checks |
|---|---|
| `file-must-exist` | A required file exists |
| `build-must-pass` | A build command exits `0` |
| `test-must-pass` | A test command exits `0` |
| `function-must-have-signature` | A function keeps the expected shape |
| `property-must-hold` | A shell predicate exits `0` |
| `import-graph-must-satisfy` | Import rules such as no cycles |
| `coverage-must-exceed` | Coverage stays above a threshold |
| `performance-must-not-regress` | A benchmark stays within tolerance |

The exact contract format is verifiable in
[src/contract/schema/v1.json](src/contract/schema/v1.json).

## Commands

| Command | Purpose |
|---|---|
| `swarm run --goal "<text>"` | Compile and run in one step |
| `swarm compile <goal>` | Write a reusable contract directory |
| `swarm run <contract-dir>` | Run an already compiled contract |
| `swarm resume <run-id>` | Continue from a prior ledger |
| `swarm stats <run-id>` | Summarize a run ledger |
| `swarm doctor` | Check local prerequisites |

Run any command with `--help` for its flags.

## Providers

| CLI value | Plain meaning |
|---|---|
| `deterministic` | Local-only. You provide the contract and patch source. No model or API key. |
| `anthropic` | Hosted model. Requires `ANTHROPIC_API_KEY`. |
| `local` | Your own model server, such as OpenAI-compatible APIs, Ollama, llama.cpp, or vLLM. |

Provider selection is per call. Details, environment variables, and local model
setup are in [docs/providers.md](docs/providers.md).

## GitHub Action

Minimal deterministic gate:

```yaml
- uses: moonrunnerkc/swarm-orchestrator@v9
  with:
    goal: 'check project metadata exists'
    contract-file: ./swarm/contract.yaml
    external-patches-queue: ./swarm/patches.jsonl
    falsifiers: 'off'
```

Hosted model run:

```yaml
- uses: moonrunnerkc/swarm-orchestrator@v9
  with:
    goal: 'add a /health endpoint'
    extractor: anthropic
    session: anthropic
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

See [action.yml](action.yml) for all inputs and [SECURITY.md](SECURITY.md) for
secret-handling rules.

## Output

Runs write evidence under `.swarm/`:

```text
.swarm/contracts/<id>/contract.jsonl
.swarm/contracts/<id>/manifest.json
.swarm/ledger/<run-id>.jsonl
.swarm/snapshots/<run-id>/
```

`swarm` exits non-zero when an obligation fails, a run cannot be completed, or
a configured budget/precondition is violated.

## Reference

- [package.json](package.json) - package version, Node requirement, and npm scripts
- [action.yml](action.yml) - GitHub Action inputs and output
- [src/contract/schema/v1.json](src/contract/schema/v1.json) - exact contract schema
- [docs/providers.md](docs/providers.md) - providers, env vars, and local models
- [docs/falsification-adapters.md](docs/falsification-adapters.md) - optional falsifier adapters
- [docs/migration.md](docs/migration.md) - migration notes
- [CHANGELOG.md](CHANGELOG.md) - release history
- [CONTRIBUTING.md](CONTRIBUTING.md) - development workflow
- [SECURITY.md](SECURITY.md) - vulnerability reporting and secret handling
- [CLAUDE.md](CLAUDE.md) - maintainer architecture notes

Current release: `9.0.0`. v9 removed the legacy v6 pipeline; pin `8.0.x` if
you still need `swarm run --v6`.

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
```

License: [ISC](LICENSE).

<div align="center">
<sub><a href="#swarm-orchestrator">Back to top</a></sub>
</div>
