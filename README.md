<div align="center">

<img src="docs/assets/hero.svg" alt="Swarm Orchestrator" width="100%">

# Swarm Orchestrator

A CLI for auditing AI-generated PRs and grading patches against typed contracts.

<!-- BADGES:START -->
[![CI](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![license ISC](https://img.shields.io/static/v1?label=license&message=ISC&color=blue)](LICENSE)
[![node >= 20](https://img.shields.io/static/v1?label=node&message=%3E%3D%2020&color=3c873a)](package.json)
[![version 11.2.0](https://img.shields.io/static/v1?label=version&message=11.2.0&color=22d3ee)](package.json)
[![oracle recall 84% (253/300)](https://img.shields.io/static/v1?label=oracle%20recall&message=84%25%20(253%2F300)&color=brightgreen)](benchmarks/results/AB-REPORT.md)
[![real-PR false alarms 0.11/PR](https://img.shields.io/static/v1?label=real-PR%20false%20alarms&message=0.11%2FPR&color=brightgreen)](benchmarks/real-prs/REAL-WORLD-REPORT.md)
[![real-PR cheats vs linters 4 confirmed (Semgrep+ESLint: 1)](https://img.shields.io/static/v1?label=real-PR%20cheats%20vs%20linters&message=4%20confirmed%20(Semgrep%2BESLint%3A%201)&color=brightgreen)](benchmarks/real-prs/v11-BENEFIT-REPORT.md)
<!-- BADGES:END -->

<a href="#install"><b>Install</b></a> ·
<a href="#quick-start"><b>Quick start</b></a> ·
<a href="#what-this-does"><b>What it does</b></a> ·
<a href="#results"><b>Results</b></a> ·
<a href="#cheat-detectors"><b>Detectors</b></a> ·
<a href="#ai-bom"><b>AI-BOM</b></a> ·
<a href="#reference"><b>Reference</b></a>

</div>

---

<div align="center">

## What This Does

Swarm Orchestrator reads a pull-request diff and flags the shortcuts an AI coding agent takes to look done without being done: relaxed tests, stripped assertions, swallowed errors, fake renames, eleven checks in all.
On a benchmark of planted cheats it recovers 253 of 300 (84%, up 20.5% from the prior version), and on real merged Cloudflare PRs it caught two cheats that Semgrep and the ESLint security rules missed, both reproducible offline.
Findings are advisory by default, so it never blocks a merge unless you turn that on.

</div>

## Who it's for

- You review AI-written PRs at volume and want a "this change may be gaming the tests" signal that ordinary linters do not give you.
- You have to hand over AI-procurement or compliance paperwork (EU AI Act Annex IV, CISA SBOM-for-AI) and would rather generate the documents than write them by hand.
- You run AI coding agents and want one hard rule: a patch lands only if it builds, passes tests, holds a stated property, and survives a falsifier trying to break it.

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

# opt in to merge-blocking gate mode (blocks only on a self-certifying
# runtime proof; enable the execution-grounded layer in
# .swarm/audit-config.yaml first, see docs/audit-config.md)
GITHUB_TOKEN=... swarm audit moonrunnerkc/swarm-orchestrator#42 --mode gate

# audit a local diff with the experimental detector set (all 11 detectors)
git diff main...HEAD | swarm audit --diff-stdin --detectors experimental

# audit + emit a CycloneDX 1.6 ML-BOM
swarm audit --diff-file my.patch --emit-aibom cyclonedx-ml

# shadow-mode dogfood: record verdicts to disk, no comment, no gate
swarm audit --pr <ref> --shadow my-org/my-repo

# single-file shadow output (one JSON per audit invocation; see docs/shadow-mode.md)
swarm audit --pr <ref> --shadow-output ./audit-verdict.json
```

Exit codes: `0` advisory-clean or any advise-mode run, `1` block (gate mode only), `2` usage error.

## Results

Every number here is reproducible from this repo, runs offline, and points at the report that produced it.

### Catches cheats that linters miss

Two real cheats in merged Cloudflare PRs reproduce deterministically offline from the committed diffs, and a live differential confirms that Semgrep (210 rules) and the ESLint security ruleset flag neither:

| PR | Cheat it caught | Semgrep / ESLint |
|---|---|---|
| [cloudflare/workers-sdk#14063](https://github.com/cloudflare/workers-sdk/pull/14063) | fake refactor: a function was renamed but two callers still call the old name | not flagged |
| [cloudflare/workers-sdk#14132](https://github.com/cloudflare/workers-sdk/pull/14132) | error swallow: a bare empty `catch` silently hides every error in the block | not flagged |

This is the cheat class ordinary analyzers do not model: they look for dangerous APIs, not for tests quietly relaxed or errors quietly dropped. Reproduce either catch with `swarm audit --diff-file benchmarks/real-prs/diffs/cloudflare-workers-sdk/<pr>.diff`. The broader study across twelve repos, with findings classified by two independent model families plus the full false-alarm accounting, is in [`benchmarks/real-prs/v11-BENEFIT-REPORT.md`](benchmarks/real-prs/v11-BENEFIT-REPORT.md); two further error-swallow catches in that report came from the pre-upgrade detector flagging comment-only `// skip` catches, which the current version downgrades as usually legitimate.

### Measured detection, not asserted

Detection is scored against a defect-injection oracle: an injector splices one labeled cheat into a presumed-clean real PR, so recall is measured against ground truth rather than claimed. The auditor recovers **253 of 300** planted cheats (**84%**), up **20.5%** from the pre-upgrade baseline of 210/300, across twelve categories. Most structural detectors sit at or near 1.00 recall on their own injection class. Reproduce with `npm run benchmarks:full`; the pre/post A/B is in [`benchmarks/results/AB-REPORT.md`](benchmarks/results/AB-REPORT.md) and the per-detector table is in [`benchmarks/oracle-corpus/per-detector-recall.md`](benchmarks/oracle-corpus/per-detector-recall.md).

### Low noise on unbiased real PRs

On an 18-PR pilot across five public repos, the post-upgrade auditor's false-alarm burden is **0.11 findings per PR**, at or below the pre-upgrade auditor's, with the oracle recall gain intact ([`benchmarks/real-prs/REAL-WORLD-REPORT.md`](benchmarks/real-prs/REAL-WORLD-REPORT.md)).

### A signal no diff-reader can produce

An optional execution-grounded layer provisions a sandboxed checkout and runs diff-scoped mutation testing, issue-linked repro, and a coverage delta, then correlates the findings against each PR's revert and hotfix history. It surfaced one under-constrained change the diff-only layers cannot see: proof anchor [`trpc/trpc#6098`](https://github.com/trpc/trpc/pull/6098), where mutations survived on covered lines and eight of those lines are the ones the later hotfix changed. Reproduce with `npm run execution-grounded:full` ([`benchmarks/real-prs/v11-EXECUTION-GROUNDED-REPORT.md`](benchmarks/real-prs/v11-EXECUTION-GROUNDED-REPORT.md)).

## Cheat detectors

Eleven detectors. Eight load by default; three (`comment-only-fix`,
`exception-rethrow-lost-context`, `dead-branch-insertion`) require
`--detectors experimental` because they have never fired on real PR
data, so there is no signal to gauge them against. The set governs which
detectors load; the precision gate (see [Limitations and what's next](#limitations-and-whats-next))
governs which may emit a blocking finding. Registered in
[`src/audit/cheat-detector/detector-sets.ts`](src/audit/cheat-detector/detector-sets.ts).

| Category | Set | Trigger |
|---|---|---|
| `error-swallow` | default | Bare empty or comment-only `catch` block added in non-test code. |
| `mock-of-hallucination` | default | `jest.mock` / `vi.mock` / `@patch` against a module declared in no manifest in the repo. |
| `no-op-fix` | default | Test modified with no source change in the same PR, or vice versa; import-graph reachability fallback when only one side moved. |
| `fake-refactor` | default | Exported symbol renamed in source, no caller in the diff updates the old name. |
| `coverage-erosion` | default | Source branch added with no compensating test addition. |
| `test-relaxation` | default | Strict matcher swapped for a loose one, or a test block removed without same-chunk replacement. |
| `assertion-strip` | default | Net assertion count in a test file drops after the PR. |
| `type-suppression` | default | A type-checker or linter suppression (for example `@ts-ignore` or `eslint-disable`) added over a changed line. |
| `comment-only-fix` | experimental | Source modifications are all comment additions. |
| `exception-rethrow-lost-context` | experimental | `throw err` replaced with `throw new Error(...)` and `{ cause }` not forwarded. |
| `dead-branch-insertion` | experimental | Branch guarded by a literal-false condition added. |

Each detector lives in its own file under [`src/audit/cheat-detector/`](src/audit/cheat-detector/).

Beyond the ten structural detectors, a judge-primary path catches two
semantic categories (`goal-not-fixed`, `cheat-mock-mutation`) that have no
structural tell, by asking the judge whether the diff delivers the PR's
stated claim. Large diffs are split into hunk-grouped chunks rather than
head-truncated, so a defect in the tail still reaches the judge.

Per-repo configuration in `.swarm/audit-config.yaml`: `excludePaths` exempts
globs from detection, `intentSeverityPolicy` (`strict` | `lenient` | `off`)
controls the PR-intent severity-upgrade layer, and `judgePrimary`
(`enabled`, `categories`) controls the semantic path. See
[`docs/audit-config.md`](docs/audit-config.md).

### Reproducible evaluation

Detection is measured against a defect-injection oracle, not asserted: an
injector splices one labeled cheat into a presumed-clean real PR, and
`npm run benchmarks:full` regenerates per-detector recall, judge
calibration, tail-defect and evasion reports, and `COVERAGE.md`. The pre
vs post A/B is in
[`benchmarks/results/AB-REPORT.md`](benchmarks/results/AB-REPORT.md); the
method and honesty caveats are in
[`docs/audit/methodology.md`](docs/audit/methodology.md).

Hunk-grouped chunking and per-hunk localization are infrastructure, not
shipped recall wins: their mechanism tests pass, but on the current judge
the tail-defect and per-hunk recall numbers stay low (a localized confirm
prompt lifts tail-defect to 0.5 in measurement but is not shipped pending
real-PR false-positive validation). The numbers are reported honestly in
`benchmarks/oracle-corpus/tail-defect-recovery.md` and
`per-hunk-localization.md`.

The auditor is also validated on unbiased real PRs: `npm run real-prs:full`
fetches recent merged PRs from public repos, audits them, and has an
independent arbiter classify every finding. On an 18-PR pilot the
post-upgrade false-alarm burden is 0.11 per PR, at or below the pre-upgrade
auditor's, with the oracle recall gain intact
([`benchmarks/real-prs/REAL-WORLD-REPORT.md`](benchmarks/real-prs/REAL-WORLD-REPORT.md)).

The optional execution-grounded layer is evaluated separately: `npm run
execution-grounded:full` provisions a sandboxed checkout of each corpus PR
and runs diff-scoped mutation testing, issue-linked repro execution, and a
coverage delta, then correlates the findings against each PR's revert/hotfix
proof. It surfaces under-constrained changed lines that no diff-only tool can
see (proof anchor `trpc/trpc#6098`: 10 mutants surviving on covered lines plus
6 on uncovered lines, 8 of them on the lines the hotfix later changed), where
the repo's test suite discriminates in a generic sandbox. This is a modest,
honest result (1 proof-correlated catch in the sampled corpus, against a 0.929
advisory-findings-per-clean-PR burden since v11.2 aggregated the
uncovered-survivor floods per file; 3.357 before), measured rather than
asserted; the
per-repo viability and the headline numbers are in
[`benchmarks/real-prs/v11-EXECUTION-GROUNDED-REPORT.md`](benchmarks/real-prs/v11-EXECUTION-GROUNDED-REPORT.md).

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

`10.3.0-advisory` finishes the four solo-doable items left after
`10.2.0-advisory`. `no-op-fix` bumps to 2.0.0 with a gated Anthropic
Haiku judge (off by default; opt in with `--enable-llm-judge` or
`SWARM_AUDIT_LLM_JUDGE=1`), content-addressed cache at
`.swarm/llm-judge-cache/`, and a new `llm-judge-result` ledger entry
that pins the model id so replay is deterministic. The real-corpus
baseline is re-scored against the v2.0 detectors: overall F1 0.167
(P 0.100, R 0.500), with `mock-of-hallucination` picking up 2 TPs the
v1.x shape missed. A static dashboard fetches the score snapshot
directly and publishes via GitHub Pages
([moonrunnerkc.github.io/swarm-orchestrator](https://moonrunnerkc.github.io/swarm-orchestrator/docs/leaderboard/)).
`--shadow-output <path>` writes one JSON object per audit with
detector verdicts, judge invocation count, and the rendered comment;
the existing `--shadow <repo-label>` per-repo rollup remains. No
detector clears the promotion gate, so all ten stay advisory-only. (The
v10 cycle gated on F1 >= 0.5; that criterion was superseded by precision
>= 0.90 with a minimum true-positive count, the single bar stated under
[Limitations and what's next](#limitations-and-whats-next).)

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

## Limitations and what's next

An honest accounting of where the tool is weak today and what is being worked on.

- **It over-flags normal PRs at scale, so findings ship advisory.** On a large clean-PR corpus the structural detectors fire on legitimate patterns (relocated tests, refactors that change assertions, pragmatic suppressions) often enough that blocking on them would be noisy. That is why `--mode advise` is the default and nothing blocks unless you opt in. Narrowing that false-alarm rate until a detector can earn the gate is the active work.
- **No single detector has cleared the bar to block on its own.** A detector becomes gate-eligible only when its measured precision is at least 0.90 with a minimum true-positive count behind it (the Wilson lower bound keeps a handful of lucky firings from promoting). This is the single criterion; the v10 F1 >= 0.5 gate is superseded. The tier is computed into [`benchmarks/real-corpus/promotions.json`](benchmarks/real-corpus/promotions.json) and CI fails if it drifts (`npm run promotions:check`), so today every detector is advisory-only. A second, corroborated tier applies the same 0.90 bar to the subset of a detector's findings that the opt-in execution-grounded layer backs (a surviving mutant, a coverage gap, or a still-failing repro); a detector that is noisy standalone can clear it, which is the concrete path to the first gate.
- **A second way to earn a block does not go through labels, and nothing blocks on it today.** Because detector-versus-label precision is pinned at 0, a block can instead come from a runtime fact, not a label. Eligibility is two-tier ([`benchmarks/real-corpus/block-eligibility.json`](benchmarks/real-corpus/block-eligibility.json), held by CI via `npm run block-policy:check`). Circumstantial triggers keep the statistical bar: `corroborated-under-constraint` (a structural finding on a changed line where a mutant survived or no test runs) gates only when its Wilson 95% lower bound clears 0.90 with at least 5 confirmed reverted true positives. Self-certifying triggers carry their own per-instance proof and gate on a firing whose controls are all green, not on the Wilson bar: `test-tamper-proven` (the PR's test hunks reverted in the sandbox, the restored test fails twice on the PR's source and passes on the base checkout, [`benchmarks/results/RESTORATION-REPORT.md`](benchmarks/results/RESTORATION-REPORT.md)), `claim-falsified` (the linked issue's repro still fails on the patched checkout), and `obligation-failure` (a declared contract obligation fails on the patched workspace). Calibrated against 72 reverted/hotfixed PRs and 232 clean ones ([`benchmarks/real-corpus/BLOCK-REPORT.md`](benchmarks/real-corpus/BLOCK-REPORT.md)): `corroborated-under-constraint` fired four times, each on a PR that was reverted or hotfixed (precision 1.0, Wilson lower 0.510), still below the bar; the three self-certifying triggers fired zero times. The runtime gate set (`BLOCK_ELIGIBLE_TRIGGERS` in `src/audit/gate/gate-decision.ts`) is the three self-certifying kinds, and `decideBlock` gates a firing only when its per-instance controls are all green (`controlsAllGreen` in `src/audit/gate/self-certifying.ts`); a firing with a missing, false, or unevaluated control surfaces in the comment but never changes the exit code. No self-certifying trigger has fired on the corpus, so `swarm audit --mode gate` still passes every corpus PR. The circumstantial trigger stays held until it clears the Wilson bar.
- **What blocks today, precisely.** CLAIM A: `swarm audit --mode gate` blocks a PR only on a self-certifying runtime proof whose per-instance controls are all green. No structural detector blocks (every detector is `advisory-only` in [`benchmarks/real-corpus/promotions.json`](benchmarks/real-corpus/promotions.json)), and no circumstantial trigger blocks yet (`corroborated-under-constraint` sits at Wilson 95% lower 0.510 in [`benchmarks/real-corpus/block-eligibility.json`](benchmarks/real-corpus/block-eligibility.json)). A `--diff-file` or `--diff-stdin` audit cannot block: the proofs are execution-grounded and need the workspace a `--pr` audit provisions. The gate behavior is pinned by `test/audit/gate/gate-decision.test.ts`, `test/audit/gate/self-certifying.test.ts`, and `test/audit/gate/test-tamper-proven.test.ts`. CLAIM B: on 2026-06-12 the gate blocked a dogfood PR that deleted a real guarding assertion ([PR #61](https://github.com/moonrunnerkc/swarm-orchestrator/pull/61), [failed check run](https://github.com/moonrunnerkc/swarm-orchestrator/actions/runs/27385900587/job/80932730889), [proof comment](https://github.com/moonrunnerkc/swarm-orchestrator/pull/61#issuecomment-4686206549)); the posted reproduce command, pasted into a fresh clone, restores the assertion and the test fails with `15 !== 10`. Full write-up in [`benchmarks/real-corpus/BLOCK-REPORT.md`](benchmarks/real-corpus/BLOCK-REPORT.md).
- **The real-corpus baseline is AI-labeled, so blocking precision is not yet proven.** Against the 205-PR model-labeled baseline the deterministic detectors score low (F1 0.140, [`benchmarks/real-corpus/scores/latest.json`](benchmarks/real-corpus/scores/latest.json)), and every label carries a "pending human review" stamp. That AI-labeling is the largest open hole in the project's credibility; closing it with human labels is the next milestone ([`docs/labeling-methodology.md`](docs/labeling-methodology.md), [`benchmarks/real-corpus/labels-v2/`](benchmarks/real-corpus/labels-v2/)). The loop that closes it is built and tested, waiting on the rater pool: [`scripts/labeling/adjudicate.ts`](scripts/labeling/adjudicate.ts) queues the arbiter-split findings (where two arbiter model families disagree, the highest information per human minute), records the human verdicts, and promotes them to the scored baseline only once the pairwise Cohen's kappa clears 0.60. Promotion never overwrites a snapshot without `--write` and drops, rather than coerces, any verdict whose category has no detector to score it against.
- **It is a cheat and under-constraint signal, not a bug finder.** It does not catch the logic bugs that get reverted; those leave no cheat-shaped tell. Use it to answer "did the agent cut a corner?" and "can I prove this patch met its contract?", not "is this code correct?".

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
