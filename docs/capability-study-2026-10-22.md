# Execution-guided delivery study, 2026-10-22

Objective: improve complete engineering artifacts per total resource budget. Evidence quality,
checks and CI support that objective; they are not its success metric.

## Starting point and bounded diagnosis

Remote inspected on October 22: draft PR 94 at `3c29b6fa2214fedd1f030d2ef6b9aabb09cf3cd0`,
base `53c2e6b06cf86156a7ed523d9c47cdcb9c8ada61`. The original checkout has unrelated edits
and is left intact. This work uses an isolated checkout of the PR head. No policy changes.

The [prior trial](evidence/2026-10-22/README.md) has no superiority result. Its entities arms
are equivalent under its registered artifact rule; neither acorn arm succeeds. All six named
repositories (mime, marked, sinon, mocha, entities, acorn) are development material now.

| Observation from retained records | Interpretation to test |
| --- | --- |
| Mocha's October 21 repair receives passing test titles but loses the failure tail, probes `-j`, then asserts an unmeasured intermediate value and edits nothing. | Available evidence did not become a discriminating execution and edit. The PR already fixes the diagnostic truncation. |
| October 22 treatment reads the base at record 96, edits both source and tests, and reaches a tests-passing candidate. Its requested `compare_base` procedure is never used. | Fresh repair context can help, but that trace intervention has not demonstrated a mechanism effect. |
| Treatment records 150 and 156 reproduce the exact rejected patch digest. The reconstructed source passes the visible and expanded preservation checks; its test file fails project formatting. | A finishable candidate existed; discovery and semantic repair were not the last obstacle in this run. |
| Both development repairs are rolled back for static failures, then the next attempt has no useful model wall remaining. | Early static feedback might preserve a useful candidate without another expensive full verification cycle. |
| Entities first candidate is already correct by the registered oracle. Repair fixes lint and survives delivery. | The existing repair path can help delivery; this does not isolate a new mechanism. |
| Both Swarm acorn loops spend 40 steps without an edit; OpenCode edits but breaks valid destructuring. | The earliest acorn bottleneck is useful semantic progress, not final formatting. This experiment does not solve that bottleneck. |

The published timing estimates are: Mocha control 511.3 s wall / 108.1 s model / 256.9 s
verification; treatment 415.6 / 69.0 / 226.7; acorn control 462.9 / 198.2, treatment
497.8 / 242.1; entities Swarm 191.8 / 92.6. The control Mocha usage is a lower bound.
Use [trajectory-account.mjs](evidence/2026-10-22-capability/trajectory-account.mjs) on each
restored session for successful edits, repeat counts, candidate identities and requested-to-result
tool intervals. Tool time includes nested verification and must not be added to verification time.
A long trace alone establishes no cause. No successful edit is recorded as null, never zero.

The [Mocha correction](evidence/2026-10-22/development-pair/README.md#supplemental-reconstruction-audit-2026-10-22)
is supplemental. Original failed-delivery scores remain historical. Formatting an audited
reconstruction is not a live product win.

## Research to mechanism

Primary sources read October 22, including methods and limitations. No published percentage is
transferred to Swarm. Model voting is not acceptance authority.

| Source and demonstrated setting | Swarm hypothesis and smallest transfer test | Keep or remove criterion |
| --- | --- | --- |
| [Scaling Inference-Time Compute with Teams of Coding Agents](https://arxiv.org/html/2610.17471v1): ProgramBench black-box reconstruction favors planning delegation; Commit0's supplied decomposition changes the preferred stage. Teams consume more compute. | Acorn inspection without implementation could justify one bounded fresh planning diagnosis. Defer simultaneous implementers. The existing controller can allocate one advisory attempt from the original budget. | Keep only if a matched ablation improves delivered artifacts enough to pay for diagnosis; delegation count is not success. Not implemented in this finishing experiment. |
| [Scaling Test-Time Compute for Agentic Coding](https://arxiv.org/html/2604.16529v1): compact trajectory summaries support sequential refinement and tournament selection on SWE-Bench Verified and Terminal-Bench. Frontier agents, multiple rollouts and extra compute limit transfer. | Preserve the original task, candidate identity and measured failures across a fresh repair context. Reuse the existing bounded prior-loop account; do not copy model conclusions as facts or implement voting. | Keep if the fresh continuation acts on the measured failure and delivers a better tree at the matched total allowance. |
| [Harness design for long-running applications](https://www.anthropic.com/research/harness-design-long-running-apps): application-building examples use planner, generator and evaluator; later model capability permits removing orchestration. Comparisons spend substantially different time and money. | A useful candidate should receive precise unfinished work before expensive acceptance. Use one bounded continuation only after observed static failures. | Remove if it mostly adds checking or consumes budget without improving delivery. No LLM evaluator or model agreement gate. |
| [Effective context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents): engineering guidance on compact state, retrieval and handoffs; not a controlled cross-repository product comparison. | Keep task requirements and actionable diagnostics in the continuation's retained initial message. Existing file tools retrieve details; no memory database. | Check that requirements survive compaction and edits invalidate observations; measure repeated inspections and delivery, not note volume. |
| [Agentic Harness Engineering](https://arxiv.org/abs/2604.25850), revised May 18: newer than the April scaling paper, studies observability-driven harness evolution. It does not establish this intervention's transfer. | Use trajectories to choose one change and freeze a development ablation before inference. | Reject unexercised interventions and separate development tuning from held-out evaluation. |

A targeted newer-work search also located source-code surveys; descriptions of many harnesses
are not causal evidence to add their features. No newer directly matched result was found that
would establish this finishing intervention's benefit.

## Implemented experiment

`--repair-finish` is off by default. Ordinary use remains `swarm "<task>"` with a configured
model. A repair that completes with a changed candidate and usable remaining steps, measured
usage and wall allowance gets its declared blocking static command gates checked early. If a
check fails, one fresh continuation receives the original task and contract, candidate digest,
prior-loop observations and exact bounded diagnostics. It can apply permitted mechanical work
through the existing tool chokepoint. It has at most eight steps, bounded further by the repair's
unused steps, tokens and wall time. A fresh context creates no fresh allowance.

Early checks use the existing runner, environment, backend and command pool. A changed patch
during checking makes the feedback stale and prevents dispatch. The complete gate cycle still
runs afterward on the submitted candidate, with the original checkpoint and ratchet. Full final
acceptance is unchanged; no observation substitutes for a required check. No command is guessed
from formatter names. No model call or precheck is added to a straightforward successful task.

This is a narrow delivery intervention, not the entire proposed adaptive problem-solving system.
It reuses existing repair state and deterministic stall notices. It does not add a persistent
hypothesis store, selective planning assistance, or new multi-agent orchestration. Those remain
unproven work, especially for acorn's pre-edit semantic bottleneck.

## Evaluation boundary

The [development protocol](evidence/2026-10-22-capability/protocol.md) registers matched
finishing-on/off experiments and local product comparisons. Source regressions reproduce a
behavior repair lost to formatting; deterministic tests are scripted, not live capability wins.

A credible broad campaign still needs at least 20 sealed held-out tasks across five repositories,
including bug fixes, features, behavior-preserving refactoring and API/dependency compatibility.
The separate [portfolio plan](evidence/2026-10-22-capability/portfolio.md) specifies selection,
exposure checks and repeated runs. Until selected tasks and validated hidden evaluators exist,
that document is a registration plan, not a prepared or completed benchmark.
