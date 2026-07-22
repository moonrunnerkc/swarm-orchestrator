# Execution-grounded layer

The layer that lets `swarm audit --mode gate` block a merge. Structural
detectors run with no setup and only ever flag (advisory). A block is a
self-certifying runtime result whose per-instance controls are all green, and
every block ships the exact command that reproduces it in a fresh checkout.

## Enabling it

Off by default. Enable per repo in `.swarm/audit-config.yaml`:

```yaml
executionGrounded:
  enabled: true
```

Full key reference in [`audit-config.md`](audit-config.md). Turning it on is
what lets `--mode gate` exit `1`. Nothing the layer cannot prove ever blocks:
with the layer off, or on a PR it cannot provision, gate mode passes on
advisory findings alone.

## What it costs

For each audited PR the layer provisions the repository in a sandbox: clone
the head, install dependencies, run the affected tests. That adds clone,
install, and test wall-clock to the job.

## Proof protocols

Eight proof protocols back the gate today: six execution-grounded restoration
proofs (`test-tamper`, `mock-mutation`, `no-op-fix`, `type-suppression`,
`fake-refactor`, `dead-branch`) plus `claim-falsified` and
`obligation-failure`. The measured proven-finding precision on the
execution-grounded-viable corpus slice, with its plain n, is in
[`GATE-PRECISION-REPORT.md`](../benchmarks/real-corpus/GATE-PRECISION-REPORT.md).

Language support is asymmetric by construction:

- The `test-tamper` restoration proof runs on **node (jest/vitest/mocha),
  pytest, and go-test**, proven end-to-end through the shipped CLI on planted
  Go and Python fixtures
  ([`LIVE-PATH-POLYGLOT-REPORT.md`](../benchmarks/oracle-corpus/LIVE-PATH-POLYGLOT-REPORT.md),
  4/4).
- The other five proofs (`mock-mutation`, `no-op-fix`, `type-suppression`,
  `fake-refactor`, `dead-branch`) stay Node/TypeScript-only because their
  controls are AST- or Istanbul-based, and they fail closed to advisory on a
  pytest or Go tree.

Provisioning is the practical ceiling. The static viability screen measured
12 of 197 sampled PRs as Node proof-tier-provisionable
([`eg-viability.json`](../benchmarks/real-corpus/eg-viability.json)); your own
repository, where the suite is known to run in CI, provisions far more
reliably than an arbitrary sample.

## Advisory-only engines

Two more execution-grounded engines run advisory-only and never gate:

- **`error-swallow` restoration** neutralizes a PR-added empty catch (or
  `except: pass`) and reruns the affected tests to surface a load-bearing
  swallow (node/pytest twins 4/4, `npm run error-swallow:measure`).
- **Tier C `claim-binding`** binds the PR's claim to an existing repo test
  and, in production, abstains without a green-history checkout (twins:
  honest false-positives 0/4, recall 4/4, `npm run claim-binding:measure`).

Both are wired into `swarm audit --pr` and proven end-to-end through the
shipped CLI
([`LIVE-SET-PROOF-REPORT.md`](../evidence/live-wiring/live-set-runs/LIVE-SET-PROOF-REPORT.md),
6/6). Enable them with `errorSwallow` / `claimBinding` under
`executionGrounded` in [`audit-config.md`](audit-config.md).

## Evaluation

Reproduce the layer's benchmark run with `npm run execution-grounded:full`.
It surfaced one proof-correlated catch: proof anchor
[`trpc/trpc#6098`](https://github.com/trpc/trpc/pull/6098), where 8 lines
with surviving mutations were later changed by a hotfix. Full evaluation in
[`v11-EXECUTION-GROUNDED-REPORT.md`](../benchmarks/real-prs/v11-EXECUTION-GROUNDED-REPORT.md).
