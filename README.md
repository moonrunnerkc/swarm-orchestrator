<div align="center">

<img src="docs/assets/hero.svg" alt="Swarm Orchestrator" width="100%">

# Swarm Orchestrator

A CLI for auditing AI-generated PRs and grading patches against typed contracts.

[![CI](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%E2%89%A5%2020-3c873a.svg)](package.json)
[![Version 10.2.0-advisory](https://img.shields.io/badge/version-10.2.0--advisory-22d3ee.svg)](package.json)
[![Real-corpus F1 0.167](https://img.shields.io/badge/real--corpus%20F1-0.167%20%28205%20AI--labeled%29-orange.svg)](benchmarks/real-corpus/scores/latest.json)

<a href="#install"><b>Install</b></a> ·
<a href="#quick-start"><b>Quick start</b></a> ·
<a href="#what-this-does"><b>What it does</b></a> ·
<a href="#real-corpus-headline-f1"><b>Headline F1</b></a> ·
<a href="#cheat-detectors"><b>Detectors</b></a> ·
<a href="#ai-bom"><b>AI-BOM</b></a> ·
<a href="#reference"><b>Reference</b></a>

</div>

---

<div align="center">

## What This Does

Reads a pull-request diff, scores it against four advisory-grade cheat detectors, and writes a suspicion-score comment plus a CycloneDX-ML / SPDX 3.0 AI-Profile artifact.
Default mode is `--mode=advise` (signal only); `--mode=gate` opts into the merge-blocking exit-code contract.
The compliance side (AIBOM, hash-chained evidence ledger, EU AI Act Annex IV / CISA SBOM-for-AI mappings) is the credible-procurement angle; the detector accuracy is the work in progress.

</div>

## Install

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm install
npm run build
npm link
swarm --help
```

Node 20 or later. See [`package.json`](package.json).

## Quick start

```bash
# audit a PR by reference (advisory by default; never blocks the merge)
GITHUB_TOKEN=... swarm audit moonrunnerkc/swarm-orchestrator#42

# opt in to merge-blocking gate mode
GITHUB_TOKEN=... swarm audit moonrunnerkc/swarm-orchestrator#42 --mode gate

# audit a local diff with the experimental detector set (all 10 detectors)
git diff main...HEAD | swarm audit --diff-stdin --detectors experimental

# audit + emit a CycloneDX 1.6 ML-BOM
swarm audit --diff-file my.patch --emit-aibom cyclonedx-ml

# shadow-mode dogfood: record verdicts to disk, no comment, no gate
swarm audit --pr <ref> --shadow my-org/my-repo

# single-file shadow output (one JSON per audit invocation; see docs/shadow-mode.md)
swarm audit --pr <ref> --shadow-output ./audit-verdict.json
```

Exit codes: `0` advisory-clean or any advise-mode run, `1` block (gate mode only), `2` usage error.

## Real-corpus headline F1

The headline number is the score against the AI-labeled real-corpus
baseline (205 PRs, 10 broken / 195 clean, eight agent vendors). Reproduce
with `node dist/scripts/corpus/score-real.js`; snapshot at
[`benchmarks/real-corpus/scores/latest.json`](benchmarks/real-corpus/scores/latest.json).
Public dashboard: [moonrunnerkc.github.io/swarm-orchestrator](https://moonrunnerkc.github.io/swarm-orchestrator/docs/leaderboard/).

| | Value |
|---|---|
| **Real-corpus F1** | **0.167** |
| Real-corpus precision | 0.100 |
| Real-corpus recall | 0.500 |
| Sample size | 205 AI-labeled PRs (10 broken, 195 clean), pending human re-label under labels-v2 |
| Agent vendors covered | 8 (devin, cursor, openhands, copilot-workspace, claude-code, aider, codex-cli, replit-agent) |
| Detector set scored | experimental (all 10), so retired detectors are still measured |
| LLM judge | off (no `ANTHROPIC_API_KEY` exposed to the scorer); rerun with `SWARM_AUDIT_LLM_JUDGE=1` to score the gated path |

The synthetic regression suite prints F1 1.000 on the same code. **That
1.000 is a self-consistency check, not detection power**: the generator
and the detectors share the same regex vocabulary, so a perfect score on
generated patches is what "the detector still understands its own
generator" looks like, nothing more. The synthetic number is preserved
in the leaderboard as a regression sidebar
([`benchmarks/leaderboard/results.json`](benchmarks/leaderboard/results.json)),
not as the headline.

The 205-entry corpus is labeled by an AI judge with "pending human
review" stamped on every entry. That is the largest single hole in the
project's credibility today; closing it is the next milestone (see
[`docs/labeling-methodology.md`](docs/labeling-methodology.md) and the
labels-v2 scaffold under [`benchmarks/real-corpus/labels-v2/`](benchmarks/real-corpus/labels-v2/)).

**Per-detector breakdown** (intent layer active, default strict policy,
experimental set, judge off):

| Detector | Version | Set | TP | FP | TN | FN | Precision | Recall |
|---|---|---|---|---|---|---|---|---|
| `error-swallow` | 2.0.0 | default | 3 | 13 | 189 | 0 | **0.188** | **1.000** |
| `mock-of-hallucination` | 2.0.0 | default | 2 | 16 | 187 | 0 | **0.111** | **1.000** |
| `no-op-fix` | 2.0.0 | default | 0 | 12 | 188 | 5 | 0.000 | 0.000 |
| `fake-refactor` | 2.0.0 | default | 0 | 4 | 201 | 0 | 0.000 | n/a |
| `assertion-strip` | 1.0.0 | experimental | 0 | 5 | 200 | 0 | 0.000 | n/a |
| `coverage-erosion` | 1.0.0 | experimental | 0 | 4 | 201 | 0 | 0.000 | n/a |
| `test-relaxation` | 1.1.0 | experimental | 0 | 4 | 201 | 0 | 0.000 | n/a |
| `comment-only-fix` | 1.0.0 | experimental | 0 | 0 | 200 | 5 | n/a | 0.000 |
| `exception-rethrow-lost-context` | 1.0.0 | experimental | 0 | 0 | 205 | 0 | n/a | n/a |
| `dead-branch-insertion` | 1.0.0 | experimental | 0 | 0 | 205 | 0 | n/a | n/a |

`default` is loaded automatically; `experimental` requires
`--detectors experimental` on the CLI. Six detectors moved out of the
default set in v10.2-advisory:

- **Zero TP / zero FP on the real corpus** (`comment-only-fix`,
  `exception-rethrow-lost-context`, `dead-branch-insertion`): no signal
  to gauge against. Available behind `--detectors experimental` for
  shadow runs and the synthetic regression corpus.
- **FP-only on the real corpus** (`assertion-strip`,
  `coverage-erosion`, `test-relaxation`): measurable cost, no
  measurable value at the current detector shape. Same `--detectors
  experimental` access.

Every PR-comment finding renders its measured-precision badge inline so
a reviewer sees the number every time a finding fires. The renderer's
data source is
[`src/audit/report-comment/detector-precision.ts`](src/audit/report-comment/detector-precision.ts).

## Cheat detectors

Four in the default set, six in experimental. Registered in
[`src/audit/cheat-detector/detector-sets.ts`](src/audit/cheat-detector/detector-sets.ts).

| Category | Set | Trigger |
|---|---|---|
| `error-swallow` | default | Bare empty or comment-only `catch` block added in non-test code. |
| `mock-of-hallucination` | default | `jest.mock` / `vi.mock` / `@patch` against a module declared in no manifest in the repo. |
| `no-op-fix` | default | Test modified with no source change in the same PR, or vice versa; import-graph reachability fallback when only one side moved. |
| `fake-refactor` | default | Exported symbol renamed in source, no caller in the diff updates the old name. |
| `assertion-strip` | experimental | Net assertion count in a test file drops after the PR. |
| `coverage-erosion` | experimental | Source branch added with no compensating test addition. |
| `test-relaxation` | experimental | Strict matcher swapped for a loose one, or a test block removed without same-chunk replacement. |
| `comment-only-fix` | experimental | Source modifications are all comment additions. |
| `exception-rethrow-lost-context` | experimental | `throw err` replaced with `throw new Error(...)` and `{ cause }` not forwarded. |
| `dead-branch-insertion` | experimental | Branch guarded by a literal-false condition added. |

Each detector lives in its own file under [`src/audit/cheat-detector/`](src/audit/cheat-detector/).

## Use as a GitHub Action

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
          mode: advise           # advise | gate
          detectors: default     # default | experimental
          emit-aibom: cyclonedx-ml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Outputs: `audit-pass`, `audit-findings`, `audit-ledger`. Full input list in [`action.yml`](action.yml).

## AI-BOM

`--emit-aibom cyclonedx-ml | spdx-ai | both` writes one document per format per run under `.swarm/aibom/`. Emitters in [`src/audit/aibom/`](src/audit/aibom/) produce hand-rolled JSON against the upstream specs; no third-party AI-BOM runtime dep.

Procurement mappings:

- [`docs/eu-ai-act-mapping.md`](docs/eu-ai-act-mapping.md): EU AI Act Article 11 + Annex IV fields.
- [`docs/cisa-sbom-ai-mapping.md`](docs/cisa-sbom-ai-mapping.md): CISA SBOM-for-AI minimum elements.

## Orchestrator mode

Use this when you want Swarm to grade patches against a typed contract instead of auditing a PR diff.

```bash
swarm init                                    # scaffold contract.yaml + patches.jsonl
swarm run --goal "check this project builds"  # deterministic provider, no API key
```

Minimal contract:

```yaml
obligations:
  - type: build-must-pass
    command: npm run build
  - type: test-must-pass
    command: npm test
```

Hosted-model run:

```bash
export ANTHROPIC_API_KEY=sk-...
swarm run --goal "add a /health endpoint" --extractor anthropic --session anthropic
```

Local-LLM run (Ollama):

```bash
swarm run --goal "add a named export sum(a, b)" \
  --session local --local-backend ollama \
  --local-base-url http://localhost:11434 \
  --local-model-session gemma4:31b \
  --local-grammar none --local-max-concurrency 1 --preset fast
```

Provider details in [`docs/providers.md`](docs/providers.md). Obligation taxonomy in [`docs/check-types.md`](docs/check-types.md). Schema in [`src/contract/schema/v1.json`](src/contract/schema/v1.json).

## Architecture

Two CLI surfaces share one core.

`swarm run` drives the v8 pipeline (extractor, session, predicate-runner, falsifier, verifier). No patch reaches `main` without passing both `verifyObligation` and `postMergeVerify`.

`swarm audit` reuses the verifier and falsifier layers against a unified diff. It needs no session, no extractor, and no model credentials.

Both surfaces write to the same append-only hash-chained ledger ([`src/ledger/ledger.ts`](src/ledger/ledger.ts)). Tampering breaks the chain.

## Commands

| Command | Purpose |
|---|---|
| `swarm audit <ref \| --diff-*>` | Audit a PR or local diff. Advisory by default. |
| `swarm run --goal "<text>"` | Compile and grade in one step. |
| `swarm compile <goal>` | Write a reusable compiled contract directory. |
| `swarm run <contract-dir>` | Grade against a pre-compiled contract directory. |
| `swarm resume <run-id>` | Resume a killed run from its ledger. |
| `swarm stats <run-id>` | Aggregate diagnostic counts from a run ledger. |
| `swarm init` | Scaffold `contract.yaml` and `patches.jsonl`. |
| `swarm doctor [--fix] [--connectors]` | Probe local prerequisites. |

`swarm <cmd> --help` for the flag list of any subcommand.

## Run artifacts

```text
.swarm/contracts/<id>/contract.jsonl   compiled contract (orchestrator mode)
.swarm/ledger/<run-id>.jsonl           orchestrator ledger
.swarm/ledger/audit-<run-id>.jsonl     audit ledger
.swarm/aibom/<run-id>.cdx.json         CycloneDX-ML (when --emit-aibom)
.swarm/aibom/<run-id>.spdx.json        SPDX 3.0 AI-Profile (when --emit-aibom)
.swarm/shadow/<repo>/<run-id>.json     shadow-mode verdict (when --shadow)
```

`.swarm/` is in [`.gitignore`](.gitignore) at the consumer-repo level.

## Integrations

- Claude Code slash command: [`.claude/commands/swarm-audit.md`](.claude/commands/swarm-audit.md).
- Cursor rule pack: [`integrations/cursor/swarm-audit.mdc`](integrations/cursor/swarm-audit.mdc).
- Aider pre-commit hook: [`integrations/aider/pre-commit-swarm-audit`](integrations/aider/pre-commit-swarm-audit).

## Versions

`10.2.0-advisory` repositions the project around the suspicion-score
verdict the measured precision can credibly support. Synthetic 1.000 is
demoted to a regression-only number; the real-corpus 0.109 F1 is the
only headline. `--mode advise|gate` makes the gate behavior opt-in. Six
detectors retire to `--detectors experimental`. Every PR-comment finding
renders its measured-precision badge inline. Shadow-mode infrastructure
lands under `.swarm/shadow/`. Labeling methodology, kappa script, and
labels-v2 scaffold ship alongside; the actual human labels are the next
milestone.

`10.1.0` raised detector accuracy on real PRs: the 205-entry hand-labeled
baseline replaces the synthetic 500-case number as the published
headline, the PR-intent layer escalates findings when the agent claims a
fix, and five new manifest readers landed on `mock-of-hallucination`.

`10.0.0` added the audit surface, the cheat detectors, the AI-BOM
emitters, and the corpus. `9.x` removed the v6 verified-branch pipeline;
pin `8.0.x` if you still need `swarm run --v6`.

## Reference

- [`action.yml`](action.yml): GitHub Action inputs and outputs.
- [`src/contract/schema/v1.json`](src/contract/schema/v1.json): contract schema.
- [`src/audit/cheat-detector/`](src/audit/cheat-detector/): detector registry.
- [`src/audit/cheat-detector/detector-sets.ts`](src/audit/cheat-detector/detector-sets.ts): default vs. experimental selection.
- [`src/audit/report-comment/detector-precision.ts`](src/audit/report-comment/detector-precision.ts): measured-precision table.
- [`src/audit/aibom/`](src/audit/aibom/): AI-BOM emitters.
- [`benchmarks/falsification-corpus/v10-synthetic-corpus/`](benchmarks/falsification-corpus/v10-synthetic-corpus/): synthetic regression corpus.
- [`benchmarks/real-corpus/`](benchmarks/real-corpus/): real-corpus baseline + labels.
- [`docs/labeling-methodology.md`](docs/labeling-methodology.md): labels-v2 rubric and kappa policy.
- [`benchmarks/leaderboard/`](benchmarks/leaderboard/): reproducible scorer.
- [`docs/shadow-mode.md`](docs/shadow-mode.md): single-file and per-repo shadow audit guide.
- [`docs/`](docs/): provider, check-type, AI-BOM, and adapter docs.
- [`CHANGELOG.md`](CHANGELOG.md): release history.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): development workflow.
- [`SECURITY.md`](SECURITY.md): vulnerability reporting.
- [`CLAUDE.md`](CLAUDE.md): maintainer architecture notes.

## Contributing

```bash
npm install
npm run build
npm test
npm run typecheck
npm run lint
npm run leaderboard
```

Project conventions in [`CLAUDE.md`](CLAUDE.md). Security disclosures via [`SECURITY.md`](SECURITY.md) (never via public issues).

## License

[ISC](LICENSE).
