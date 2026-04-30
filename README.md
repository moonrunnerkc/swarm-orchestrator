<div align="center">

<img src="docs/media/wasp.svg" alt="Swarm Orchestrator" width="72" height="72">

# Swarm Orchestrator

**A composable falsification and attestation layer for AI coding agents.**

[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)
&nbsp;
[![CI](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
&nbsp;
![Tests: 1336 passing](https://img.shields.io/badge/tests-1336%20passing-brightgreen.svg)
&nbsp;
![Node.js 20+](https://img.shields.io/badge/node-20%2B-green.svg)
&nbsp;
![Version: 7.0.0-alpha.0](https://img.shields.io/badge/version-7.0.0--alpha.0-orange.svg)

</div>

---

## What This Does

Swarm Orchestrator wraps GitHub Copilot CLI, Claude Code, or Codex and runs a five-layer falsification battery against every patch the agent produces. Layers 1 and 2 are hard gates: a synthesized regression test must transition fail to pass and existing tests plus mutation score must hold. Layers 3, 4, and 5 (cheat-detector, property gate, signed attestation) feed an advisory composite score that flags patches for human review without blocking merge.

## Install

```bash
npm install -g swarm-orchestrator
```

Requires Node.js 20+, Git, and at least one supported agent CLI:

| Agent | Install | Auth |
|---|---|---|
| GitHub Copilot CLI | `npm install -g @github/copilot` | `copilot` then `/login` (Node.js 22+) |
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `ANTHROPIC_API_KEY` |
| Codex | `npm install -g @openai/codex` | `OPENAI_API_KEY` |

### Quick start

```bash
swarm bootstrap ./your-repo "Add JWT auth and role-based access control"
swarm bootstrap ./your-repo "Add JWT auth" --tool claude-code
swarm bootstrap ./your-repo "Add JWT auth" --tool codex
```

Build from source:

```bash
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm install && npm run build && npm link
```

## The Falsification Battery

Every agent-authored patch passes through five layers in order. Any layer that reports `advisory-warn` or `fail` sends the patch to human review independently; the composite score reports overall confidence to the operator.

**Layer 1 — Intent verification (hard gate).** Before the worker step runs, the reviewer role generates a regression test that fails against the goal's pre-state. After the worker commits, the test must transition fail to pass. If the synthesizer reports `AMBIGUOUS_GOAL` or the test still fails, the patch is rejected.

**Layer 2 — Regression and mutation (hard gate).** The full existing test suite runs against the patched code and must pass. Modified source files also run mutation testing (Stryker for JS/TS, mutmut for Python). The mutation score must clear the configured `failBelow` threshold (default 0.6).

**Layer 3 — Cheat detector (advisory).** Heuristic rules plus an optional Semgrep rule pack scan the diff for hardcoded answers, swallowed exceptions, unauthorised test-file edits, complexity mismatch, and mock mutation. Findings score down the patch but do not block merge on their own.

**Layer 4 — Property gate (advisory).** For each modified function, the gate generates property-based tests (fast-check for JS/TS, Hypothesis for Python) and runs them for 60 seconds per function. Counterexamples are advisory; untyped JavaScript runs in reduced-coverage advisory mode by design.

**Layer 5 — Provenance (advisory).** A signed in-toto SLSA v1.0 attestation envelope is produced for every patch, signed via cosign keyless (Fulcio + OIDC), and attached as a git note. Verification later replays the envelope and confirms identity. Unsigned envelopes drop the attestation score; failed verification flags the patch.

The advisory composite is `(0.4 × cheatDetector + 0.4 × propertyGate + 0.2 × attestation) − advisoryGatePenalty`. It is reported as confidence alongside layer statuses; it does not override `advisory-warn` or `fail` review signals.

## Agent Roles

Two roles, no personas:

- **Worker** — full file access, writes implementation code, runs tests, commits incrementally. Boundaries forbid touching pre-existing test files unless the goal authorises it.
- **Reviewer** — read-only. Generates synthesised regression tests pre-worker (Layer 1) and reviews diffs post-worker (security, accessibility, or general policy). Cannot write implementation.

Domain specialisation is a reviewer policy, not a separate agent. Backend, frontend, security, and accessibility reviews are policies on the reviewer role; they do not require persona files.

## Attestation and Audit

Every patch produces a signed in-toto v1.0 envelope:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "...", "digest": { "sha256": "..." } }],
  "predicateType": "https://swarm-orchestrator.dev/falsification/v1",
  "predicate": { "layers": [...], "compositeScore": ... }
}
```

Signing uses cosign keyless (Fulcio identity issuance via OIDC). No long-lived keys. The envelope attaches to the commit as a git note under `refs/notes/swarm-attestation`.

Verify a commit's attestation:

```bash
swarm attest verify <commit-sha>
```

The verify command replays the envelope, re-checks each layer's recorded score, and confirms the cosign signature against the issuing identity. Mismatch or absence is reported per-layer.

## Configuration

Per-project verification thresholds and weights live at `.swarm/gates.yaml`:

```yaml
verification:
  mutation:
    failBelow: 0.6
    warnBelow: 0.8
  composite:
    # Confidence threshold for reporting; advisory-warn or fail statuses force human review independently.
    threshold: 0.7
    weights:
      cheatDetector: 0.4
      propertyGate: 0.4
      attestation: 0.2
    advisoryGatePenalty: 0.02
```

Resolution order: built-in defaults, then `.swarm/gates.yaml`, then `--quality-gates-config <path>`. Each layer deep-merges; unknown keys error.

Custom advisory rules belong under `.swarm/gates/index.js` exporting `registerGates({ registerGate })`. Built-in falsification layers cannot be overridden, only their thresholds.

## Benchmarks

Primary metric: **falsification catch rate** — the percentage of patches the agent claimed succeeded that fail at least one battery layer. Measured against the `princeton-nlp/SWE-bench_Verified` test split, 50-instance stratified subset, seed=42 (manifest at `benchmarks/swe-bench/instances-50.json`).

| Benchmark | Sample | Catch rate | Notes |
|---|---|---|---|
| SWE-bench Verified (50, seed=42) | 50 instances | _pending P4 sweep_ | Layer 3 cheat-detector eval passed independently with 0% FP on a 20-patch gold sample (`docs/p1-eval-results.md`). |
| SWE-bench Verified pass@1 | 50 instances | _pending P4 sweep_ | Secondary metric. |
| Mean wall clock per instance | 50 instances | _pending P4 sweep_ | |
| Mean premium requests per instance | 50 instances | _pending P4 sweep_ | |

The full sweep harness is at `benchmarks/swe-bench/`; it runs in a Docker image with all instance dependencies pinned. Numbers above will land with the 7.0.0 release notes after the sweep completes.

## Contributing

```bash
npm install && npm run build && npm test
```

Before any PR: `npm test`, then `node dist/src/cli.js gates .`, then a descriptive commit. The self-gate runs in CI; orchestrator regressions fail their own gates. See [CONTRIBUTING.md](CONTRIBUTING.md) for code style, the falsification-battery development workflow, and the eval harness.

## License

[ISC](LICENSE) — built by [Bradley R. Kinnard](https://github.com/moonrunnerkc).
