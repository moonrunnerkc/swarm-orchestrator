# Development launches and demonstrations of 2026-10-16: results

The questions and rules were registered before any launch, in [protocol.md](protocol.md).

- **Allowance:** all 8 model-powered launches were used, about 20 agent-minutes of the 60
  allowed.
- **Halts:** two manifests halted at the endpoint check before dispatching anything. They had
  been frozen with the launcher's default model and endpoint, and were re-frozen on the
  comparison's settings ([halted-before-launch/](halted-before-launch/)).
- **Status:** every task here is exposed, and nothing here is comparative evidence.

## Before any launch, with no model

- **[csstree-lifecycle/](csstree-lifecycle/README.md):**
  - the csstree refusal is reproduced from the original base on the measured build, with
    stage A's own diff-budget record;
  - the repaired build accepts the same patch.
- **[replays-51c3ba489/](replays-51c3ba489/):** on the development build, the mime and pako
  references and Swarm's stage A patches are accepted, and both bases are refused.

## Question 1: the concise worker prompt

The build was `51c3ba489`, Swarm only, one launch per cell.

| task | prompt | delivered | tokens | agent time | 113-case mime audit |
| --- | --- | --- | --- | --- | --- |
| pako refactor | default | yes | 217,540 | 93 s | |
| pako refactor | concise | yes | 339,143 | 94 s | |
| mime bug fix | default | yes | 105,844 | 65 s | 0 wrong |
| mime bug fix | concise | yes | 94,419 | 63 s | 0 wrong |

The registered rule required at least 20 per cent fewer tokens on each task. Concise used 56 per
cent more on pako and 11 per cent fewer on mime, so the default prompt stays. The concise prompt
remains selectable with `--prompt-profile concise`.

Both mime patches here are right on all 113 cases of the audit
([audit-mime-dev.json](audit-mime-dev.json)). On an exposed task, with one launch each, that
says nothing about the changes being measured.

## Question 2: planned checks on mime (`--plan-checks`)

The planner never saw the audit, its counterexamples, the upstream commit or a retained patch.

| launch | build | what happened | tokens | agent time | delivered (audit) |
| --- | --- | --- | --- | --- | --- |
| 5 | `51c3ba489` | **halted.** The planned-check tool took a whole goal contract, so the planner had to retype the 1,500-character task verbatim. It failed at that more than twenty times and spent 40 steps. | 938,575 (planning) | 315 s | no |
| 6 | `dd06a28e2` | Delivered with no planned check. The planner, given the graph-planning prompt and the raw task, tried to implement the fix read-only until the stall rule stopped it. Its 341,256 tokens were not on the event stream, so the launcher counted only 66,124. | 407,380 actual | 112 s | yes (0 wrong) |
| 7 | `5ac3efc2d` | Two checks pinned. Admission rightly dropped both: one imported `dist/` without a build, the other was a syntax error. | 451,321 | 231 s | yes (0 wrong) |
| 8 | `3c922103a` | Ten malformed checks were refused, then one was pinned. It also imported `dist/`, which admission's build-skipping probe could not run. The revision round had no time left. | 304,235 | 217 s | yes (0 wrong) |

**Result: autonomous discovery was not observed.** No planned check was ever admitted, so none
failed a candidate and no repair followed one. Each launch found a product defect, and each was
repaired with a regression before the next launch:

1. a dedicated `declare_planned_checks` tool, with the goal supplied by the harness;
2. the planner's own prompt and brief ("write checks, do not implement"), with its spend on the
   event stream;
3. one revision for checks that never ran, with their recorded base output;
4. admission that runs the base as acceptance does (build first), and a revision share of the
   planning allowance.

Repair 4 was never exercised live: the allowance ended first. The three delivered patches are all
right on the 113-case audit ([audit-mime-dev-plan.json](audit-mime-dev-plan.json)). That is the
same result as the default prompt's, at three to four times its tokens.

## Detection and repair on the retained omission, scripted

[mime-planned-repair/](mime-planned-repair/run.mjs) is a **scripted demonstration from supplied
counterexamples**: not discovery, not a live launch. It ran on the real mime base, through the
ordinary command line, on build `dca2e5953`, with no model.

- **Checks:** the audit's counterexamples are supplied as two planned checks:
  - terminators before an extension-only tail, multiple terminators, a leading terminator, CRLF;
  - ordinary names, spaces and tabs.
- **Admission:** both are admitted on the base by their declared control. The change check fails
  there with a wrong answer; the preservation check passes.
- **First candidate:** Swarm's own retained stage A patch fails the blocking acceptance gate.
- **Repair:** the repair brief carries the concrete `should equal ... but was ...` mismatch, and
  the scripted repair writes the correct fix only when it sees that.
- **Outcome:** accepted, with one repair attempt and every sealed requirement met
  ([summary.json](mime-planned-repair/summary.json)).

This shows the product's path from an admitted check through the blocking gate, the repair
attempt and the final verification on the real repository. It does not show that anything found
the omitted cases unaided.
