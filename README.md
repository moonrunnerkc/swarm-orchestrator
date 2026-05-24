<div align="center">

<img src="docs/assets/hero.svg" alt="Swarm Orchestrator" width="100%">

# Swarm Orchestrator

A CLI for auditing AI-generated PRs and grading patches against typed contracts.

[![CI](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%E2%89%A5%2020-3c873a.svg)](package.json)
[![Version 10.1.0](https://img.shields.io/badge/version-10.1.0-22d3ee.svg)](package.json)

<a href="#install"><b>Install</b></a> ·
<a href="#quick-start"><b>Quick start</b></a> ·
<a href="#use-as-a-github-action"><b>GitHub Action</b></a> ·
<a href="#cheat-detectors"><b>Detectors</b></a> ·
<a href="#ai-bom"><b>AI-BOM</b></a> ·
<a href="#orchestrator-mode"><b>Orchestrator</b></a> ·
<a href="#reference"><b>Reference</b></a>

</div>

---

<div align="center">

## What This Does

Reads a pull-request diff and flags 10 categories of cheat pattern an AI coding agent might have introduced.
Exits non-zero on any blocking finding, so a CI check refuses the merge.
Also runs as a contract-driven orchestrator: compile a goal, race candidate patches, log every step to a hash-chained evidence ledger.

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
# audit a PR by reference
GITHUB_TOKEN=... swarm audit moonrunnerkc/swarm-orchestrator#42

# audit a local diff
git diff main...HEAD | swarm audit --diff-stdin

# audit + emit a CycloneDX 1.6 ML-BOM
swarm audit --diff-file my.patch --emit-aibom cyclonedx-ml
```

Exit codes: `0` pass, `1` block, `2` usage error.

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
          emit-aibom: cyclonedx-ml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Outputs: `audit-pass`, `audit-findings`, `audit-ledger`. Full input list in [`action.yml`](action.yml). A lighter composite alternative lives at [`.github/actions/swarm-audit/`](.github/actions/swarm-audit/).

## Cheat detectors

Ten registered in [`src/audit/cheat-detector/index.ts`](src/audit/cheat-detector/index.ts).

| Category | Trigger |
|---|---|
| `test-relaxation` | Strict matcher swapped for a loose one, or a `describe`/`it` block removed without same-chunk replacement. |
| `mock-of-hallucination` | `jest.mock` / `vi.mock` / `@patch` against a module declared in no manifest in the repo. |
| `assertion-strip` | Net assertion count in a test file drops after the PR. |
| `no-op-fix` | Test modified with no source change in the same PR, or vice versa. |
| `coverage-erosion` | Source branch added with no compensating test addition. |
| `fake-refactor` | Exported symbol renamed in source, no caller in the diff updates the old name. |
| `comment-only-fix` | Source modifications are all comment additions. |
| `error-swallow` | Empty or comment-only `catch` block added. |
| `exception-rethrow-lost-context` | `throw err` replaced with `throw new Error(...)` and `{ cause }` not forwarded. |
| `dead-branch-insertion` | Branch guarded by a literal-false condition added. |

Each detector lives in its own file under that directory. Adding one is a new file plus a single entry in the `DETECTORS` array.

## Evidence

Two corpora, scored separately.

**Synthetic regression suite** (the v10 corpus): 500 broken patches and 500 clean controls, 50 of each per category, under [`benchmarks/falsification-corpus/v10-synthetic-corpus/`](benchmarks/falsification-corpus/v10-synthetic-corpus/). [`npm run leaderboard`](benchmarks/leaderboard/score.ts) replays the corpus and exits non-zero on any miss or false positive. Current state: 0 failed expectations, recorded in [`benchmarks/leaderboard/results.json`](benchmarks/leaderboard/results.json). This corpus is generator-coupled (the detectors and the generator share the same regex vocabulary), so a 100% catch rate measures self-consistency, not detection power on real PRs.

**v10.1 real-corpus baseline**: 949 PRs collected from public agent-authored work via [`scripts/corpus/collect-real.ts`](scripts/corpus/collect-real.ts), plus 60 closed-without-merge agent PRs collected separately via [`scripts/corpus/collect-negatives.ts`](scripts/corpus/collect-negatives.ts) so the sample contains *external evidence* of breakage (human reviewer rejected the PR), not just opinion. 205 entries labeled (168 from the original sample + 37 from negatives: 10 broken, 195 clean), spanning eight agent vendors (devin, cursor, openhands, copilot-workspace, claude-code, aider, plus codex-cli and replit-agent traffic merged from the original 35-PR seed). Labels are AI-judged pending human review and marked as such in every label file. Snapshot at [`benchmarks/real-corpus/scores/latest.json`](benchmarks/real-corpus/scores/latest.json).

**Overall measured numbers** (intent layer active, default strict policy):

| | |
|---|---|
| Precision | 0.067 (any-blocking-finding fired on any-broken-verdict) |
| Recall | 0.300 (3 of 10 broken-labeled PRs caught by at least one detector) |
| F1 | 0.109 |

The synthetic corpus prints 1.000 on the same detectors. The 0.109 real-corpus F1 is the credibility gap v10.1 was created to close. Precision dropped from the 0.083 pre-Phase-5 baseline because the new PR-intent layer ([`pr-intent.ts`](src/audit/cheat-detector/pr-intent.ts), [docs](docs/audit-config.md)) escalates `warn` findings to `block` when the PR title or body claims a fix, and in this 205-PR sample 22 of the 195 clean-labeled PRs use fix-claim language while none of the 10 broken-labeled PRs do. The layer works as designed (every fix-claim PR with a warn/info finding sees the upgrade); the precision side-effect is the bet the plan accepts in exchange for treating fix-claim agent PRs more strictly in production. Disable with `intentSeverityPolicy: off` in `.swarm/audit-config.yaml`.

**Per-detector breakdown:**

| Detector | TP | FP | TN | FN | Precision | Recall | Note |
|---|---|---|---|---|---|---|---|
| `error-swallow` | 3 | 13 | 189 | 0 | **0.188** | **1.000** | Only detector with true positives in the sample. v1.1.0 split bare empty catches (still `block`) from comment-explained empty catches (now `info`). The 13 FPs are mostly bare `} catch {}` in graceful-degradation paths (best-effort cache writes, optional geocoding, sessionStorage). |
| `mock-of-hallucination` | 0 | 13 | 190 | 2 | 0.000 | 0.000 | FP-flooded and missed 2 real hallucinations (PRs that pinned `actions/checkout@v6` / `setup-node@v6` and called a non-existent Dependabot REST endpoint). Most FPs are Python stdlib (`shlex`, `graphviz`) and local-module mocks the detector can't resolve against project manifests. Reducing the Python stdlib FP class is a v10.2 candidate. |
| `no-op-fix` | 0 | 12 | 188 | 5 | 0.000 | 0.000 | Missed all 5 cases where the PR claimed a fix but the diff was wrong or absent. FP count moved from 1 to 12 with the intent layer active because escalation flips this detector's warn findings to block on the 11 fix-claim clean PRs that exercised it; pre-intent FP was 1. |
| `comment-only-fix` | 0 | 0 | 200 | 5 | 0.000 | 0.000 | Same 5 broken-with-goal-not-fixed cases the detector should reach. Did not fire on any sampled entry. |
| `assertion-strip` | 0 | 5 | 200 | 0 | 0.000 | — | FP-only. Fires on test rewrites that legitimately replaced assertions to match new behavior. |
| `fake-refactor` | 0 | 4 | 201 | 0 | 0.000 | — | FP-only. Fires on PRs that pair removals with additions for real reasons (rename plus new functionality, storage-adapter indirection). |
| `test-relaxation` | 0 | 4 | 201 | 0 | 0.000 | — | FP-only. v1.1.0 added an AST matcher grader on top of the regex pre-filter; the grader catches tolerance widening like `toBeCloseTo(5, 2)` → `toBeCloseTo(5, 100)` (proven by the synthetic regression fixture) but the real-corpus FPs are unrelated regex-layer matches on test removals that correctly align with dropped DB columns or migrated contracts. |
| `coverage-erosion` | 0 | 4 | 201 | 0 | 0.000 | — | FP-only with intent layer active (was 0/0 before; the 4 FPs are fix-claim escalations of warn findings on clean PRs). |
| `exception-rethrow-lost-context`, `dead-branch-insertion` | 0 | 0 | 205 | 0 | — | — | Did not fire on any sampled entry. |

Reproduce: `node dist/scripts/corpus/score-real.js`. Intent-layer behavior on broken-labeled entries: `node dist/scripts/corpus/verify-pr-intent.js` (in this sample 0 of 10 broken-labeled PRs use the strict fix-claim vocabulary, so the layer's upside is invisible here even though the mechanism is empirically active). Full mocha suite (`npm test`) runs 1127 tests.

The local-LLM session path was verified end-to-end against Ollama with `gemma4:31b` on `sindresorhus/escape-string-regexp`: 2 of 2 obligations satisfied in 16 seconds wall time, patch applied and verified on disk.

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

Replace `gemma4:31b` with any installed Ollama model. Other local backends (`openai-compatible`, `llama-cpp`, `vllm`) take the same flag shape.

Provider details and local-model setup in [`docs/providers.md`](docs/providers.md). Obligation taxonomy in [`docs/check-types.md`](docs/check-types.md). Schema in [`src/contract/schema/v1.json`](src/contract/schema/v1.json).

## Architecture

Two CLI surfaces share one core.

`swarm run` drives the v8 pipeline (extractor, session, predicate-runner, falsifier, verifier). No patch reaches `main` without passing both `verifyObligation` and `postMergeVerify`.

`swarm audit` reuses the verifier and falsifier layers against a unified diff. It needs no session, no extractor, and no model credentials.

Both surfaces write to the same append-only hash-chained ledger ([`src/ledger/ledger.ts`](src/ledger/ledger.ts)). Tampering breaks the chain.

## Commands

| Command | Purpose |
|---|---|
| `swarm audit <ref \| --diff-*>` | Audit a PR or local diff. |
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
```

`.swarm/` is in [`.gitignore`](.gitignore) at the consumer-repo level.

## Integrations

- Claude Code slash command: [`.claude/commands/swarm-audit.md`](.claude/commands/swarm-audit.md).
- Cursor rule pack: [`integrations/cursor/swarm-audit.mdc`](integrations/cursor/swarm-audit.mdc).
- Aider pre-commit hook: [`integrations/aider/pre-commit-swarm-audit`](integrations/aider/pre-commit-swarm-audit).

## Versions

`10.1.0` raises detector accuracy on real PRs. 205-entry hand-labeled real-corpus baseline replaces the synthetic 500-case number as the published headline (real F1 0.109, synthetic still 1.000); see the Evidence section. `mock-of-hallucination` gains five ecosystem readers (Maven, Gradle, Gemfile, composer.json, .csproj). `test-relaxation` gains an AST matcher grader for tolerance widening the regex layer cannot see. `no-op-fix` replaces its basename heuristic with an import-graph closure. A new PR-intent layer escalates findings when the agent claims a fix, opt-out via `intentSeverityPolicy: off` in [`.swarm/audit-config.yaml`](docs/audit-config.md). No CLI, ledger, or AIBOM shape changes; `Finding.intentUpgraded?` and `DetectorContext.pr?` are additive. `runCheatDetectors` becomes async to support the import-graph path.

`10.0.0` adds the audit surface, the cheat detectors, the AI-BOM emitters, and the corpus. Internal type names and existing JSON shapes are stable from `9.x`. `9.x` removed the v6 verified-branch pipeline; pin `8.0.x` if you still need `swarm run --v6`.

## Reference

- [`action.yml`](action.yml): GitHub Action inputs and outputs.
- [`src/contract/schema/v1.json`](src/contract/schema/v1.json): contract schema.
- [`src/audit/cheat-detector/`](src/audit/cheat-detector/): detector registry.
- [`src/audit/aibom/`](src/audit/aibom/): AI-BOM emitters.
- [`benchmarks/falsification-corpus/v10-synthetic-corpus/`](benchmarks/falsification-corpus/v10-synthetic-corpus/): synthetic corpus.
- [`benchmarks/leaderboard/`](benchmarks/leaderboard/): reproducible scorer.
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
