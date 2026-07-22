<p align="center">
  <img src="./assets/cover.svg" alt="Swarm Orchestrator cover" width="100%">
</p>

# Swarm Orchestrator

> Advisory PR audit and contract gate for AI-generated code.

<!-- BADGES:START -->
[![CI](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![license ISC](https://img.shields.io/static/v1?label=license&message=ISC&color=blue)](LICENSE)
[![node >= 20](https://img.shields.io/static/v1?label=node&message=%3E%3D%2020&color=3c873a)](package.json)
[![version 12.1.1](https://img.shields.io/static/v1?label=version&message=12.1.1&color=22d3ee)](package.json)
[![oracle recall 93% (303/325)](https://img.shields.io/static/v1?label=oracle%20recall&message=93%25%20(303%2F325)&color=brightgreen)](benchmarks/results/AB-REPORT.md)
<!-- BADGES:END -->

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#results">Results</a> ·
  <a href="#cheat-detectors">Detectors</a> ·
  <a href="#gate-mode">Gate mode</a> ·
  <a href="#use-as-a-github-action">GitHub Action</a> ·
  <a href="#orchestrator-mode">Orchestrator</a> ·
  <a href="#limitations">Limitations</a>
</p>

## What This Does

Reads a pull request diff and flags the shortcuts AI coding agents use to
look done without being done: relaxed tests, swallowed errors, fake renames,
eleven categories in all. Flags are advisory and never gate; a block requires
a self-certifying runtime proof whose per-instance controls are all green,
and every block ships the exact command that reproduces it in a fresh
checkout. A second surface grades patches against typed obligation contracts,
and both run offline with no credentials, so every number below reproduces
from a clone of this repo.

<p align="center">
  <img src="./assets/audit-demo.gif" alt="swarm audit flagging a real error-swallow finding in cloudflare/workers-sdk PR 14132" width="100%">
</p>

Real finding from [cloudflare/workers-sdk#14132](https://github.com/cloudflare/workers-sdk/pull/14132);
reproduce it from a clone with
`swarm audit --diff-file benchmarks/real-prs/diffs/cloudflare-workers-sdk/14132.diff`.

## Install

Node 20 or later. See [`package.json`](package.json).

```bash
npm i -g swarm-orchestrator
swarm --help
```

The tarball ships the compiled audit CLI plus its three bins (`swarm`,
`swarm-audit`, `swarm-orchestrator`); `swarm --help` printing the subcommand
list confirms the install took. To work on the source, or to reproduce the
benchmark numbers below, clone the repo instead: see [Developing](#developing).

## Quick start

```bash
# No credentials: audit a local diff with all 11 detectors
git diff main...HEAD | swarm audit --diff-stdin --detectors experimental

# Requires GITHUB_TOKEN: audit a PR by reference (advisory by default;
# never blocks the merge)
GITHUB_TOKEN=... swarm audit moonrunnerkc/swarm-orchestrator#42

# Opt in to merge-blocking gate mode (blocks only on a self-certifying
# runtime proof; see docs/execution-grounded.md)
GITHUB_TOKEN=... swarm audit moonrunnerkc/swarm-orchestrator#42 --mode gate
```

Exit codes: `0` advisory or any advise-mode run, `1` block (gate mode only),
`2` usage error. On any PR gate mode cannot prove, it falls back to advisory
and still exits `0`.

## Configuration

| Flag | Values | Default | What it changes |
|---|---|---|---|
| `--mode` | `advise` \| `gate` | `advise` | `advise` prints findings and always exits `0`; `gate` exits `1` only on a self-certifying runtime proof and requires the [execution-grounded layer](docs/execution-grounded.md). |
| `--detectors` | `default` \| `experimental` | `default` | `default` loads the eight detectors with real-PR signal; `experimental` adds the three with no measured wild signal yet. |
| `--emit-aibom` | `cyclonedx-ml` \| `spdx-ai` \| `both` | off | Writes one AI-BOM document per format per run under `.swarm/aibom/`. See [AI-BOM](#ai-bom). |
| `--shadow` | repo slug | off | Records the verdict to `.swarm/shadow/<repo>/` without commenting or gating. See [`docs/shadow-mode.md`](docs/shadow-mode.md). |

Per-repo defaults live in `.swarm/audit-config.yaml` (`excludePaths`,
`intentSeverityPolicy`, `judgePrimary`, `executionGrounded`); the full key
reference and the run-artifact paths under `.swarm/` are in
[`docs/audit-config.md`](docs/audit-config.md).

## Results

Every number reproduces offline from a clone of this repo. The full
claim-to-evidence map, with the regenerating command for each artifact, is
[`docs/CLAIMS.md`](docs/CLAIMS.md).

| Result | Number | Evidence |
|---|---|---|
| Planted cheats recovered against the defect-injection oracle | 303/325 (93.2%) across 13 categories | [`AB-REPORT.md`](benchmarks/results/AB-REPORT.md), [`per-detector-recall.md`](benchmarks/oracle-corpus/per-detector-recall.md) |
| False-alarm burden on an 18-PR pilot across five public repos | 0.11 findings/PR | [`REAL-WORLD-REPORT.md`](benchmarks/real-prs/REAL-WORLD-REPORT.md) |
| Confirmed real-PR cheats across twelve repos, vs findings from Semgrep (210 rules) + the ESLint security ruleset on the same PRs | 4 confirmed (linters: 1) | [`v11-BENEFIT-REPORT.md`](benchmarks/real-prs/v11-BENEFIT-REPORT.md) |
| Wild maintainer-flagged cheats the advisory detectors independently reproduce | exact category 5/27, any finding 13/27 | [`OVERLAP-REPORT.md`](benchmarks/real-prs/OVERLAP-REPORT.md), [`COMPLAINT-BAR-AUDIT.md`](benchmarks/real-prs/wild-cheat-corpus/COMPLAINT-BAR-AUDIT.md) |
| Execution-grounded proof-correlated catch | [`trpc/trpc#6098`](https://github.com/trpc/trpc/pull/6098): 8 lines with surviving mutations, later hotfixed | [`v11-EXECUTION-GROUNDED-REPORT.md`](benchmarks/real-prs/v11-EXECUTION-GROUNDED-REPORT.md) |

Two of the linter-missed cheats reproduce deterministically from committed
diffs: [cloudflare/workers-sdk#14063](https://github.com/cloudflare/workers-sdk/pull/14063)
(fake refactor, callers left on the old name) and
[#14132](https://github.com/cloudflare/workers-sdk/pull/14132) (bare empty
`catch`). Run `swarm audit --diff-file
benchmarks/real-prs/diffs/cloudflare-workers-sdk/<pr>.diff` from a clone.
The oracle numbers regenerate with `npm run benchmarks:full` (judge
environment pinned by [`benchmarks/judge-env.json`](benchmarks/judge-env.json)).

## Cheat detectors

Eleven detectors. Eight load by default; three (`comment-only-fix`,
`exception-rethrow-lost-context`, `dead-branch-insertion`) require
`--detectors experimental` because they have no real-PR signal yet to measure
against. Registered in
[`src/audit/cheat-detector/detector-sets.ts`](src/audit/cheat-detector/detector-sets.ts).

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

Beyond the structural detectors, a judge-primary path covers two semantic
categories (`goal-not-fixed`, `cheat-mock-mutation`) that no structural
detector keys on, by asking the judge whether the diff delivers the PR's
stated claim. A proven mock-mutation can also block under `--mode gate`; see
[Gate mode](#gate-mode).

## Gate mode

`--mode advise` (the default) only ever flags. `--mode gate` can block, and
blocks only on a self-certifying runtime proof produced by the opt-in
execution-grounded layer: the PR is provisioned in a sandbox, a restoration
proof runs against it with per-instance controls, and every block ships the
exact command that reproduces it in a fresh checkout. Eight proof protocols
back the gate today; setup, costs, language support, and the measured
proven-finding precision are in
[`docs/execution-grounded.md`](docs/execution-grounded.md).

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
      - uses: moonrunnerkc/swarm-orchestrator@v12.1.1
        with:
          audit-mode: true
          emit-aibom: cyclonedx-ml
          # audit-comment: true    # default; posts the rendered finding
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The action checks out the PR at full depth, runs `swarm audit` on the diff in
advise mode (it flags, never blocks), and posts the rendered finding back to
the PR via `GITHUB_TOKEN`. It exposes `audit-pass`, `audit-findings`, and
`audit-ledger` outputs; the full input list is in [`action.yml`](action.yml).
Gate mode and detector-set selection are CLI-only today, so a workflow using
this action is always advisory. Each run also emits a machine-readable
proof-coverage attestation a downstream merge policy can consume; the
consumption contract is [`docs/attestation.md`](docs/attestation.md).

## AI-BOM

`--emit-aibom cyclonedx-ml | spdx-ai | both` writes one document per format
per run under `.swarm/aibom/`. The emitters
([`src/audit/aibom/`](src/audit/aibom/)) produce hand-rolled JSON against the
upstream CycloneDX 1.6 ML-BOM and SPDX 3.0 AI-Profile specs with no
third-party AI-BOM runtime dependency. Procurement mappings:
[`docs/eu-ai-act-mapping.md`](docs/eu-ai-act-mapping.md) (EU AI Act
Article 11 + Annex IV) and
[`docs/cisa-sbom-ai-mapping.md`](docs/cisa-sbom-ai-mapping.md) (CISA
SBOM-for-AI minimum elements).

## Orchestrator mode

Grades patches against a typed contract instead of auditing a PR diff.

```bash
swarm init                                    # Scaffold contract.yaml + patches.jsonl
swarm run --goal "check this project builds"  # Deterministic provider, no API key
```

A minimal contract:

```yaml
obligations:
  - type: build-must-pass
    command: npm run build
  - type: test-must-pass
    command: npm test
```

`swarm run` compiles the goal into obligations and grades the patches; no
patch is admitted unless every obligation passes. Hosted-model (Anthropic)
and local-LLM (Ollama, llama-cpp, vLLM) runs swap in a model that writes the
patch and go through the same verifier and falsifier gates: commands in
[`docs/providers.md`](docs/providers.md), obligation taxonomy in
[`docs/check-types.md`](docs/check-types.md), schema in
[`src/contract/schema/v1.json`](src/contract/schema/v1.json).

## Architecture

Two command-line interface (CLI) surfaces share one core. `swarm run` drives
the v8 pipeline (extractor, session, predicate-runner, falsifier, verifier).
No patch reaches main without passing both `verifyObligation` and
`postMergeVerify`.

`swarm audit` reuses the verifier and falsifier layers against a unified
diff, with no session, extractor, or model credentials needed. Both surfaces
write to the same append-only hash-chained ledger
([`src/ledger/ledger.ts`](src/ledger/ledger.ts)); tampering breaks the chain.

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

## Integrations

- Claude Code slash command: [`.claude/commands/swarm-audit.md`](.claude/commands/swarm-audit.md)
- Cursor rule pack: [`integrations/cursor/swarm-audit.mdc`](integrations/cursor/swarm-audit.mdc)
- Aider pre-commit hook: [`integrations/aider/pre-commit-swarm-audit`](integrations/aider/pre-commit-swarm-audit)

## Limitations

No single advisory detector has cleared the precision bar to block on its
own; gate mode blocks only on a self-certifying runtime proof, and the first
such proof fired on a dogfood PR in June 2026. Against the 27 wild
complaint-mined cheats (7 of which meet the strict independent-human bar; see
[`COMPLAINT-BAR-AUDIT.md`](benchmarks/real-prs/wild-cheat-corpus/COMPLAINT-BAR-AUDIT.md)),
the advisory detectors reproduce the maintainer's exact category on 5 and
flag some suspicion on 13, and the proof gate proved zero of them. The gate's
one known false-positive class is the assertion-weakening refactor that
relocates coverage ([`HUNT-7-REPORT.md`](benchmarks/real-prs/hunt7/HUNT-7-REPORT.md)),
which is why advise stays the default and unattended gate-mode auto-block
stays unsafe on wild PRs. The full accounting, the overlap matrix, the
measured gate precision, and what blocks today and what doesn't, is in
[`docs/limitations.md`](docs/limitations.md).

## Developing

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm install
npm run build && npm test
npm run typecheck && npm run lint
```

`npm run typecheck` and `npm run lint` are the two gates every PR must pass
before commit; CI runs the same steps on Node 20 and 22 plus the LOC-budget
gate. `npm run benchmarks:full` regenerates the benchmark corpus and
reports; the full command list is in [`CLAUDE.md`](CLAUDE.md).

## Contributing

Fork the repository, work on a feature branch, and open a PR; the audit that
runs on it is the same one shipped here. New cheat detectors must include an
injector under `src/audit/oracle/inject/` so recall is measurable from day
one, and judge prompts are versioned rather than edited in place. Project
conventions and the full checklist are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

Report security issues through
[GitHub Security Advisories](https://github.com/moonrunnerkc/swarm-orchestrator/security/advisories),
never via public issues. See [`SECURITY.md`](SECURITY.md).

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
