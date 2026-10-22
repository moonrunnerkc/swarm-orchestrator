# Local capability study, October 22, 2026

The new finishing intervention has **no demonstrated live artifact benefit**. Neither live
finishing treatment dispatched its continuation. The only complete-delivery improvement is in
a deterministic source regression, not a live product win. The general product objective remains unmet.

The [study](../../capability-study-2026-10-22.md) explains diagnosis, primary research and the
small opt-in implementation. The [protocol](protocol.md) froze eight ordered local slots before
inference; [results.json](results.json) retains every slot, including two setup failures.
Product revision: `f07cd0861c3be79087baffabbb1238b38e3e37eb`; both Swarm arms use that binary.
Only `--repair-finish` differs. Default behavior is unchanged. No acceptance policy was changed.

## Actual deliveries

| Slot | Task / model | Product | Delivered artifact | Complete under this study's bar |
| --- | --- | --- | --- | --- |
| 1 | entities / Qwen | OpenCode 1.19.4 | No edit; visible and hidden behavior fail | No |
| 2 | Mocha / Qwen | Swarm control | Wrong staged patch path; no inference | Failed start |
| 3 | entities / Qwen | Claude Code 2.1.308, local Ollama | Behavior and build pass; lint fails on two numeric separator errors | No |
| 4 | Mocha / Qwen | Swarm finish | Useful work rolled back; original faulty patch delivered | No |
| 5 | entities / Qwen | Swarm control | Behavior, build and lint pass; adds two ESLint suppression comments | No under the requested no-suppression rule |
| 6 | entities / Qwen | Swarm finish | Missing pinned-tool PATH; preflight refuses before inference | Failed start |
| 7 | Mocha / Gemma | Swarm control | Repair reaches wall limit; original faulty patch delivered | No |
| 8 | Mocha / Gemma | Swarm finish | Repair reaches wall limit; original faulty patch delivered | No |

The entities behavior scorer covers 22 required and preservation cases. Both submitted entities
patches pass them and add five tests that fail over base source and pass on submitted source.
Swarm's first entities candidate was independently reconstructed to its recorded digest and also
passes the behavior scorer. Its repair changes static compliance, not measured semantic correctness.
The delivered test name about a trailing surrogate contradicts its input; its source comment about
`codePointAt` returning undefined on a trailing surrogate is also false. These are additional quality
limitations, not invented hidden behavior failures. The product reports this run accepted; the
no-suppression requirement is not enforced by that verdict. Claude reports success despite its lint
failure. OpenCode exits on a tool-call turn without claiming success.

OpenCode passes a neutral edit-and-test smoke. In the task it misspells the absolute workspace
path and its external-directory policy refuses access; it makes no edit. This is the observed
single-run failure, not evidence that other OpenCode tasks or its normal model configuration fail.
Claude's corrected neutral smoke passes. Both comparator launches occurred independently of
Swarm success. Claude's approval bypass with isolated HOME has broader effective path permissions
than Swarm/OpenCode's lexical guards. This limits fair product conclusions; no superiority claim
follows. No hidden evaluator was supplied to a worker.

All three live Mocha deliveries have identical frozen-task base content and final patch digest
`fa5bce2fd91a7fe83cc604c99bf6cdadfa33d6884d43d0a92c8fc1c1de8bc2af`.
Independent visible and hidden scorers fail. The expanded preservation check holds for 10/11
cases and fails the required existing `-t 200` form. That one expanded reading is reused for the
identical delivered patch/task inputs; no changed candidate is credited with that observation.

There is one complete matched mechanism pair: Gemma Mocha, zero wins, zero losses, one tie at
failed delivery. The two Qwen pairs are missing an arm due setup errors and cannot establish a
mechanism effect. All six dispatched slots fail the stricter complete-delivery bar; do not turn
semantic ties, green product gates or failed starts into complete product wins. Two exposed tasks,
single samples and mismatched effective comparator path enforcement support no uncertainty estimate
or broad superiority claim. Same-model orchestration value remains unmeasured without the simple
coding-loop baseline. There is no normal-frontier-model comparison.

## Mechanism coverage and cost

The finish path requires a completed repair, a changed candidate and remaining usable allowance.
Qwen Mocha stops at its shared step cap. Both Gemma repairs stop at their wall allowance. Thus no
`repair-finish-v1` notice or extra model continuation occurs in these live treatments. They test
trigger coverage and show no changed decision, artifact gain or measured incremental finish cost.
The deterministic tests exercise finishing, stale feedback refusal, rollback, the step ceiling and
the cheap direct path. They do not demonstrate model transfer.

| Dispatch | Product wall, s | Reported tokens | Native model time, s | Tool intervals, s | Estimated verification union, s |
| --- | ---: | ---: | ---: | ---: | ---: |
| OpenCode entities | 7.4 | 20,207 | unmeasured | in external stream | external scorer separate |
| Claude entities | 85.5 | 375,973 | 80.7 API time | unmeasured | external scorer separate |
| Swarm Qwen Mocha finish | 387.3 | 380,116 | 65.6 | 31.4 | 242.6 |
| Swarm Qwen entities control | 224.0 | 1,135,708 | 118.1 | 22.7 | 55.3 |
| Swarm Gemma Mocha control | 466.2 | at least 176,516 | at least 154.1 | 28.2 | 224.4 |
| Swarm Gemma Mocha finish | 484.7 | at least 231,104 | at least 165.8 | 27.5 | 231.1 |

Total product wall: 1,655.201 s (27.6 minutes). Reported product usage: at least 2,319,624 tokens,
including 1,137 synthetic scripted-seed tokens; readiness probes and neutral smokes are additional
and preserved in the raw records. Two cancelled Gemma calls have unknown usage. Native model time
sums recorded response durations. Verification unions declared gate-duration intervals and the
independent verification phase intervals; it is an elapsed estimate, not CPU time. Tool and
verification categories overlap and must not be added. Use [trajectory-account.mjs](trajectory-account.mjs)
on restored ledgers. Initial file edits in Mocha are scripted faulty seeds, not successful repairs.

The Claude streaming counter undercounted its task (341,104) and corrected smoke (19,292).
The final CLI usage summaries report 375,973 and 20,464 respectively; those authoritative totals
are used here. OpenCode smoke usage is in its step-finish events, not the Claude-only stream counter.
The local adapter prints a dollar estimate using CLI pricing; that is not an invoice. **Paid
inference: $0.** Hardware is Apple M5 Max, 18 CPU cores, 64 GiB, Node 24.15.0, Ollama 0.32.14.
Model content IDs and complete versions are archived. No model download or server restart occurred.

Task-time person prompts: none. Experimenter interventions: two failed-start setup errors and one
neutral-smoke argument repair, all retained; neither failed task start was retried. Parallel
supplemental test scoring hit an existing content-addressed blob EEXIST race; its failed log is
retained and that scorer alone was rerun serially, without rerunning an agent or changing a patch.

## Confirmed Mocha reconstruction audit

Records 150 and 156 of `20261022T082133-6e195b`, applied with `git apply --recount` to recorded
base `4d6498ff08c531642f09faea489c1b426c4d0efb`, independently reproduce the full-index binary patch
`bf823a5124440626b4d4ca6481bd0ef708b7dc018094c6f23772c91ceb49c1aa`, 3,836 bytes.
The [historical account](../2026-10-22/development-pair/README.md#supplemental-reconstruction-audit-2026-10-22)
now appends the correction; historical failed-delivery scores remain unchanged.

The rejected patch passes visible, expanded preservation (11/11), hidden behavior and 1,254 unit
tests (3 pending), but fails formatting. Formatting only its two declared files yields a separate
audit patch that passes the full format check, lint, build and the same unit/behavior checks.
Of nine added cases in its test file, six fail with base source and pass with submitted source;
the original file passes 38/38, overlaid tests on base pass 41/47, and submitted tests pass 47/47.
These executable controls support test sensitivity. This reconstruction and mechanical formatting
are audits, not new live product wins. Control-arm reconstruction remains unresolved.

## What remains unproven

The broad portfolio is [separate](portfolio.md): 20 metadata candidates in six repositories,
three exposed identities excluded, no held-out worker inference, and no validated hidden evaluator
set yet. Several metadata candidates need replacement after feasibility review. A 20-task campaign
with registered repeats and five arms, plus a second model on the three same-model arms, is about
48 agent-hours at nine-minute limits, before evaluator preparation and scoring. It has not run.

This patch does not implement persistent hypothesis state, selective planning assistance, or
observation-cache reuse. Existing controller behavior preserves the original task and prior-loop
account; the finishing path invalidates changed feedback and reruns required final checks. No new
agent team or acceptance authority is introduced.

The earliest demonstrated gap for this mechanism is its late trigger: the workers consume their
allowance before reporting a completed repair. On acorn, the earlier gap is semantic progress,
with required test-helper information arriving only at the last step. Next falsifiable hypothesis:
a bounded distinguishing execution chosen from the task and observed code, before repeated broad
inspection, can improve the first candidate at the same total budget. Test it against the direct
loop with independently scored delivery; remove it if additional reasoning/checking fails to improve
artifacts. Another round of orchestration is not assumed to help.
