# Controller progress stage, October 23, 2026

This stage corrects what Swarm's adaptive controller reads as progress, makes an intervention
followed by a bounded reassessment, and adds support for delegating and mechanical edits. A
development study on two exposed tasks and a small registered fresh block followed. Everything
ran on `qwen3.6:35b-a3b` through local Ollama, and paid inference was $0.

**Bottom line.**
- Two decision-input defects were reproduced and corrected, along with two more the replay and the
  studies exposed.
- The revised controller was exercised live: diagnoses, follow-up looks and reassessments. No
  delivered artifact is shown to have improved because of the revision.
- On the fresh block revised Swarm completed 1 of 6 launches. OpenCode and the simple same-model
  baseline completed none.
- On the development tasks the revised implementation completed 2 of 4 launches, against 3 of 4
  for the implementation it replaces and 0 of 4 for the baseline.
- These are counts from small blocks. They are not a superiority result.

## 1. Decision-input defects

| Defect | Reproduced | Live occurrence | Correction |
| --- | --- | --- | --- |
| **A.** A later unrelated success closed an open failure. After an edit and a failing `npm test`, a successful `ls` made the decision continue. | Function level; through the controller (`agent-run.test.ts`, case A); in a live trace | dev-3 entities, repair loop `attempt 1`: `npm run lint` exited 1 at step 15, `sed -n` exited 0 at step 16, and v1 continued. That launch still delivered a complete change, so no loss is attributed to it. | Check results are kept per subject, and inspections (`ls`, `sed -n`, `grep`, `git diff`, ...) are never check results. A failure stays open until the same check passes on a later tree, or a known change makes it stale. |
| **B.** A shell write after a passing check left both in one generation, so the check was described as current. | Function level; through the controller (case B) | Shell writes did occur in published runs (fastify's `mv`s, `biome --write`). None of those records shows a decision that misdescribed a check because of one, but their effects were never measured. | Every shell command's workspace effect is measured through one scratch index kept for the run. A changed tree starts a new generation, and an unmeasured effect marks earlier results as possibly changed. The cost is a median 68 ms per measurement, 3.2 s across a 629 s fastify launch. |
| A filter's or fallback's status (`npm test \| tail`, `\|\| true`, `; echo`), a refusal and a timeout read as results. | Function level | Not separately counted | Recorded as unknown or not run: uncertainty, never a pass or a failure. |
| Retrieval of names the loop had already been shown. | Replay | held-out fastify step 16 and dev-3 acorn step 16 both retrieved names that a listing or an earlier search had shown | Retrieval runs only for names absent from every result the loop received. |

[Replay](replay/adaptive-stage-v2.json) of all 23 recorded v1 decisions through v2, with no model:
3 change (the entities lint case, and the fastify and acorn retrievals, which become diagnoses).
The replay rebuilds each worker conversation from the linked transcript chain. A first replay
window read the diagnosis's own messages and missed the decision's last step, so it wrongly
showed a fourth change at p-limit. That artifact was found and corrected before the result above
was recorded.

## 2. Interventions

Reconstruction of the held-out fastify `swarm` run (rule v1):
- By step 10 the worker had listed `lib/` and had searches matching 51 and 100 references to the
  old names.
- At step 16 the retrieval re-searched two of those names. It added nothing new: the "missing"
  names came from one path-qualified search that matched nothing.
- The worker then re-read the 34 kB generated `configValidator.js` and the other files, declared
  its file set twice (one attempt was refused for its shape), and never edited.
- Nothing about the tools prevented edits. The other two arms renamed the same files with
  `mv` in one or two steps. The missing piece was the implementation decision to move rather than
  rewrite, together with the one-reference-per-step cost of the edits that follow.

Revised behaviour:
- Each intervention records what it was for: a change landing, or the failures it was about
  closing.
- A free look follows after a tenth of the loop's steps. If the worker is learning something new,
  it looks once more; if not, one reassessment asks for a concrete action, which the harness
  carries out through the worker's own chokepoint.
- A loop gets at most two interventions and three decisions, all inside its own allowance
  ([description](../../adaptive-problem-solving.md)).

## 3. Edits

These apply to every run, not only adaptive ones.

**Batch edits.** `edit` takes `edits: [...]`, applied all or none. Move results and "replaced text
still occurs" notes point at that form.

**A reason before a rewrite drops an existing implementation.** An edit is held when its replaced
code calls a function the workspace defines, the new code stops calling it, and at least three
times as many lines take its place (at least twelve). The hold quotes the task's own words about
behaviour to keep.

**A requested-tests follow-up**, through the existing outcomes slot, when the task asks for tests
and the candidate changes no file that could hold them.

**The task's sentences on what to keep and deliver** are carried in every working state, decision
notice and repair brief.

## 4. Development study (exposed tasks; development material only)

[Protocol](development-protocol.md), [launch log and corrections](development-launches.md).

| Arm | Build | Flags |
| --- | --- | --- |
| `swarm-previous` | `fa190998c` (v1) | `--adaptive` |
| `swarm` | `6c054712e` (v2) | `--adaptive` |
| `swarm-direct` | `6c054712e` | `--attempts 0` |

Two samples per cell, 12 launches, no setup failure or halt.

"Complete" means: the hidden evaluator passes, the visible check and project tests pass, lint
passes where the base passes it, and where the task asks for tests, at least one added test fails
on base source and passes on the delivered source
([sensitivity](development/sensitivity/)).

| Task, sample | `swarm-previous` | `swarm` | `swarm-direct` |
| --- | --- | --- | --- |
| p-limit 1 | complete (240 s) | complete (371 s) | hidden fail (182 s) |
| p-limit 2 | complete (420 s) | complete (198 s) | hidden pass, project tests fail (195 s) |
| fastify 1 | **complete**, refused by the product (611 s) | fail (629 s) | fail, no change (580 s) |
| fastify 2 | fail (616 s) | fail (612 s) | fail (232 s) |

Pairs, wins / losses / ties:

| Pair | p-limit | fastify | Total |
| --- | --- | --- | --- |
| `swarm` vs `swarm-previous` | 0 / 0 / 2 | 0 / 1 / 1 | 0 / 1 / 3 |
| `swarm` vs `swarm-direct` | 2 / 0 / 0 | 0 / 0 / 2 | 2 / 0 / 2 |

Repair gains: two complete launches had failing first candidates and were completed by repair.
- p-limit 1 `swarm`: its initial candidate failed the project tests.
- p-limit 2 `swarm-previous`: its initial candidate failed `tsd`.

The other two p-limit completions were first-attempt successes
([initial candidates](initial/)).

Mechanisms ([accounts](development/mechanism/)):
- **Shell effects.** Measured on every revised shell command, with references named after moves.
- **Reassessment.** It ran once, at fastify 2 `swarm` step 25, and named one command that moved
  all eleven files. The guard refused it, because it began `cd /home/user/repos/fastify`, a
  directory the model invented.
- **Edit holds.** No rewrite hold fired. Both adaptive arms delegated to `pLimit` on their own in
  all four p-limit launches. The baseline's p-limit 1 rewrote the queue but kept one `pLimit(`
  call, which the lexical reading does not count as dropping the implementation.
- **Batch edits.** No worker used the batch form. Fastify 1 `swarm` reached its forty-step limit
  moving eleven files and updating references one call at a time.
- Corrections made from these records, before the fresh block: the reassessment brief names the
  workspace root and asks for no `cd`, and move results and the edit tool's description name the
  batch form.

## 5. Fresh block 2 (three tasks no earlier stage used)

[Selection rule](heldout-2-selection-rule.md), [protocol](fresh-block-protocol.md),
[launch log](fresh-block-launches.md). The tasks are listed in
[`fresh/public-summary.json`](fresh/public-summary.json), with the selection record beside it.

- **Evaluators.** A separate evaluator author prepared them with no inference. Each was validated
  against the base, the reference, an alternative correct patch, an absence-assertion control and
  four to six faulty controls.
- **Arms.** `swarm` (build `47b5c1e23`, `--adaptive`), `swarm-direct` (same build, `--attempts 0`)
  and OpenCode 1.19.4. Two samples, 18 launches.

| Task, sample | `swarm` | `swarm-direct` | `opencode` |
| --- | --- | --- | --- |
| markdown-it rename (53 files), 1 | **complete**, refused by the product (531 s) | fail (146 s) | fail (253 s) |
| markdown-it rename, 2 | fail: Node module-type warning (620 s) | fail (104 s) | fail: renamed the CommonJS bundle (536 s) |
| svgo bug fix, 1 | fail, accepted by the product (475 s) | fail, accepted (173 s) | fail (142 s) |
| svgo bug fix, 2 | fail, accepted (181 s) | fail, accepted (153 s) | fail (88 s) |
| markdown-it feature, 1 | fail (623 s) | fail (184 s) | fail (351 s) |
| markdown-it feature, 2 | fail (614 s) | fail, accepted (159 s) | fail (397 s) |

Complete delivery:
- `swarm` 1 of 6;
- `swarm-direct` 0 of 6;
- OpenCode 0 of 6.

Pairs, wins / losses / ties:
- `swarm` vs OpenCode: 1 / 0 / 5;
- `swarm` vs `swarm-direct`: 1 / 0 / 5.

**Evaluator audit, after the block.** Every failure traces to a requirement the task text states:
- **svgo.** All six miss `<alias:a xmlns:alias="...svg">`, an anchor whose prefix is declared on
  the element itself, which the task names ("counting declarations on the element itself").
- **markdown-it feature.** Four of six fail "line breaks around kept reference tokens", the
  renderer requirement the task gives with an example. Two broke the linkify override, a
  preservation regression.
- **markdown-it rename.** OpenCode produced `dist/markdown-it.cjs` where the task requires
  `dist/markdown-it.cjs.js`. Swarm sample 2 trips the module-type warning the task names.

No false negative of the fastify kind was found.

**Mechanisms** ([accounts](fresh/mechanism/)):
- **Reassessments.** Three ran:
  - markdown-it feature 1: named a correct-looking edit batch, which the file set refused because
    nothing was declared yet;
  - markdown-it feature 2, a repair loop: its "action" was `git diff --stat; ls`, an inspection;
  - one more had too little allowance left and was withheld.
- **Batch edits.** Workers used them twice: 3 files in the complete rename, 8 files in a baseline
  launch.
- **Rewrite holds and requested-tests follow-ups.** None fired: the follow-up was withheld every
  time the gates were not green, or no attempt remained.
- The one complete delivery went through three repair loops. Its initial candidate cannot be
  rebuilt (the brief truncated the diff), so repair gain is unmeasured there.

Corrections after the block, tested deterministically but not live:
- a reassessment's edit declares or amends its files through the chokepoint first;
- a shell "action" that only inspects is not carried out.

Neither changes any number above.

## Verdict accuracy (separate from artifact correctness)

| Study | Correct verdicts | False refusals | False accepts |
| --- | --- | --- | --- |
| Development, 12 Swarm launches | 11 | 1 | 0 |
| Fresh, 12 Swarm launches | 6 | 1 | 5 |

- **The two false refusals share one cause:** the instrument rule. Task acceptance refuses a change
  when a check passes only with the patch's change to a runner or build configuration file
  (`eslint.config.js`, `support/build-dist.mjs`). Both refactor tasks require editing exactly that
  file. Both complete refactor deliveries of this stage were refused this way. That rule is the
  anti-tampering boundary; it is reported here and not loosened in this stage.
- **The five false accepts are svgo (4) and one markdown-it feature launch.** No gate exercises
  the stated case the change misses.
- OpenCode reports no verdict. It claimed success on all 6 of its fresh launches, and none is
  complete.

## Cost

| Study | Arm | Launches | Wall | Tokens |
| --- | --- | --- | --- | --- |
| Development | `swarm` | 4 | 1,810 s | 7.55 M |
| Development | `swarm-previous` | 4 | 1,886 s | 6.94 M |
| Development | `swarm-direct` | 4 | 1,190 s | 4.50 M |
| Fresh | `swarm` | 6 | 3,045 s | 18.84 M |
| Fresh | OpenCode | 6 | 1,766 s | 11.55 M |
| Fresh | `swarm-direct` | 6 | 918 s | 6.06 M |

- No launch had an unknown-usage call.
- Every diagnosis, follow-up, reassessment, repair and verification cost is inside these totals.
- On the fresh block, revised Swarm spent about 1.7× OpenCode's wall and 1.6× its tokens for one
  complete delivery more.

## Experiment validity

- **Two zero-inference setup corrections on the fresh block**, both recorded:
  1. A product defect: a `pnpm-workspace.yaml` of settings only read as an unlisted workspace.
     Fixed with a test, then refrozen.
  2. A harness gap: a declared pnpm was absent from every arm's PATH. Fixed and recorded through
     the runner.
- **A departure from the protocol.** The runner's progress line shows hidden verdicts, and the
  implementer read the first three while diagnosing setup correction 2, before the block ended.
  Nothing was frozen differently because of it.
- **A flaky upstream test.** A timing-dependent fastify base test (`test/issue-4959.test.js`)
  failed once under load in the development preflight. It can affect any Swarm arm's gates on
  fastify.
- The fresh tasks are now exposed and become development material.

## Portfolio readiness

The broader portfolio described on October 22 was a plan, not prepared tasks
([note](../2026-10-22-adaptive/portfolio-preparation.md)).

| Stage | Tasks | Status |
| --- | --- | --- |
| Metadata candidates | 20 identities ([inventory](../2026-10-22-capability/candidates.json)) | unvalidated |
| Validated, launched, now exposed | block 1 (4) and block 2 (3) | every task has its frozen base, task text, deliverables, a validated evaluator with reference and control results, an exposure scan, and its preparation scripts (`validate-heldout.mjs`, `build-registry.mjs`, beside the sealed material) |
| Validated and unexposed (launch-ready) | none | — |

The next study needs a new sealed preparation. Its cost would be roughly an hour of
evaluator-author work per task, then 12 minutes per launch. Block 2's evaluators include the
absence-assertion control and judge semantic use, not mentions of old names.

## What remains unproven

- That any revised mechanism improves a delivered artifact. None was shown to.
- That revised Swarm beats OpenCode or its own baseline in general. The counts are 1 of 6 against
  0 of 6, on three exposed-now tasks.
- That the reassessment's carried-out action helps. Live, it was refused twice and ran an
  inspection once; the corrections for those cases are tested but not live.
- That the rewrite reading changes a decision. It never fired, and its lexical reading can be
  evaded by keeping one call.
- That verdicts are reliable on refactors (instrument-rule false refusals) or on stated edge cases
  no gate exercises (false accepts).

## Evidence

- Records, mechanism accounts, patches, sensitivity and initial-candidate scores: under
  [`development/`](development/), [`fresh/`](fresh/) and [`initial/`](initial/).
- Released sealed material (evaluators, references, controls, validation log):
  [`fresh/sealed/`](fresh/sealed/).
- Session ledgers and blobs are archived on the branch `evidence/2026-10-23-controller-sessions`.
