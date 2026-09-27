# Verifier-first: completion index

Campaign identity: `verifier-first-2026-09-27`. This index is the one place every requirement of
the verifier-first assignment is bound to its implementation, its tests and its executed
evidence. It is kept current as work lands; a row that says "not started" or "open" is the
truth of the tree at the commit that carries it, not a promise.

The product decision is [ADR 0012](../adr/0012-verifier-first-product.md). Prior campaigns,
frozen protocols, launch records and published results are preserved unchanged; nothing here
is appended to an older pilot.

## Gates

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| G0 repaired foundation | reliability fixes confirmed; execution and evidence boundaries work | in progress | [baseline.md](baseline.md) |
| G1 verifier release | R1 to R6 and R9 implemented, installed, published, exercised; package, CI and security checks clean | not started | |
| G2 public evidence and launch | R7 study complete; R8 permitted posts published; 48-hour response period elapsed; R10 loop active | not started | |
| G3 comparative advantage | Comparisons A and B and the ablations complete under the frozen decision rule | not started | |

Completing G1 is not completing the assignment. G3 stays in this table until it is either
established or explicitly handed off with its remaining manifest.

## Requirements R1 to R10

| Req | What it asks | Implementation | Tests | Executed evidence | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | `moonrunnerkc/swarm-verify@v1` Action with a signed, idempotent PR comment and an independent verification command | | | | not started |
| R2 | `npx swarm-verify` useful with zero configuration: deterministic discovery, noninteractive run, scoped result, stable exit codes | `src/cli-check.ts`, `src/gates/check-plan.ts`, `src/gates/noninteractive-runner.ts`; no subcommand runs `check` | `src/cli-check.test.ts` (ten real invocations), `src/gates/check-plan.test.ts`, `src/gates/noninteractive-runner.test.ts` | local gates 24ef849f0: 382 files, 3654 tests; public-package run pending R5 | implemented, not yet published |
| R3 | README-only stranger simulations on three independently maintained repositories from fresh VMs | | | | not started |
| R4 | Dogfood across owned repositories, including the Aftermath site repository | [dogfood-manifest.md](dogfood-manifest.md) | | | inventory recorded |
| R5 | Stable published `swarm-verify` on Node 22 with a frozen contract and platform matrix | coverage arm on Node 22.8+ ([node-22.md](node-22.md)); contract, matrix and publication pending | `src/node-floor.test.ts`, `src/gates/node-test-command.test.ts`, `src/gates/default-gates.test.ts` | Node 22.22.3 run in node-22.md | in progress |
| R6 | Verifier-first README with a real tamper GIF and tested commands | | | | not started |
| R7 | Registered, reproducible study of 50 recent AI-authored PRs | | | | not started |
| R8 | Launch posts where users discuss the problem, with a real 48-hour response log | | | | not started |
| R9 | Claude Code hook, MCP server and pre-commit hook over the released verifier | | | | not started |
| R10 | Working issue-to-fix loop with a named owner and tested notifications | | | | not started |

## Technical scope (sections 3 to 7 and 16)

| Item | Implementation | Tests | Executed evidence | Status |
| --- | --- | --- | --- | --- |
| Requirement-level check challenges, four families | | | | not started |
| Precise evidence and adequacy decisions, offline re-derivation | | | | not started |
| Twelve attack families with clean counterparts | | | | not started |
| Bounded check strengthening and implementation repair | | | | not started |
| Three policies: disabled, report-only, required | | | | not started |
| Readable report agreeing across JSON, terminal, CI summary and bundle | | | | not started |

## Research scope (sections 8 to 15)

| Item | Status | Evidence |
| --- | --- | --- |
| Independent evaluation boundary and reviewer records | not started | |
| Frozen campaign protocol with content digest | not started | |
| Comparison A: identical-patch verifier decisions | not started | |
| Comparison B: complete coding workflows | not started | |
| Ablations S0, S1, S2 | not started | |
| Prior-art and differentiation table | not started | |
| Effectiveness hypothesis verdict | untested | |

## Facts established at registration (2026-09-27)

- Repaired baseline: `270811a4474284d9be2d07765eb26c35bc0c5453` on `v13-main`, which is the
  repository's default branch. The audited commit `a6a83eeb9201957d505824b135f0bc9c83ee9944` is
  an ancestor; the ten commits after it are the audit corrections recorded in
  [upgrade-audit-corrections.md](../upgrade-audit-corrections.md).
- Registry state: `swarm-orchestrator@14.2.0` is `latest`; `swarm-verify@0.2.0` is the only
  published version of the standalone package, published 2026-09-27T17:21Z with SLSA provenance
  from tag `swarm-verify-v0.2.0`. No `moonrunnerkc/swarm-verify` repository exists yet, so the
  requested Action address does not resolve.
- Delivery route: ruleset 15229475 on this repository blocks creation, update, deletion and
  non-fast-forward on every branch for everyone except the repository admin role, which
  bypasses always. Every push by the owner therefore goes through that ruleset's own configured
  route; no rule is disabled and no force push is used.
- The earlier "four of eighteen" finding is
  [false-green-measurement.md](../evidence/2026-09-05/false-green-measurement.md): eighteen
  patches produced by this project's own agent and a baseline arm over three public TypeScript
  repositories and three tasks, re-scored against hidden acceptance tests written by the same
  authors. Four passed their project's whole suite and failed the hidden test. It is a
  measurement of that population only. It is not a study of AI-authored public pull requests,
  not independently reproduced, and not a general false-green rate; the R7 study is registered
  separately and does not inherit it.
- Local development environment: Node 24.15.0 (`node@22` 22.22.3 is installed beside it),
  npm 11.12.1, pnpm 9.15.0, uv 0.11.13, Python 3.14.7, Docker 29.5.2, gh 2.92.0 with
  `attestation verify`, Claude Code 2.1.283, Ollama serving local models. The local npm
  credential is expired (`whoami` answers 401); publication goes through the repository's
  tag-triggered workflow, which published 0.2.0 today.

## Records

- [baseline.md](baseline.md): G0 prerequisite checks and the gate transcript on the baseline.
- [dogfood-manifest.md](dogfood-manifest.md): the owned-repository inventory and rollout state.
