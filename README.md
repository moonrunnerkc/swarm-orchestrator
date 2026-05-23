# Swarm Orchestrator

A CLI that audits pull-request diffs for AI-agent cheat patterns and gates merges on the result.

[![CI](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%E2%89%A5%2020-3c873a.svg)](package.json)
[![Version 10.0.0](https://img.shields.io/badge/version-10.0.0-22d3ee.svg)](package.json)

## What This Does

Reads a PR diff and reports 10 categories of cheat pattern an AI coding agent might have introduced (test relaxation, mock-of-hallucination, assertion strip, no-op fix, coverage erosion, fake refactor, comment-only fix, error swallow, exception rethrow without cause, dead branch insertion). Exits non-zero on any blocking finding so a CI check fails the PR. Also runs as a contract-driven orchestrator: compile a goal into a typed contract, grade patches against it, log every step to a hash-chained evidence ledger.

## Install

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm install
npm run build
npm link
swarm --help
```

Requires Node 20 or later (see [`package.json`](package.json) `engines.node`).

## Quick start

Audit a PR by reference:

```bash
GITHUB_TOKEN=... swarm audit moonrunnerkc/swarm-orchestrator#42
```

Audit a local diff:

```bash
git diff main...HEAD | swarm audit --diff-stdin
```

Emit a CycloneDX 1.6 ML-BOM alongside the audit:

```bash
swarm audit --diff-file my.patch --emit-aibom cyclonedx-ml
```

Exit codes: `0` pass, `1` block (at least one blocking finding), `2` usage error.

## Use as a GitHub Action

Drop this into `.github/workflows/pr-audit.yml`:

```yaml
name: PR audit
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
      - uses: moonrunnerkc/swarm-orchestrator@main
        with:
          audit-mode: true
          emit-aibom: cyclonedx-ml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Action outputs: `audit-pass` (`"true"` on clean), `audit-findings` (blocking count), `audit-ledger` (path to the JSONL ledger written during the run). Full input list in [`action.yml`](action.yml).

## Cheat-detector categories

The registry is in [`src/audit/cheat-detector/index.ts`](src/audit/cheat-detector/index.ts) and exports 10 detectors. Each detector is one file under that directory; adding a category is one new file plus one entry in the `DETECTORS` array.

| Category | Trigger |
|---|---|
| `test-relaxation` | Strict matcher replaced with a loose one in a test hunk, or a `describe`/`it` block removed without same-chunk replacement. |
| `mock-of-hallucination` | `jest.mock`, `vi.mock`, or `@patch` against a module declared in no manifest in the repo. |
| `assertion-strip` | Net assertion count in a test file drops after the PR. |
| `no-op-fix` | Test modified with no source change in the same PR, or source modified with no test referencing it. |
| `coverage-erosion` | Source branch added (`if`/`switch`/`case`) with no compensating test addition. |
| `fake-refactor` | Exported symbol renamed in its source, no caller in the diff updates the old name. |
| `comment-only-fix` | Source modifications consist entirely of comment additions. |
| `error-swallow` | Empty or comment-only `catch` block added. |
| `exception-rethrow-lost-context` | `throw err` replaced with `throw new Error(...)` and `{ cause }` not forwarded. |
| `dead-branch-insertion` | Branch guarded by a literal-false condition added. |

## Evidence

The synthetic corpus at [`benchmarks/falsification-corpus/v10-corpus/`](benchmarks/falsification-corpus/v10-corpus/) holds 500 broken patches and 500 clean controls (50 of each per category). [`npm run leaderboard`](benchmarks/leaderboard/score.ts) replays every case and exits non-zero on any miss or false positive. Current state on this branch: 500 cases, 0 failed expectations, recorded in [`benchmarks/leaderboard/results.json`](benchmarks/leaderboard/results.json). The full test suite (`npm test`) runs 976 mocha tests.

## Orchestrator mode

Use this when you want Swarm to grade patches against a typed contract rather than audit a PR diff.

```bash
swarm init                                       # scaffold contract.yaml + patches.jsonl
swarm run --goal "check this project builds"     # deterministic provider, no API key
```

A minimal contract:

```yaml
obligations:
  - type: build-must-pass
    command: npm run build
  - type: test-must-pass
    command: npm test
```

Use a hosted model when you want Swarm to produce the patches itself:

```bash
export ANTHROPIC_API_KEY=sk-...
swarm run --goal "add a /health endpoint" --extractor anthropic --session anthropic
```

Provider details, env-var precedence, and local-model setup in [`docs/providers.md`](docs/providers.md). Obligation taxonomy in [`docs/check-types.md`](docs/check-types.md). Schema in [`src/contract/schema/v1.json`](src/contract/schema/v1.json).

## Architecture

Two CLI surfaces share one core.

`swarm run` drives the v8 pipeline: extractor compiles a goal into a contract, session produces candidate patches, predicate-runner evaluates each obligation, falsifier probes for counter-examples, verifier signs off. No patch reaches `main` without passing both `verifyObligation` and `postMergeVerify`.

`swarm audit` reuses the verifier and falsifier layers against a unified diff. It does not need a session, an extractor, or any model credentials.

Both surfaces write to the same append-only hash-chained ledger format ([`src/ledger/ledger.ts`](src/ledger/ledger.ts)). Tampering with a ledger entry breaks the chain.

## AI-BOM output

`--emit-aibom cyclonedx-ml | spdx-ai | both` writes one document per format per run under `.swarm/aibom/`. The emitters are in [`src/audit/aibom/`](src/audit/aibom/) and produce hand-rolled JSON against the upstream specs; there is no third-party AI-BOM runtime dependency. Mappings:

- [`docs/eu-ai-act-mapping.md`](docs/eu-ai-act-mapping.md) maps each CycloneDX-ML field to EU AI Act Article 11 + Annex IV requirements.
- [`docs/cisa-sbom-ai-mapping.md`](docs/cisa-sbom-ai-mapping.md) maps the same artifact to the CISA SBOM-for-AI minimum elements.

## Run artifacts

```text
.swarm/contracts/<id>/contract.jsonl   compiled contract (orchestrator mode)
.swarm/ledger/<run-id>.jsonl           orchestrator ledger
.swarm/ledger/audit-<run-id>.jsonl     audit ledger
.swarm/aibom/<run-id>.cdx.json         CycloneDX-ML (when --emit-aibom)
.swarm/aibom/<run-id>.spdx.json        SPDX 3.0 AI-Profile (when --emit-aibom)
```

`.swarm/` is in [`.gitignore`](.gitignore) at the consumer-repo level.

## Commands

| Command | Purpose |
|---|---|
| `swarm audit <ref \| --diff-*>` | Audit a PR or local diff. |
| `swarm run --goal "<text>"` | Compile a goal and grade patches in one step. |
| `swarm compile <goal>` | Write a reusable compiled contract directory. |
| `swarm run <contract-dir>` | Grade against a pre-compiled contract directory. |
| `swarm resume <run-id>` | Resume a killed run from its ledger. |
| `swarm stats <run-id>` | Aggregate diagnostic counts from a run ledger. |
| `swarm init` | Scaffold `contract.yaml` and `patches.jsonl`. |
| `swarm doctor [--fix] [--connectors]` | Probe local prerequisites. |

Every subcommand has `--help` with its own flag list.

## Versions

`10.0.0` is the current branch. It adds the audit surface, the cheat detectors, the AI-BOM emitters, and the corpus. Internal type names and existing JSON shapes are unchanged from `9.x`.

`9.x` removed the v6 verified-branch pipeline that wrapped third-party agent CLIs. Pin `8.0.x` if you still need `swarm run --v6`.

## Integrations

Each integration wraps `swarm audit` so the same detectors run in whichever environment opens the PR.

- Claude Code slash command: [`.claude/commands/swarm-audit.md`](.claude/commands/swarm-audit.md).
- Cursor rule pack: [`integrations/cursor/swarm-audit.mdc`](integrations/cursor/swarm-audit.mdc).
- Aider pre-commit hook: [`integrations/aider/pre-commit-swarm-audit`](integrations/aider/pre-commit-swarm-audit).
- Composite GitHub Action: [`.github/actions/swarm-audit/`](.github/actions/swarm-audit/).

## Contributing

Development setup, commit-message format, and test conventions are in [`CONTRIBUTING.md`](CONTRIBUTING.md). Project-wide conventions (TypeScript strict, no `any` in `src/`, no `console.*`, etc.) are in [`CLAUDE.md`](CLAUDE.md).

```bash
npm install
npm run build
npm test
npm run typecheck
npm run lint
npm run leaderboard
```

Security disclosures via [`SECURITY.md`](SECURITY.md) (never via public issues).

## License

[ISC](LICENSE).
