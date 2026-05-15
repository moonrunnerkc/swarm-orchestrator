<div align="center">

<img src="assets/header.svg" alt="Swarm Orchestrator" width="100%">

### Deterministic-first verification and falsification engine for code changes.

<p>
Hand-authored contracts, externally-sourced patches, verifier-gated commits,<br/>
append-only evidence ledgers, and optional model providers for local or hosted<br/>
generation.
</p>

<p>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-ISC-blue?style=flat-square"></a>
  <a href="package.json"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square"></a>
  <a href="https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/ci.yml?branch=main&label=ci&style=flat-square"></a>
  <a href="package.json"><img alt="Version" src="https://img.shields.io/github/package-json/v/moonrunnerkc/swarm-orchestrator?style=flat-square"></a>
</p>

<p>
  <a href="#quick-start"><b>Quick start</b></a>
  &nbsp;·&nbsp;
  <a href="#providers"><b>Providers</b></a>
  &nbsp;·&nbsp;
  <a href="#how-it-works"><b>How it works</b></a>
  &nbsp;·&nbsp;
  <a href="#adapters"><b>Adapters</b></a>
  &nbsp;·&nbsp;
  <a href="#cli-reference"><b>CLI</b></a>
  &nbsp;·&nbsp;
  <a href="#github-action"><b>GitHub Action</b></a>
  &nbsp;·&nbsp;
  <a href="#documentation"><b>Docs</b></a>
</p>

</div>

---

`swarm` separates patch generation from verification.

The default deterministic provider runs entirely offline with no model installs,
API keys, or network access. It validates hand-authored contracts against
externally-supplied patches and runs the same verification pipeline used by
model-backed sessions.

Optional providers let you generate patches through:

- local OpenAI-compatible endpoints
- Ollama
- llama.cpp
- vLLM
- Anthropic Claude

The verifier, falsifiers, ledger, manifests, rollback system, and quality gates
are provider-agnostic. The verifier never knows where patches came from.

After a patch satisfies its obligation, falsifier adapters attempt to break it
before merge. Every action is recorded in an append-only hash-chained ledger for
replay, auditing, and resume support.

The architectural rule is simple:

> Nothing commits unless the obligation verifier and quality gates pass.

---

## Status

<p align="center">
<sub><b>Version</b> <code>9.0.0</code> &nbsp;·&nbsp; <b>Node</b> <code>&gt;= 20</code> &nbsp;·&nbsp; <b>CI matrix</b> 20, 22 &nbsp;·&nbsp; <b>License</b> ISC</sub>
</p>

v9.0.0 removes the legacy v6 verified-branch pipeline. Pin to `8.0.x` if you
still depend on `swarm run --v6` or the v6 top-level commands. v8.0.3 made
`deterministic` the default extractor and session provider; that default
carries forward unchanged.

v8 is the only supported architecture. These commands dispatch directly to v8
without a version prefix:

```text
swarm compile
swarm run
swarm resume
swarm stats
swarm doctor
```

The `swarm v8 <cmd>` form is still accepted for compatibility. The legacy
verified-branch pipeline (`swarm run --v6`, `swarm swarm`, `swarm execute`,
`swarm bootstrap`, `swarm plan`, etc.) was removed in v9.0.0; pin to `8.0.x` if
you still depend on it.

---

## Quick start

Requires:

- Node `>= 20`
- git `>= 2.40`

The default provider requires no model, no API key, and no network access.

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator

npm install
npm run build
npm link
```

Author a contract:

```bash
cat > contract.yaml <<'EOF'
obligations:
  - type: test-must-pass
    command: npm test
EOF
```

Compile it:

```bash
swarm compile "verify the test command exits zero" \
  --contract-file contract.yaml \
  --out .swarm/contracts/local
```

Provide externally-generated patches:

```bash
echo -n "" > patches.jsonl
```

Run verification:

```bash
swarm run .swarm/contracts/local \
  --external-patches-queue patches.jsonl
```

Resume a stopped run:

```bash
swarm resume <run-id>
```

---

## Providers

All providers implement the same extractor and session interfaces. The verifier,
falsifiers, ledger, manifests, rollback system, tournament logic, and quality
gates are shared across providers.

### Deterministic (default)

Offline verification with no model dependency.

Use when:

- contracts are hand-authored
- patches are generated externally
- reproducibility matters more than generation

Patch sources can include humans, external models, recorded sessions, generated
diff queues, or stdin streams.

```bash
swarm compile "<goal>" \
  --contract-file contract.yaml \
  --out <dir>

swarm run <dir> \
  --external-patches-queue patches.jsonl
```

Additional inputs:

- `--external-patches-dir <dir>`
- `--external-patches-stdin`

### Local provider

Use any compatible local or self-hosted endpoint.

Supported backends:

- OpenAI-compatible APIs
- Ollama
- llama.cpp
- vLLM

```bash
export LOCAL_LLM_BACKEND=openai-compatible
export LOCAL_LLM_BASE_URL=http://localhost:8080/v1
export LOCAL_LLM_MODEL_EXTRACTOR=<model>
export LOCAL_LLM_MODEL_SESSION=<model>

swarm compile "<goal>" --extractor local
swarm run .swarm/contracts/<id> --session local
```

Reference profiles (tested combinations, not recommendations — any
backend-compatible model works):

| Profile | Backend             | Hardware                   | Representative model        |
| ------- | ------------------- | -------------------------- | --------------------------- |
| Minimal | `openai-compatible` | CPU only                   | small quantized 3-7B        |
| Modest  | `ollama`            | Consumer GPU               | mid-size code-trained model |
| Serious | `llama-cpp`         | Workstation / high-end GPU | larger code model           |
| Remote  | `vllm`              | Separate inference server  | hosted on a GPU box         |

Full env-var and grammar reference: [`docs/providers.md`](docs/providers.md).

### Anthropic provider

Hosted Claude integration.

```bash
export ANTHROPIC_API_KEY=sk-ant-...

swarm compile "<goal>" --extractor anthropic
swarm run .swarm/contracts/<id> --session anthropic
```

---

## How it works

```text
goal
  │
  ▼
contract compiler
  │
  ▼
contract + manifest
  │
  ▼
session / population manager
  │
  ├── generate or ingest patches
  ├── verify obligations
  ├── run falsifiers
  ├── apply rollback if needed
  └── append ledger evidence
  │
  ▼
committed diff
```

### Compile

`swarm compile` produces:

- `contract.jsonl`
- `manifest.json`

All providers emit the same canonical contract format and manifest structure.

### Run

`swarm run` opens a provider session. Depending on provider configuration,
patches may come from external queues, local inference endpoints, or hosted
APIs.

Tournament mode evaluates multiple candidates in parallel and selects the top
verified result.

### Verify

Verification occurs at multiple stages:

- pre-generation
- streaming
- post-generation
- post-merge integration

Nothing commits unless verification succeeds.

### Falsify

After verification, falsifier adapters attempt to surface:

- regressions
- counter-examples
- property violations

Confirmed failures trigger rollback using content-addressed snapshots under
`.swarm/snapshots/<run-id>/`. Rollback integrity is verified against logged
SHA-256 hashes before restore.

### Record

Every action is appended to `.swarm/ledger/<run-id>.jsonl`. Each ledger entry
includes the previous entry hash, making tampering detectable. Runs can resume
from prior ledger state.

Architecture details: [`CLAUDE.md`](CLAUDE.md) covers module boundaries; [`docs/falsification-adapters.md`](docs/falsification-adapters.md) covers the falsifier subsystem.

---

## Falsifier adapters

Located in `src/falsification/adapters/`. These attempt to break already-verified
patches.

| Falsifier             | Default | Obligation types                                                                  |
| --------------------- | ------- | --------------------------------------------------------------------------------- |
| `CodexFalsifier`      | on      | `property-must-hold`                                                              |
| `CopilotFalsifier`    | on      | `import-graph-must-satisfy`, `function-must-have-signature`                       |
| `ClaudeCodeFalsifier` | opt-in  | `property-must-hold`, `import-graph-must-satisfy`, `function-must-have-signature` |

Global control: `--falsifiers on|off`.

See [`docs/falsification-adapters.md`](docs/falsification-adapters.md).

---

## CLI reference

<details>
<summary><b>View commands</b></summary>

```text
swarm compile <goal>
swarm run <contract>
swarm resume <run-id>
swarm stats <run-id>
swarm doctor

swarm run --goal "<text>"
```

</details>

Run any command with `--help`.

---

## GitHub Action

The GitHub Action inherits the deterministic offline default.

```yaml
- uses: moonrunnerkc/swarm-orchestrator@v9
  with:
    goal: 'add a /health endpoint'
    contract-only: false
    cost-cap: '5.00'
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Anthropic credentials are only required when explicitly using the Anthropic
provider.

See [`action.yml`](action.yml) for input declarations.

---

## Configuration

<details>
<summary><b>View configuration files</b></summary>

| File                                   | Purpose                              |
| -------------------------------------- | ------------------------------------ |
| `.env`, `~/.env`                       | Provider configuration and overrides |
| `.swarm/contracts/<id>/contract.jsonl` | Compiled obligations                 |
| `.swarm/contracts/<id>/manifest.json`  | Goal, provenance, contract hash      |
| `.swarm/ledger/<run-id>.jsonl`         | Append-only execution ledger         |

</details>

Reference: [`CLAUDE.md`](CLAUDE.md).

---

## Project layout

```text
src/
├── contract/
├── session/
├── persona/
├── population/
├── ledger/
├── wasm/
├── verification/
├── falsification/adapters/
├── inference/
└── cli/
```

---

## Documentation

<details>
<summary><b>View documentation index</b></summary>

| Document                                                           | Purpose                            |
| ------------------------------------------------------------------ | ---------------------------------- |
| [`docs/providers.md`](docs/providers.md)                           | Provider configuration reference   |
| [`docs/migration.md`](docs/migration.md)                           | Upgrade and migration notes        |
| [`docs/configuration.md`](docs/configuration.md)                   | Config file and env precedence     |
| [`docs/falsification-adapters.md`](docs/falsification-adapters.md) | Falsifier subsystem                |
| [`docs/providers.md`](docs/providers.md)                           | Provider configuration reference   |
| [`docs/migration.md`](docs/migration.md)                           | Upgrade and migration notes        |
| [`CHANGELOG.md`](CHANGELOG.md)                                     | Release history                    |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                               | Development workflow               |
| [`SECURITY.md`](SECURITY.md)                                       | Vulnerability reporting            |

</details>

---

## Contributing

```bash
npm install
npm run build
npm test
```

Before opening a PR:

```bash
npm test
npm run typecheck
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

<div align="center">
<sub>

[ISC](LICENSE) © 2026 Bradley R. Kinnard / [moonrunnerkc](https://github.com/moonrunnerkc)

</sub>
</div>
