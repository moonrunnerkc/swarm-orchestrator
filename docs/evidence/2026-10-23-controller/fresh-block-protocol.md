# Fresh block 2, registered before its first launch

October 23, 2026. A small fresh comparison on three tasks prepared under the
[registered selection rule](heldout-2-selection-rule.md) by a separate evaluator author, who ran no
model inference and reported only the public items. The implementer has read no hidden check,
reference or control. Counts only; no general advantage claim is made from this block.

## Tasks

| Task | Family | Repository | Base |
| --- | --- | --- | --- |
| `markdown-it-feature-reference-definition-token` | bounded API change with preservation | markdown-it/markdown-it | `6c60e2157` |
| `markdown-it-refactor-ts-file-extensions` | mechanical multi-file transformation (53 renames) | markdown-it/markdown-it | `9f1157c6d` |
| `svgo-bugfix-remove-scripts-anchor-bypass` | bug fix with regression test | svg/svgo | `4e9b9aed2` |

Task text, visible checks and digests: `~/.cache/swarm-heldout-2026-10-23/public-summary.json`
(sha256 `e85edc1d44326eb418714b02f26e1365bb6641ae355b7cb6d48b197c56ea2899`), committed after the
block. Each evaluator was validated against the base (fails), the reference (passes, with project
tests, policy and lint), one alternative correct implementation (passes), one absence-assertion
control (passes) and four to six faulty controls (all fail). One correction was made before
registration: the first task's text and check now both state the null-prototype `meta` the
upstream test requires, after the alternative failed for that reason.

## Arms

All on `qwen3.6:35b-a3b` through local Ollama, one endpoint, one execution profile, the same task
text, visible check, contract text and allowed-change policy.

1. `swarm`: the frozen revised implementation, `--adaptive`.
2. `swarm-direct`: the simple same-model baseline, the same build with `--attempts 0`.
3. `opencode`: OpenCode 1.19.4, pinned by absolute path, edit and shell permitted in the workspace,
   web fetch denied.

The build is the one the development study ends with, named by commit and digest in the launch
log before the first launch. Nothing is changed on the basis of this block's results.

## Samples, order, resources, stopping

- Two samples per cell: 3 tasks × 3 arms × 2 = 18 launches, matched by sample; sample 1 of every
  task, then sample 2; tasks in the seeded order, arms rotated by position.
- Per launch, every arm: 720,500 ms launch wall; Swarm arms hold 60,000 ms of it as their
  verification reserve; 8,000,000 Swarm tokens as a ceiling; 40 steps per Swarm loop.
- Ceiling: 216 agent-minutes of launch wall plus preparation and scoring; local inference only,
  paid inference $0.
- Every registered arm runs regardless of Swarm's result. A zero-inference setup failure is
  recorded apart and retried at most twice after a recorded correction; once inference begins the
  outcome stands. Hidden results are read only after the eighteenth launch is scored.

## Scoring and report

Primary: complete delivery (hidden evaluator, visible check, project tests, lint where the base
passes, requested tests present). Also: hidden behaviour alone, product verdict accuracy (Swarm),
claimed success (OpenCode), mechanism exercise per Swarm launch, initial against delivered
candidate where rebuildable, wall, tokens and unknown-usage calls. Pairs per sample and per task as
wins, losses and ties. Artifact correctness, verdict accuracy and experiment validity are reported
separately.
