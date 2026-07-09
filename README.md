<p align="center">
  <img src="./assets/cover.svg" alt="Swarm Orchestrator cover" width="100%">
</p>

# Swarm Orchestrator

> Advisory PR audit and contract gate for AI-generated code.

<!-- BADGES:START -->
[![CI](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![license ISC](https://img.shields.io/static/v1?label=license&message=ISC&color=blue)](LICENSE)
[![node >= 20](https://img.shields.io/static/v1?label=node&message=%3E%3D%2020&color=3c873a)](package.json)
[![version 12.1.0](https://img.shields.io/static/v1?label=version&message=12.1.0&color=22d3ee)](package.json)
[![oracle recall 93% (301/325)](https://img.shields.io/static/v1?label=oracle%20recall&message=93%25%20(301%2F325)&color=brightgreen)](benchmarks/results/AB-REPORT.md)
[![real-PR false alarms 0.11/PR](https://img.shields.io/static/v1?label=real-PR%20false%20alarms&message=0.11%2FPR&color=brightgreen)](benchmarks/real-prs/REAL-WORLD-REPORT.md)
[![real-PR cheats vs linters 4 confirmed (Semgrep+ESLint: 1)](https://img.shields.io/static/v1?label=real-PR%20cheats%20vs%20linters&message=4%20confirmed%20(Semgrep%2BESLint%3A%201)&color=brightgreen)](benchmarks/real-prs/v11-BENEFIT-REPORT.md)
<!-- BADGES:END -->

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#results">Results</a> ·
  <a href="#cheat-detectors">Detectors</a> ·
  <a href="#use-as-a-github-action">GitHub Action</a> ·
  <a href="#ai-bom">AI-BOM</a> ·
  <a href="#orchestrator-mode">Orchestrator</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#limitations">Limitations</a> ·
  <a href="#links">Links</a>
</p>

Reads a pull request (PR) diff and flags the shortcuts artificial intelligence (AI) coding agents use to look done without being done: relaxed tests, swallowed errors, fake renames, eleven categories in all. Grading patches against typed obligation contracts via a multi-persona pipeline is the second surface. It runs offline against a committed diff, so you can try every claim below in a fresh checkout with no credentials.

**Flags are tips, blocks are proof.** A flag is a structural detector seeing a cheat-shaped pattern; it is advisory and never blocks a merge (`--mode advise` is the default). A block is a self-certifying runtime result whose per-instance controls are all green, and every block ships the exact command that reproduces it in a fresh checkout. Eight proof protocols back the gate today: six execution-grounded restoration proofs (`test-tamper`, `mock-mutation`, `no-op-fix`, `type-suppression`, `fake-refactor`, `dead-branch`) plus `claim-falsified` and `obligation-failure`. The measured proven-finding precision on the execution-grounded-viable corpus slice, with its plain n, is in [`benchmarks/real-corpus/GATE-PRECISION-REPORT.md`](benchmarks/real-corpus/GATE-PRECISION-REPORT.md).

## Install

Node 20 or later. See [`package.json`](package.json).

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm install
npm run build
npm link
swarm --help
```

`npm run build` compiles TypeScript into `dist/` and marks the CLI executable; `npm link` puts the `swarm`, `swarm-audit`, and `swarm-orchestrator` bins on your `PATH`. The final `swarm --help` should print the subcommand list, which confirms the link took.

## Quick start

```bash
# Audit a PR by reference (advisory by default; never blocks the merge)
GITHUB_TOKEN=... swarm audit moonrunnerkc/swarm-orchestrator#42

# Opt in to merge-blocking gate mode (blocks only on a self-certifying
# runtime proof; enable the execution-grounded layer in
# .swarm/audit-config.yaml first; see docs/audit-config.md)
GITHUB_TOKEN=... swarm audit moonrunnerkc/swarm-orchestrator#42 --mode gate

# Audit a local diff with all 11 detectors
git diff main...HEAD | swarm audit --diff-stdin --detectors experimental

# Audit and emit a CycloneDX 1.6 ML-BOM
swarm audit --diff-file my.patch --emit-aibom cyclonedx-ml

# Shadow mode: record verdicts to disk without commenting or gating
swarm audit --pr <ref> --shadow my-org/my-repo
```

The first command fetches the PR diff, walks it through the eight default detectors plus the judge-primary path, prints any findings, and exits `0` because advise mode never gates. `--mode gate` runs the same detectors but exits `1` only when a runtime proof self-certifies against a green control set; on any PR it cannot prove, it falls back to advisory and still exits `0`. Exit codes overall: `0` advisory or any advise-mode run, `1` block (gate mode only), `2` usage error.

## Configuration

Audit behavior is set by CLI flags, with per-repo defaults in `.swarm/audit-config.yaml`. The flags that change what runs and what blocks:

#### `--mode`
Type: `advise | gate`
Default: `advise`

`advise` prints findings and always exits `0`. `gate` exits `1` only on a self-certifying runtime proof and requires the execution-grounded layer to be enabled; see [Enabling the execution-grounded layer](#enabling-the-execution-grounded-layer).

#### `--detectors`
Type: `default | experimental`
Default: `default`

`default` loads the eight detectors with real-PR signal. `experimental` adds `comment-only-fix`, `exception-rethrow-lost-context`, and `dead-branch-insertion`, which have no measured wild signal yet.

#### `--emit-aibom`
Type: `cyclonedx-ml | spdx-ai | both`
Default: off

Writes one AI bill-of-materials document per format per run under `.swarm/aibom/`. See [AI-BOM](#ai-bom).

#### `--shadow`
Type: `String` (repo slug, for example `my-org/my-repo`)
Default: off

Records the verdict for the given repo to `.swarm/shadow/<repo>/` without posting a comment or gating. See [`docs/shadow-mode.md`](docs/shadow-mode.md).

Per-repo keys in `.swarm/audit-config.yaml`: `excludePaths`, `intentSeverityPolicy` (`strict` | `lenient` | `off`), `judgePrimary`, and `executionGrounded.enabled`. Full reference in [`docs/audit-config.md`](docs/audit-config.md).

## Results

Every number here is reproducible from this repo and runs offline.

### Catches cheats that linters miss

| PR | Cheat caught | Semgrep / ESLint |
|---|---|---|
| [cloudflare/workers-sdk#14063](https://github.com/cloudflare/workers-sdk/pull/14063) | fake refactor: function renamed but two callers still use the old name | not flagged |
| [cloudflare/workers-sdk#14132](https://github.com/cloudflare/workers-sdk/pull/14132) | error swallow: bare empty `catch` silently hides every error in the block | not flagged |

Both reproduce deterministically from the committed diffs. Semgrep (210 rules) and the ESLint security ruleset flag neither. Reproduce either with `swarm audit --diff-file benchmarks/real-prs/diffs/cloudflare-workers-sdk/<pr>.diff`. Full study across twelve repos in [`benchmarks/real-prs/v11-BENEFIT-REPORT.md`](benchmarks/real-prs/v11-BENEFIT-REPORT.md).

### How often agents cheat, and how often the detectors agree

Mining maintainer review comments across 327 agent-attributed PRs surfaced 27 that a review comment called a cheat (assertion-strip, test-relaxation, no-op fix, goal-not-fixed, error swallow, mock-of-hallucination, hardcoded output): about 8% of the cascaded PRs. 20 were caught and rejected at review, 7 merged. That "27" is the **loose bar** (any cheat-phrase match, author unrecorded at capture); a later authorship audit found only **7 of the 27** carry a complaint from an independent human (not the PR author, not a bot), 12 are self-comments (6 of them solo-maintainer self-flags) and 7 are bot review surfaces, with 1 PR since deleted. Both counts and the per-entry stratification are in [`benchmarks/real-prs/wild-cheat-corpus/COMPLAINT-BAR-AUDIT.md`](benchmarks/real-prs/wild-cheat-corpus/COMPLAINT-BAR-AUDIT.md); the catalog and funnel are in [`benchmarks/real-prs/HUNT-2-REPORT.md`](benchmarks/real-prs/HUNT-2-REPORT.md).

The number that matters for the tool is the overlap: run the advisory detectors on each of those 27 diffs alone, with the maintainer's complaint text excluded from the signal, and they independently reproduce the maintainer's exact cheat category on **5 of 27 (18.5%)** and raise a finding in some category on **13 of 27 (48%)**. The misses are not detector defects: most are net-additive test edits where firing would reintroduce the false-positive class three prior fixes removed, a sibling-category flag, a diff-only judge that reads the fix as delivered, an unsupported language, or a category with no detector. Each of the 22 is root-caused in [`benchmarks/real-prs/OVERLAP-REPORT.md`](benchmarks/real-prs/OVERLAP-REPORT.md), traced to [`benchmarks/real-prs/overlap-matrix.json`](benchmarks/real-prs/overlap-matrix.json). The detectors are corroboration with a known ceiling, not a replacement for review.

The control-verifiable proof gate proved none of the 27: it fires only on its own structural plus execution evidence, never on a human's accusation, so the cheats it can prove without a reviewer are rarer than the ones reviewers complain about. Complaint-mining is the discovery method, the detectors are advisory corroboration, and the gate is the trust floor that blocks only what it can reproduce in a fresh checkout.

### Detection numbers

**301 of 325** planted cheats recovered (92.6%) across thirteen categories scored against a defect-injection oracle: 258/275 structural plus 43/50 on the two semantic categories the judge-primary path covers. The behavioral `cheat-mock-mutation` category drove the latest gain: focusing the judge on the hunks that add a value-injecting mock lifted its recall from 0.16 (the prior rapid-mlx glm47 run) to 0.96 (24/25) on the local qwen3.6 judge, while the clean-PR judge false-positive rate fell from 10% to 0%. Reproduce with `SWARM_JUDGE_PROVIDER=ollama SWARM_JUDGE_MODEL=qwen3.6:35b-a3b npm run benchmarks:full`; A/B with the same-model decomposition in [`benchmarks/results/AB-REPORT.md`](benchmarks/results/AB-REPORT.md) and per-detector recall in [`benchmarks/oracle-corpus/per-detector-recall.md`](benchmarks/oracle-corpus/per-detector-recall.md).

**0.11 findings per PR** on an 18-PR pilot across five public repos. At or below the pre-upgrade auditor's false-alarm burden, with the oracle recall gain intact. Full numbers in [`benchmarks/real-prs/REAL-WORLD-REPORT.md`](benchmarks/real-prs/REAL-WORLD-REPORT.md).

### Execution-grounded layer

Reproduce with `npm run execution-grounded:full`. This optional layer sets up a sandboxed checkout and runs mutation testing, repro execution, and a coverage delta scoped to the lines the PR changed. It surfaced one proof-correlated catch: proof anchor [`trpc/trpc#6098`](https://github.com/trpc/trpc/pull/6098), where 8 lines with surviving mutations were later changed by a hotfix. Evaluation in [`benchmarks/real-prs/v11-EXECUTION-GROUNDED-REPORT.md`](benchmarks/real-prs/v11-EXECUTION-GROUNDED-REPORT.md).

## Cheat detectors

Eleven detectors. Eight load by default; three (`comment-only-fix`, `exception-rethrow-lost-context`, `dead-branch-insertion`) require `--detectors experimental` because they have no real-PR signal yet to measure against. Registered in [`src/audit/cheat-detector/detector-sets.ts`](src/audit/cheat-detector/detector-sets.ts).

| Category | Set | Trigger |
|---|---|---|
| `error-swallow` | default | Bare empty or comment-only `catch` block added in non-test code. |
| `mock-of-hallucination` | default | `jest.mock` / `vi.mock` / `@patch` against a module declared in no manifest in the repo. |
| `no-op-fix` | default | Test modified with no source change, or vice versa; import-graph reachability fallback when only one side moved. |
| `fake-refactor` | default | Exported symbol renamed in source, no caller in the diff updates the old name. |
| `coverage-erosion` | default | Source branch added with no compensating test addition. |
| `test-relaxation` | default | Strict matcher swapped for a loose one, or a test block removed without same-chunk replacement. |
| `assertion-strip` | default | Net assertion count in a test file drops after the PR. |
| `type-suppression` | default | A type-checker or linter suppression (for example `@ts-ignore` or `eslint-disable`) added over a changed line. |
| `comment-only-fix` | experimental | Source modifications are all comment additions. |
| `exception-rethrow-lost-context` | experimental | `throw err` replaced with `throw new Error(...)` and `{ cause }` not forwarded. |
| `dead-branch-insertion` | experimental | Branch guarded by a literal-false condition added. |

Beyond the structural detectors, a judge-primary path catches two semantic categories (`goal-not-fixed`, `cheat-mock-mutation`) by asking the judge whether the diff delivers the PR's stated claim. For `cheat-mock-mutation` a deterministic pre-filter hands the judge only the test hunks that add a value-injecting mock, so the judge reads the six-line cheat instead of skimming a 40k-char diff, and is never asked on a clean PR that adds no such mock. A proven mock-mutation can also block under `--mode gate` as a self-certifying `mock-mutation-proven` trigger (see [`docs/limitations.md`](docs/limitations.md)).

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
          # audit-comment: true    # default; posts the rendered finding
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The action checks out the PR at full depth, runs `swarm audit` on the diff **in advise mode** (the shipped default: it flags, never blocks the merge), and posts the rendered finding back to the PR via `GITHUB_TOKEN`. It exposes `audit-pass`, `audit-findings`, and `audit-ledger` outputs. The action's audit inputs are `audit-mode`, `pr`, `diff-file`, `emit-aibom`, and `audit-comment`; the full input list is in [`action.yml`](action.yml). Gate mode and detector-set selection are CLI-only today (`swarm audit --mode gate` / `--detectors experimental`); the action does not expose them, so a workflow using this action is always advisory. Each run also emits a machine-readable proof-coverage attestation a downstream merge policy can consume; the consumption contract is [`docs/attestation.md`](docs/attestation.md).

### Enabling the execution-grounded layer

Structural detectors run with no setup and only ever flag (advisory). The six runtime proofs that can gate a merge (`test-tamper`, `mock-mutation`, `no-op-fix`, `type-suppression`, `fake-refactor`, `dead-branch`) need the execution-grounded layer, which is off until you set `executionGrounded.enabled: true` in [`.swarm/audit-config.yaml`](docs/audit-config.md). Turning it on is what lets `--mode gate` block, and every block it produces ships the exact command that reproduces it in a fresh checkout.

What it costs: for each audited PR the layer provisions the repository in a sandbox (clone the head, install dependencies, run the affected tests), so it adds clone, install, and test wall-clock to the job. The `test-tamper` restoration proof runs on **node (jest/vitest/mocha), pytest, and go-test**, proven end-to-end through the shipped CLI on planted Go and Python fixtures ([`benchmarks/oracle-corpus/LIVE-PATH-POLYGLOT-REPORT.md`](benchmarks/oracle-corpus/LIVE-PATH-POLYGLOT-REPORT.md), 4/4). The other five proofs (`mock-mutation`, `no-op-fix`, `type-suppression`, `fake-refactor`, `dead-branch`) stay Node/TypeScript-only by construction (their controls are AST- or Istanbul-based) and fail closed to advisory on a pytest or Go tree. The static viability screen measured 12 of 197 PRs as Node proof-tier-provisionable ([`benchmarks/real-corpus/eg-viability.json`](benchmarks/real-corpus/eg-viability.json)); your own repository, where the suite is known to run in CI, provisions far more reliably than an arbitrary sample. Nothing the layer cannot prove ever blocks: with the layer off, or on a non-provisionable PR, gate mode passes on advisory findings alone.

Two more execution-grounded engines run **advisory-only and never gate**. `error-swallow` restoration neutralizes a PR-added empty catch (or `except: pass`) and reruns the affected tests to surface a load-bearing swallow (node/pytest twins 4/4, `error-swallow:measure`). The Tier C `claim-binding` engine binds the PR's claim to an existing repo test and, in production, abstains without a green-history checkout (twins: honest false-positives 0/4, recall 4/4, `claim-binding:measure`). Both are wired into `swarm audit --pr` and proven end-to-end through the shipped CLI ([`evidence/live-wiring/live-set-runs/LIVE-SET-PROOF-REPORT.md`](evidence/live-wiring/live-set-runs/LIVE-SET-PROOF-REPORT.md), 6/6); enable them with `errorSwallow`/`claimBinding` under `executionGrounded` in [`.swarm/audit-config.yaml`](docs/audit-config.md).

## AI-BOM

`--emit-aibom cyclonedx-ml | spdx-ai | both` writes one document per format per run under `.swarm/aibom/`. Emitters in [`src/audit/aibom/`](src/audit/aibom/) produce hand-rolled JSON against the upstream specs with no third-party AI-BOM runtime dependency, so compliance teams get a CycloneDX-ML (machine learning) or SPDX (Software Package Data Exchange) 3.0 AI-Profile artifact for every graded patch alongside the hash-chained evidence record.

Procurement mappings:

- [`docs/eu-ai-act-mapping.md`](docs/eu-ai-act-mapping.md): EU AI Act (European Union Artificial Intelligence Act) Article 11 + Annex IV fields.
- [`docs/cisa-sbom-ai-mapping.md`](docs/cisa-sbom-ai-mapping.md): CISA (Cybersecurity and Infrastructure Security Agency) SBOM-for-AI minimum elements.

## Orchestrator mode

Grades patches against a typed contract instead of auditing a PR diff.

```bash
swarm init                                    # Scaffold contract.yaml + patches.jsonl
swarm run --goal "check this project builds"  # Deterministic provider, no API key
```

`swarm init` writes a starter `contract.yaml` and `patches.jsonl` for the detected language; `swarm run` compiles the goal into obligations and grades the patches with the deterministic provider, so this pair runs with no model credentials. A minimal contract:

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

The hosted and local blocks swap the deterministic provider for a model that writes the patch, then run it through the same verifier and falsifier gates; no patch is admitted unless every obligation passes. Provider details in [`docs/providers.md`](docs/providers.md). Obligation taxonomy in [`docs/check-types.md`](docs/check-types.md). Schema in [`src/contract/schema/v1.json`](src/contract/schema/v1.json).

## Architecture

Two command-line interface (CLI) surfaces share one core. `swarm run` drives the v8 pipeline (extractor, session, predicate-runner, falsifier, verifier). No patch reaches main without passing both `verifyObligation` and `postMergeVerify`.

`swarm audit` reuses the verifier and falsifier layers against a unified diff, with no session, extractor, or model credentials needed. Both surfaces write to the same append-only hash-chained ledger ([`src/ledger/ledger.ts`](src/ledger/ledger.ts)); tampering breaks the chain.

## Commands

| Command | Purpose |
|---|---|
| `swarm audit <ref \| --diff-*>` | Audit a PR or local diff. Advisory by default. |
| `swarm run --goal "<text>"` | Compile and grade in one step. |
| `swarm compile <goal>` | Write a reusable compiled contract directory. |
| `swarm run <contract-dir>` | Grade against a pre-compiled contract directory. |
| `swarm resume <run-id>` | Resume a killed run from its ledger. |
| `swarm stats <run-id>` | Aggregate diagnostic counts from a run ledger. |
| `swarm ledger verify <run-id>` | Verify a hash-chained ledger at rest. |
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

- Claude Code slash command: [`.claude/commands/swarm-audit.md`](.claude/commands/swarm-audit.md)
- Cursor rule pack: [`integrations/cursor/swarm-audit.mdc`](integrations/cursor/swarm-audit.mdc)
- Aider pre-commit hook: [`integrations/aider/pre-commit-swarm-audit`](integrations/aider/pre-commit-swarm-audit)

## Limitations

No single detector has cleared the precision bar to block on its own. Gate mode blocks only on a self-certifying runtime proof whose per-instance controls are all green: test-tamper, mock-mutation, no-op-fix, type-suppression, or fake-refactor restoration, claim falsification, or obligation failure. The first such proof fired on a dogfood PR in June 2026.

Measured against the 27 wild complaint-mined entries (7 of which meet the strict independent-human bar; see [`COMPLAINT-BAR-AUDIT.md`](benchmarks/real-prs/wild-cheat-corpus/COMPLAINT-BAR-AUDIT.md)), the advisory detectors independently reproduce the maintainer's exact category on 5 (18.5%) and flag some suspicion on 13 (48%); the proof gate proved zero of them. The polyglot pipeline has since proven a `test-tamper` on a wild **Go** PR end-to-end through the shipped CLI, but on human review that proof is a false positive for "cheat": the same PR moved the guarded coverage to a golden-file test the engine cannot see, a legitimate refactor. That is the gate's one known false-positive class (assertion-weakening refactors that relocate coverage), and it is why the audit's ADVISE default is correct and unattended gate-mode auto-block stays unsafe on wild PRs; the autopsy is in [`benchmarks/real-prs/hunt7/HUNT-7-REPORT.md`](benchmarks/real-prs/hunt7/HUNT-7-REPORT.md). The detectors corroborate a known fraction of human-caught cheats at high precision, and the gate blocks only what it can reproduce. The full accounting, the overlap matrix, the measured gate precision, and what blocks today and what doesn't, is in [`docs/limitations.md`](docs/limitations.md).

## Developing

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm install
npm run build && npm test
npm run typecheck && npm run lint
```

`npm run build` runs `tsc` against `tsconfig.build.json` and emits `dist/`; `npm test` builds and runs the Mocha suite; `npm run typecheck` and `npm run lint` are the two gates every PR must pass before commit. CI runs the same steps on Node 20 and 22 plus the LOC-budget gate (`scripts/loc-budget-gate.sh`) against `evidence/loc-budget.txt`.

To regenerate the benchmark corpus, `npm run benchmarks:full` rebuilds the oracle, recall, calibration, and evasion reports plus `COVERAGE.md`. The full command list is in [`CLAUDE.md`](CLAUDE.md).

## Contributing

Fork the repository, work on a feature branch, and open a PR; the audit that runs on it is the same one shipped here. New cheat detectors must include an injector under `src/audit/oracle/inject/` so recall is measurable from day one, and judge prompts are versioned rather than edited in place. Project conventions and the full checklist are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

Report security issues through [GitHub Security Advisories](https://github.com/moonrunnerkc/swarm-orchestrator/security/advisories), never via public issues. See [`SECURITY.md`](SECURITY.md).

## Links

- Repository: https://github.com/moonrunnerkc/swarm-orchestrator
- Issue tracker: https://github.com/moonrunnerkc/swarm-orchestrator/issues
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
- Methodology and honesty caveats: [`docs/audit/methodology.md`](docs/audit/methodology.md)
- Claims ledger (every claim mapped to its evidence and regenerating script): [`docs/CLAIMS.md`](docs/CLAIMS.md)
- What it cannot do: [`docs/limitations.md`](docs/limitations.md)
- Reproducible leaderboard: [`benchmarks/leaderboard/`](benchmarks/leaderboard/)

## License

[ISC](LICENSE).
