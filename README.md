<div align="center">

<img src="docs/assets/hero.svg" alt="Swarm Orchestrator - the merge gate for AI-generated PRs" width="100%">

<p>
  <a href="https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/ci.yml?branch=main&label=CI&logo=github&style=flat-square" alt="CI"></a>
  <a href="https://github.com/moonrunnerkc/swarm-orchestrator/releases/latest"><img src="https://img.shields.io/github/v/release/moonrunnerkc/swarm-orchestrator?label=release&style=flat-square&color=22d3ee" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/moonrunnerkc/swarm-orchestrator?style=flat-square&color=a78bfa" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2020-3c873a?style=flat-square&logo=node.js&logoColor=white" alt="Node >= 20"></a>
  <img src="https://img.shields.io/badge/tests-953%20passing-34d399?style=flat-square" alt="953 tests passing">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict">
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-fb7185?style=flat-square" alt="PRs welcome"></a>
</p>

<p>
  <a href="#how-it-works"><b>How It Works</b></a> ·
  <a href="#github-action"><b>GitHub Action</b></a> ·
  <a href="#install"><b>Install</b></a> ·
  <a href="#quick-start"><b>Quick Start</b></a> ·
  <a href="#cheat-detectors"><b>Cheat Detectors</b></a> ·
  <a href="#ai-bom"><b>AI-BOM</b></a> ·
  <a href="#orchestration-mode"><b>Orchestration Mode</b></a> ·
  <a href="#reference"><b>Reference</b></a>
</p>

</div>

---

# Swarm Orchestrator — *the merge gate for AI-generated PRs*

When your team uses Claude Code, Cursor, Devin, Aider, Codex CLI, or Copilot to
ship code, the failure mode that bites is not a bad commit — it's a green PR
where the agent quietly relaxed a test, mocked a service that does not exist,
stripped assertions to make a failing case pass, or edited the test instead of
the bug. Swarm is the GitHub Action that catches that before it merges.

Phase 1 ships four cheat detectors, an evidence ledger, and a procurement-ready
AI-BOM. Phase 2 publishes a public leaderboard scoring named agents on a 500-
case corpus. Phase 3 emits CycloneDX 1.6 ML-BOM and SPDX 3.0 AI-Profile
artifacts so the audit clears procurement before [EU AI Act Article 11][eu-ai-act]
binds August 2, 2026.

[eu-ai-act]: docs/eu-ai-act-mapping.md

## How It Works

1. A PR opens against your repo. The agent that wrote it could be human or AI;
   Swarm fingerprints the source from commit metadata, bot author, branch
   prefix, and PR body.
2. The Swarm GitHub Action wakes on `pull_request`, fetches the unified diff,
   and runs the cheat-detector engine against it. Each detector reports
   findings with severity `block`, `warn`, or `info`.
3. Findings stream into an append-only, hash-chained evidence ledger under
   `.swarm/ledger/audit-<run-id>.jsonl`. Tampering breaks the chain.
4. The action posts a rendered Markdown comment back to the PR — pass/fail
   header, agent attribution line, findings grouped by severity, ledger link.
5. Any `block` finding fails the check. CI refuses the merge.
6. Optionally, the same run emits a CycloneDX-ML or SPDX-AI document for
   procurement and EU AI Act Annex IV technical documentation.

The orchestrator path that produced this engine — contract → typed checks →
graded patches → post-merge re-audit — is still available for teams that want
Swarm to *generate* code, not just audit it. See [Orchestration mode](#orchestration-mode).

## GitHub Action

Self-host on every PR with `pull_request: [opened, synchronize, reopened]`:

```yaml
name: PR Audit
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  pull-requests: write
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: moonrunnerkc/swarm-orchestrator@v10
        with:
          audit-mode: true
          emit-aibom: cyclonedx-ml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Outputs:

- `audit-pass` — `"true"` if no blocking findings.
- `audit-findings` — blocking-finding count.
- `audit-ledger` — path to the JSONL evidence ledger inside the job workspace.

The composite sub-action at
[`.github/actions/swarm-audit/`](.github/actions/swarm-audit/) skips the
Docker container path when you want a lighter `setup-node` flow.

See [action.yml](action.yml) for every input and
[SECURITY.md](SECURITY.md) for secret-handling rules.

## Install

Requirements: Node `>=20`, git `>=2.40`, `npm`.

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm install
npm run build
npm link
swarm --help
```

Or as a one-shot audit against a PR you own:

```bash
GITHUB_TOKEN=ghp_... npx swarm-orchestrator audit moonrunnerkc/swarm-orchestrator#123
```

## Quick Start

```bash
# Audit a PR by reference
swarm audit moonrunnerkc/swarm-orchestrator#42 --emit-aibom cyclonedx-ml

# Audit a diff on disk (offline, no GitHub call)
git diff main...HEAD > my.patch
swarm audit --diff-file my.patch

# Audit from stdin (good for git hooks)
git diff main...HEAD | swarm audit --diff-stdin --output markdown
```

Exit codes:

- `0` — pass (no blocking findings).
- `1` — block (one or more blocking cheat patterns caught).
- `2` — usage error.

## Cheat Detectors

Phase 1 ships four detectors that each catch a specific category of
agent-authored shortcut:

| Category | What it catches |
|---|---|
| `test-relaxation` | Strict matcher swapped for a looser one (`toBe(5)` → `toBeDefined()`), `describe`/`it` blocks deleted, removed assertions inside an edited hunk. |
| `mock-of-hallucination` | `jest.mock`, `vi.mock`, `@patch` against modules that exist in no manifest in the repo (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml). |
| `assertion-strip` | Net assertion count in a test file drops after the PR, regardless of how the deletion is spread across hunks. |
| `no-op-fix` | PR claims to fix a failing test but the source modifications share no symbol with the test changes, or no test file in the repo imports the modified source. |

Phase 2 expands the lineup to ten categories on a 500/500 broken/clean
fixture corpus. See
[benchmarks/leaderboard/](benchmarks/leaderboard/).

## AI-BOM

`--emit-aibom cyclonedx-ml`, `--emit-aibom spdx-ai`, or `--emit-aibom both`
writes one document per format per run under `.swarm/aibom/`. Both formats are
hand-rolled against the upstream spec (no third-party emitter dep):

- **CycloneDX 1.6 ML-BOM** — audited patch is the subject `application`
  component; detected agent is a `machine-learning-model` component;
  findings are `vulnerabilities` with `affects` pointing to the subject;
  the evidence ledger is hashed into `externalReferences`.
- **SPDX 3.0 AI-Profile** — JSON-LD with the AI profile. Subject is a
  `SoftwareApplication`, agent is an `AIPackage`, each finding is a
  reviewer `Annotation`, the agent links to the subject via an
  `audited` `Relationship`.

Procurement mappings:

- [docs/eu-ai-act-mapping.md](docs/eu-ai-act-mapping.md) — EU AI Act Article 11
  plus Annex IV technical-documentation fields.
- [docs/cisa-sbom-ai-mapping.md](docs/cisa-sbom-ai-mapping.md) — CISA SBOM-for-AI
  minimum elements.

## Orchestration mode

The audit engine is built on top of the contract-first, falsification-gated
orchestrator that pre-dates v10. Teams that want Swarm to *generate* code in
addition to grading it use the run path:

```bash
swarm init                # scaffold rules + patches input
swarm run --goal "..."    # extract → grade → post-merge re-audit
```

The rule format is a YAML or JSON file at `contract.yaml` (auto-discovered
from cwd). Each rule is a typed check Swarm knows how to grade:

```yaml
obligations:
  - type: build-must-pass
    command: npm run build
  - type: test-must-pass
    command: npm test
```

Common check types and the runtime taxonomy live in
[docs/check-types.md](docs/check-types.md). The contract schema is verifiable
at [src/contract/schema/v1.json](src/contract/schema/v1.json).

### Common workflows

```bash
# Verify a hand-written rule set against externally supplied patches
swarm run --goal "verify the release gate"

# Let Anthropic produce candidate patches under the rule set
swarm run --goal "add a /health endpoint" \
  --extractor anthropic --session anthropic

# Run a pre-compiled rule directory
swarm compile "verify the release gate" --contract-file ./swarm/contract.yaml \
  --out .swarm/contracts/release-gate --yes --no-editor
swarm run .swarm/contracts/release-gate
```

Falsifiers (the cheat-detection layer underneath the audit engine) are `off`
by default for the deterministic provider and `on` for hosted ones. Override
with `--falsifiers <on|off>`. Provider setup is in
[docs/providers.md](docs/providers.md).

### Presets

```bash
swarm run --goal "quick check" --preset fast      # fewer gates, deterministic provider
swarm run --goal "rigor"       --preset full      # default — all gates on
```

| Preset | Cheat detection | Streaming | Pre-gen | Post-merge | Best for |
|---|---|---|---|---|---|
| `full` | on | on | on | on | Hosted providers, max rigor |
| `fast` | off | off | off | off | Deterministic provider, local iteration |
| `minimal` | off | off | off | off | Deterministic floor only |

## Commands

| Command | Purpose |
|---|---|
| `swarm audit <pr|--diff-*>` | **v10 entry point.** Audit a PR diff and exit on blocking findings. |
| `swarm run --goal "<text>"` | Compile rules and grade patches in one step |
| `swarm compile <goal>` | Write a reusable rule directory |
| `swarm run <contract-dir>` | Grade against an already-compiled rule directory |
| `swarm resume <run-id>` | Continue from a prior ledger |
| `swarm stats <run-id>` | Summarize a run ledger |
| `swarm init` | Scaffold rules + patches input |
| `swarm doctor` | Check local prerequisites |
| `swarm doctor --fix` | Auto-fix common setup problems |

Run any command with `--help` for its flags.

## Output

Audit runs write evidence under `.swarm/` (gitignored at the consumer-repo
level):

```text
.swarm/ledger/audit-<run-id>.jsonl   append-only hash-chained evidence
.swarm/aibom/<run-id>.cdx.json       CycloneDX 1.6 ML-BOM (when --emit-aibom)
.swarm/aibom/<run-id>.spdx.json      SPDX 3.0 AI-Profile (when --emit-aibom)
```

`swarm audit` exits non-zero when any finding has severity `block`. Every
`SwarmError` carries a `remediation` field so the user knows how to fix the
input that caused the failure.

## Reference

- [package.json](package.json) — package version, Node requirement, npm scripts
- [action.yml](action.yml) — GitHub Action inputs and outputs
- [docs/check-types.md](docs/check-types.md) — full rule taxonomy
- [docs/providers.md](docs/providers.md) — extractor and session providers
- [docs/falsification-adapters.md](docs/falsification-adapters.md) — adapter configuration
- [docs/eu-ai-act-mapping.md](docs/eu-ai-act-mapping.md) — EU AI Act mapping
- [docs/cisa-sbom-ai-mapping.md](docs/cisa-sbom-ai-mapping.md) — CISA SBOM-for-AI mapping
- [benchmarks/leaderboard/](benchmarks/leaderboard/) — agent leaderboard harness
- [src/contract/schema/v1.json](src/contract/schema/v1.json) — rule schema
- [CHANGELOG.md](CHANGELOG.md) — release history
- [CONTRIBUTING.md](CONTRIBUTING.md) — development workflow
- [SECURITY.md](SECURITY.md) — vulnerability reporting and secret handling

Current release: `10.0.0` (in progress on `v10-auditor-repositioning`). Pin
`9.x` for the pre-audit orchestrator surface, `8.0.x` for the v6 legacy
pipeline.

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
```

License: [ISC](LICENSE).

<div align="center">
<sub><a href="#swarm-orchestrator--the-merge-gate-for-ai-generated-prs">Back to top</a></sub>
</div>
