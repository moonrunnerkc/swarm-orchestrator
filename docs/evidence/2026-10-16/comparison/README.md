# Comparison of 2026-10-16: Swarm and OpenCode on four fresh tasks

The 2026-10-15 comparison ([../../2026-10-15/comparison/protocol.md](../../2026-10-15/comparison/protocol.md))
had a calibration gate that neither tool passed. This run drops that gate, as authorized, and
otherwise runs as registered. The amendment, the frozen plan and the readiness evidence are in
[protocol-amendment.md](protocol-amendment.md).

**Decision: no demonstrated benefit.** Stage A does not meet the spending rule, so stage B did not
run and nothing here supports a larger study under this configuration.

Both tools' patches passed the frozen hidden oracle on all four tasks, with no scripted
correction and no false completion claim under that oracle. **Amended:** a dated post hoc audit
([correctness-amendment/](correctness-amendment/README.md)) found both mime patches wrong on
line-terminator cases the oracle never tried, so "correct patch" below means "passed the frozen
oracle", and on mime it is not correct against the task's own rule. The scores are unchanged.
OpenCode delivered all four. Swarm delivered three, and refused its own correct
csstree upgrade because of a product defect, described below. Swarm was also slower and used
more tokens per delivery.

## Stage A, paired

Records, patches and the evidence they cite are in [stage-a/](stage-a/). The table is
re-derived by `node scripts/pilot/analyze.mjs --evidence docs/evidence/2026-10-16/comparison/stage-a`
([stage-a/results.md](stage-a/results.md), [stage-a/analysis.json](packed-derived/stage-a-analysis/) (the file stage-a/analysis.json, packed on 2026-10-21 to keep the tree's weight headroom; `scripts/evidence-pack.mjs` restore gives the bytes back)).

| task | arm | correct patch | delivered | corrections | claim (reviewed) | agent time | end-to-end | tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pako-feature-inflate-push-after-end (feature) | Swarm | yes | yes | 0 | completion, true | 76 s | 97 s | 136,822 |
| | OpenCode | yes | yes | 0 | completion, true | 32 s | 44 s | 125,544 |
| csstree-upgrade-esbuild-0-24 (upgrade) | Swarm | yes | **no**: its own verdict refused it | 0 | none ("not accepted") | 60 s | 78 s | 137,297 |
| | OpenCode | yes | yes | 0 | completion, true | 24 s | 33 s | 134,166 |
| mime-bugfix-gettype-line-terminators (bug fix, security) | Swarm | yes | yes | 0 | completion, true | 166 s | 181 s | 384,799 |
| | OpenCode | yes | yes | 0 | completion, true | 30 s | 41 s | 114,637 |
| pako-refactor-options-default-param (refactor) | Swarm | yes | yes | 0 | completion, true | 118 s | 138 s | 346,650 |
| | OpenCode | yes | yes | 0 | completion, true | 54 s | 66 s | 262,819 |

| measure | Swarm | OpenCode | Swarm's result |
| --- | --- | --- | --- |
| correct deliveries | 3 of 4 | 4 of 4 | loss |
| delivered without correction | 3 | 4 | loss |
| false completion claims | 0 | 0 | tie |
| scripted corrections | 0 | 0 | tie |
| launches killed at the wall | 0 | 0 | tie |
| correct patches, delivered or not | 4 | 4 | tie |
| end-to-end minutes per correct delivery (all work counted) | 2.7 | 0.8 | loss |
| comparable tokens per correct delivery (all work counted) | 335,189 | 159,292 | loss |
| security property (mime: U+2028, U+2029, CR and LF before the extension) | held | held | tie |
| the task's full rule on mime, audited after the fact ([amendment](correctness-amendment/README.md)) | 30 of 65 terminator cases wrong | 20 of 65 wrong | not a decision measure |
| lint and type checks where they pass at the base | pass | pass | tie |
| file scope and other dependencies | inside, none changed | inside, none changed | tie |
| review rubric, discretionary (design / scope / comments, 1 to 3) | 11 / 12 / 12 | 11 / 10 / 11 | not a decision measure |

How the rows are measured:

- **Comparable tokens** count every prompt and completion token once, as the server counted them.
  Neither arm reported reasoning or cached tokens, and every call reported its usage.
- **Agent time** is the arm's solving time. Preparation was 0.6 min (Swarm, including its gate-plan
  check) and 0.1 min (OpenCode) over the four launches, scoring 0.6 and 0.7 min, and cleanup
  under 0.2 s per launch, reported apart.
- **The rubric** was applied by the reporting assistant under blind letters, except the csstree
  pair; method and notes are in [stage-a/quality-review.json](stage-a/quality-review.json).

**Spending rule** (the 2026-10-15 rule, unchanged):

| item | holds |
| --- | --- |
| eight valid, inspectable records | yes |
| Swarm delivers three of four, including the bug fix and the feature, with no false claim | yes |
| an advantage | **no**: fewer deliveries without correction, no fewer corrections, and the quality route needs equal delivery |
| no worse elsewhere | **no**: deliveries and unresolved launches are losses, and so are both cost measures |

Stage B was frozen beforehand ([manifests/stage-B.json](manifests/stage-B.json)) and was not
launched.

## Why Swarm did not deliver csstree

Swarm's patch is line for line the maintainer's change. It passed every blocking gate, the
sealed visible check and the final verification in a fresh checkout. The advisory `diff-budget`
gate counted 698 added lines against its 600-line budget, almost all of them the regenerated
lockfile that the upgrade preset authorizes. Exceeding that budget does not block by design; it
asks for a justification claim. But the run's verdict counts an unjustified advisory failure as
`policy fail`, and the loop never asked the model for the justification: no repair was due, and no
model call followed the gates.

The report then said "outcome: not accepted" and gave as its blocker a line that is not the
blocker ("final ratchet and bonds accepted the completed work"). This is a product defect, found
after the freeze under a working instrument. It stands as Swarm's result and is not re-run.

Follow-ups:

- ask for the justification, or exclude a preset's authorized lockfile from the size budget;
- name the actual blocker in the outcome block.

Both are done after this report, with the refusal reproduced from the original base on the
measured build and accepted on the repaired one:
[../development/csstree-lifecycle/](../development/csstree-lifecycle/README.md). Stage A's
result is unchanged by that repair.

The preflight replays did not catch it. A patch applied before a replay run is the baseline for
the product's inspection gates, so the replayed reference measured 0 added lines. That is a limit
of the replay instrument, stated here and in the amendment's readiness section.

## Cost of the assignment

| live allowance | ceiling | used |
| --- | --- | --- |
| launches | 16 | 8 (stage A); no probe, no rerun, no stage B |
| agent-minutes | 240 | 9.3 (Swarm 7.0, OpenCode 2.3) |
| stage A wall time | | 11.4 min (2026-10-16 20:15:58Z to 20:27:23Z), one launch at a time |

The deterministic work (repairs, regressions, builds, replays, validation, budget proof, publishing,
analysis) ran from about 18:12Z to 20:15Z before the freeze and about 20:27Z to 21:00Z after it.
No paid model was used. The model was Ollama `qwen3.6:35b-a3b` on this host; the configuration is
in the amendment.

## Readiness, replays and repairs

All are in the amendment's readiness section, with links:

- task validation on this host;
- the budget proof through the real runner and the pinned build;
- the prompt-delivery check;
- Swarm's acceptance path accepting every reference and refusing every base (the preflight
  replays, kept for each build they ran on);
- the product and launcher defects repaired before the freeze.

The verification replay of the two retained OpenCode argparse calibration patches is in
[replay-calibration/](replay-calibration/). Swarm accepts both, as the sealed visible criterion
and the project's checks allow, and the hidden oracle rejects both. That is a coverage limit of
the sealed criterion, not a misreport.

## Limitations

- Four tasks and one launch per arm per task. Equal correctness here says nothing about harder
  tasks, and the model is one local model on one server.
- The arms are matched on the wall, not on tokens. Swarm's 8,000,000-token allowance never bound.
- Neither tool runs in a sandbox. The security result is the mime task's tested property only.
- Claims and rubric were judged by the reporting assistant. The claim rule is explicit and
  quoted per launch in [stage-a/claims-review.json](stage-a/claims-review.json); the rubric is
  discretionary.
- Reproducibility:
  - fixed artifacts: every published patch re-scores the same by the frozen oracle
    ([stage-a/recheck.json](stage-a/recheck.json));
  - stable generation across repeats: not measured, because stage B did not run.
- Developer time saved is not measured.
