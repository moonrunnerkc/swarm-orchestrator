# Fresh comparison of 2026-10-16: Swarm and OpenCode, four tasks, two repetitions

**Decision under the frozen rule ([protocol.md](protocol.md)): no demonstrated benefit.** On
every decision measure Swarm was behind or level:

- **Deliveries, scored by the frozen oracle:** OpenCode 8 of 8 launches, Swarm 7 of 8. These are
  the scores and they stand. They are not counts of patches that meet the task: the coverage
  audit below found one more delivered patch from each tool, css-select repetition 2, that the
  task text refutes. Against the stated rules where audited, that is 7 of 8 for OpenCode and 6 of
  8 for Swarm (Swarm's node-tar repetition 2 and css-select repetition 2; OpenCode's css-select
  repetition 2). Only css-select was audited; the other counts are frozen-oracle passes.
- **False completion claims, by the frozen oracle:** Swarm made one, on node-tar, where its own
  acceptance passed a patch the hidden oracle rejects. OpenCode made none. Both css-select
  repetition-2 reports also claimed completion over a patch the audit refutes; the count stays as
  defined against the frozen oracle.
- **Configuration:** Swarm ran its default configuration, with planned checks (`--plan-checks`)
  disabled. This comparison did not evaluate the planned-check workflow.
- **Cost:** Swarm took about twice the end-to-end time per correct delivery and about 17 per cent
  more tokens per correct delivery.
- **Corrections and killed launches:** none for either tool.

## Registration and running

- **Frozen before the first launch** (commit `a50d72f0f`):
  - the tasks, the pool and the exclusions ([candidates.md](candidates.md));
  - the protocol;
  - the manifest ([manifests/stage-A.json](manifests/stage-A.json)).
- **Instruments validated on this host before the freeze:**
  - [validation/](validation/), the harness's own validator;
  - [preflight/replays/](preflight/replays/), Swarm's acceptance path on each reference and base.
- **Run:** all 16 launches ran once, from 01:18:48Z to 02:02:20Z on 2026-10-17, one at a time.
  There were no halts, recoveries, reruns or scripted corrections, and no person interacted with
  either tool.
- **Model:** Ollama `qwen3.6:35b-a3b` with thinking off, the same for both tools.
- **Tools:** Swarm build `dca2e5953` in its default configuration; OpenCode 1.14.48.

Records, patches, sessions and blobs are in [stage-a/](stage-a/). The tables are re-derived by
`node scripts/pilot/analyze.mjs --evidence docs/evidence/2026-10-16/fresh-comparison/stage-a`
([stage-a/results.md](stage-a/results.md)). Claims are classified under `final-report-claim-v1`
in [stage-a/claims-review.json](stage-a/claims-review.json).

## Results

| measure | Swarm | OpenCode | Swarm's result |
| --- | --- | --- | --- |
| correct patches (frozen oracle) | 7 of 8 | 8 of 8 | loss |
| correctly delivered (frozen oracle) | 7 of 8 | 8 of 8 | loss |
| false completion claims (frozen oracle) | 1 | 0 | loss |
| scripted corrections | 0 | 0 | tie |
| launches killed at the wall | 0 | 0 | tie |
| end-to-end minutes, all 8 launches | 27.1 | 16.1 | loss |
| end-to-end minutes per correct delivery | 3.9 | 2.0 | loss |
| comparable tokens, all 8 launches | 5,616,480 | 5,497,010 | about equal |
| comparable tokens per correct delivery | 802,354 | 687,126 | loss |
| preparation, all launches (reported apart) | 1.7 min | 0.1 min | |
| human interactions | 0 | 0 | tie |

By task, each cell is repetition 1 / repetition 2. Times are end-to-end minutes.

| task | Swarm delivered | OpenCode delivered | Swarm time | OpenCode time | Swarm tokens | OpenCode tokens |
| --- | --- | --- | --- | --- | --- | --- |
| domutils upgrade (htmlparser2 12) | yes / yes | yes / yes | 1.2 / 1.2 | 0.5 / 0.7 | 63,723 / 65,446 | 73,886 / 201,840 |
| tar bug fix (negative sizes, two files) | yes / **no** | yes / yes | 5.0 / 5.6 | 2.4 / 1.8 | 648,378 / 949,576 | 623,485 / 549,315 |
| json5 refactor (parser-state switch) | yes / yes | yes / yes | 1.9 / 3.0 | 1.1 / 2.2 | 768,956 / 932,604 | 284,802 / 847,432 |
| css-select feature (`:lang()`) | yes / yes | yes / yes | 4.9 / 4.4 | 2.9 / 4.7 | 1,200,358 / 987,439 | 967,261 / 1,948,989 |

The decision rule, item by item:

| route | holds |
| --- | --- |
| 1. at least two more correct deliveries, no more false claims or corrections, at most twice the time per delivery | **no:** one fewer delivery and one more false claim |
| 2. equal deliveries, false claims and corrections no worse, at least 25 per cent less time and tokens per delivery | **no:** deliveries are not equal, and Swarm took more time and tokens per delivery |

## The one failed delivery

**What was wrong.** Swarm's tar repetition-2 patch
([stage-a/patches/tar-bugfix-negative-size-r2.swarm.patch](stage-a/patches/tar-bugfix-negative-size-r2.swarm.patch))
split `case 'size'` out of a fall-through group in node-tar's `pax.ts`. `dev`, `ino` and `nlink` now
fall into the new block, which drops negative values. The task says every other field keeps its
current parsing, negative values included. The task-authored hidden check catches this:
`Pax.parse('10 uid=-1\n').uid` is `undefined`, expected `-1`.

**Why Swarm accepted it.** Swarm's acceptance had only:
- the visible check, which is one assertion about `new Header({ size })`;
- the project suite, which does not test negative values of the other fields.

It accepted the patch and reported "outcome: accepted". That is a completion claim the oracle
rejects. Swarm's repetition 1 and both of OpenCode's patches handled the same case correctly.

## Repeatability (two runs per tool per task, not a guarantee)

| task | Swarm | OpenCode |
| --- | --- | --- |
| domutils | consistent: both delivered | consistent |
| tar | **inconsistent:** delivered once, false claim once | consistent |
| json5 | consistent | consistent |
| css-select | consistent under the frozen oracle; the audit below differs | consistent under the frozen oracle; the audit below differs |

## Coverage audit after scoring (an oracle gap, not a re-score)

The protocol registered this audit. It was run on css-select, where the candidate list disclosed
that the upstream tests do not exercise empty language values, singleton subtags or `xml:lang`
precedence.

[coverage-audit/audit-css-select.mjs](coverage-audit/audit-css-select.mjs) builds each delivered
patch and the maintainer's reference, then runs 14 cases quoted from the task text
([output](coverage-audit/audit-css-select.json)). The reference passes all 14, so the task-text
reading agrees with the maintainer.

| patch | wrong of 14 | cases |
| --- | --- | --- |
| Swarm repetition 1 | 0 | |
| Swarm repetition 2 | 3 | no-language (should match `:lang("")`); `lang=""` inside `lang="en"` matched `:lang(en)`; `lang=""` did not match `:lang("")` |
| OpenCode repetition 1 | 0 | |
| OpenCode repetition 2 | 2 | no-language; `lang=""` did not match `:lang("")` |

Both tools delivered one css-select patch that the frozen oracle accepts and the task text
refutes. The scores stand as recorded, and these are reported as the oracle's gap. Those two
deliveries are counted as correct only under the frozen oracle; neither meets the task's stated
rules, and each tool's report claimed completion for it.

## Instrument notes

- **OpenCode's workspace holds the harness's `opencode.json`.** In css-select, Biome reports it as
  a lint error. Both of OpenCode's css-select reports name that file and say it is outside the
  change, which is true. The scoring checkout does not contain it, and the reports are classified
  as completion claims.
- **The claim review was not blind:** the oracle's verdicts were known when the reports were read.
  No report's class depends on its verdict. Every OpenCode report says the change is done, and
  every Swarm report is its own outcome block.
- **Swarm's preparation** (1.7 minutes over 8 launches) includes its base preflight of the sealed
  check, which OpenCode does not run.
- **No sandbox for either tool.** The security result is tar's tested property only.

## What these failures do and do not show

None of the failed or refuted deliveries is attributed to a limit of the model. Swarm's node-tar
repetition 2 passed its own acceptance because that acceptance held no check of the other pax
fields, which is a product gap the planned-check work of 2026-10-17 addresses
([docs/evidence/2026-10-17/planned-check-live/](../../2026-10-17/planned-check-live/README.md)).
The css-select gaps were in the frozen oracle. With one local model, two runs per task and those
instrument gaps, the record cannot separate what the model could do from what the products and
the oracle let through.

## What remains uncertain

- Four tasks, two runs each, one local model and one server. This is a bounded observation, not
  an estimate of either tool's general rate.
- The tasks are historical public changes and may be in the model's training data.
- Developer time saved is not measured. Interactions are counted, and there were none.
