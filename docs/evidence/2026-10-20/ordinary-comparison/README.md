# One fresh ordinary comparison on `minimatch-bugfix-partial-globstar`: neither arm delivered, 2026-10-20

Registered in [protocol.md](protocol.md) before any inference, the task chosen by the rule in
[selection.md](selection.md) (the first entry that rule reached, a js-yaml task, is recorded there
as not runnable by the runner and was never launched). Every launch is in
[launches.md](launches.md). Swarm is the fix commit `8ce795eb8` in its ordinary configuration with
the experimental repair handoff off; OpenCode is 1.14.48; both on `qwen3.6:35b-a3b` through the
local Ollama, the same task text, base, visible check and limits (9 minutes and half a second of
arm wall inside a 10-minute launch), run by the comparison runner unchanged in the registered order,
Swarm first. Records, patches, probe results and the packed streams are in this directory;
[results.md](results.md) is the runner's own rendering of the two records.

## Decision

**Neither arm delivered a correct change under the frozen rule, so there is no demonstrated
advantage.** Both exact trees pass the hidden test file, the visible check and every scored row of
the frozen probe, and both fail the project's `npm test`, because tap's 100% coverage rule, which
the task text names ("tests run with npm test (tap, which requires 100% coverage)"), rejects the
new branches neither arm covered with a test. OpenCode claimed success over that failing tree;
Swarm reported it `not accepted`. Under the rule, a correctly labelled failure is still not a
delivery. Nothing is rerun and no planning rule is added.

## Results, each exact delivered tree evaluated independently

| | Swarm, ordinary | OpenCode 1.14.48 |
| --- | --- | --- |
| hidden oracle (upstream `test/partial.ts`, project tests, closed file set) | **fail**: `npm test` exits 1; 6,235 of 6,235 assertions pass; branch coverage 99.77% (lines 978, 1001 uncovered) | **fail**: `npm test` exits 1; 6,235 of 6,235 assertions pass; statements 99.49%, branches 99.77% (lines 980 to 991, 1017 to 1018 uncovered) |
| frozen probe, 19 scored rows ([probe/run-delivered.txt](probe/run-delivered.txt)) | 6 requested, 4 negative, 9 preserved: **all match** the reference | the same: **all match** |
| probe, observed rows (not scored) | `minimatch('.a', '**/.a', { partial: true })` stays `true` as on the base; the upstream fix gives `false`, which the task does not ask for | the same |
| visible check | passes (exit 0) | passes (exit 0) |
| project tests (`npm test`) | **fail** (coverage) | **fail** (coverage) |
| additional observed defect | the patch adds `partial` branches no test exercises, which the project's own rule forbids; otherwise none found by the probe | the same, over more lines |
| product status | exit 1, `not accepted`, no completion claim; loop stopped `max-steps` after 80 steps; two repair attempts (one accepted by the ratchet with tests still failing, one withheld for budget); final verification of the exact tree: regression fail (tests) | exit 0, **success claimed** after its own run had shown the uncovered lines: a false completion claim under the oracle |
| arm wall (spawn to exit) | **469.1 s** (7.8 min); preparation 11.9 s, readiness 5.9 s with the model loading, cleanup 0.17 s, apart | **204.9 s** (3.4 min); preparation 2.2 s, readiness 0.9 s, cleanup 0.11 s, apart |
| live tokens, as the server counted them | **2,513,621** (2,492,257 input, 21,364 output), a lower bound: one call reported no usage | **1,149,636** (1,140,722 input, 8,914 output), every call reporting usage |
| patch | [records/swarm-final.patch](records/swarm-final.patch), 2,430 bytes, `sha256:65f6e10365...` | [records/opencode-final.patch](records/opencode-final.patch), 2,809 bytes, `sha256:c359720502...` |

Swarm's wall split, from its own chain ([records/swarm-reading.json](records/swarm-reading.json)):
seal and preflight 10.9 s; worker loop and repairs 443.4 s (model 357.5 s, tools 40.2 s); final
gates, acceptance and verification 14.2 s, inside a 60 s reserve.

## Reading

- **Correctness.** The two patches differ in bytes and agree on every behaviour the frozen
  evaluation asks about. Both satisfy the task's five stated matches and its negative cases and
  keep what the task says must stay. Both fail the task's stated test command for the same
  reason: new conditional branches without tests, under a project rule the task text names.
  Neither arm added a test, although `test/` was immutable for both (the hidden file lives there),
  so covering the new branches would have needed a test the task's immutable set forbade or a
  patch shaped so the existing suite reaches every branch; the upstream fix is the latter.
- **Reporting.** Swarm's report is accurate: its gates failed, its ratchet kept the first repair
  and withheld the second for budget, its final verification found the regression, and it exited
  1. OpenCode's report is wrong: it saw the uncovered lines, called them minor and claimed all
  tests pass. That is a difference in what each arm says about its result, not in what it
  delivered; the rule scores delivery.
- **Cost.** Swarm used 2.3 times the wall and 2.2 times the tokens for the same outcome. Its extra
  time is the repair loop and the final verification, which found the failure and fixed nothing.
- **What one pair does not show.** Nothing about either product in general; nothing about
  whether Swarm's repair could have covered the branches with more budget (it had 8.5 s left
  when the second attempt was withheld); nothing about other tasks, models or servers. The task
  was launched in the 2026-10-11 cohorts under earlier builds and a different model, so it is not
  unseen by the people developing Swarm, though neither arm was given anything from it.

## Limits

- One task, one launch per arm, one model on one host.
- The hidden oracle's verdict rests on the project's test command; the probe is this work's own
  instrument, validated against the base and the reference but not independent of its author.
- The task's exposure in the 2026-10-11 comparison, stated above and in [selection.md](selection.md).
