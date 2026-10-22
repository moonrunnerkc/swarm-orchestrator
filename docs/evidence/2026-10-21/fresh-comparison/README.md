# Two fresh mocha tasks, Swarm against OpenCode, 2026-10-21 evening

Registered in [protocol.md](protocol.md) before any inference; every launch in
[launches.md](launches.md); the runner's records in [records/](packed-derived/records/) and its rendered
[results.md](results.md); the Swarm sessions, the patches, every arm's output stream and the
stage's scores in [packed-derived/payloads](packed-derived/payloads/)
(`node scripts/evidence-pack.mjs restore docs/evidence/2026-10-21/fresh-comparison/packed-derived/payloads`).
The product was frozen at `736251101` (the corrected assessment of
[../task-continuation/README.md](../task-continuation/README.md), section 6, and the unknown-usage
count); same model (`qwen3.6:35b-a3b` on Ollama 0.32.14), same task words, starting tree, scope,
visible checks and 9-minute wall for both arms. Four launches, 16.2 agent-minutes, no relaunch.

## Results

**A. Artifact quality**, each exact delivered tree scored independently: the hidden oracle (the
upstream test file overlaid, a check of every example the task text states, the unit suite), the
tree's own visible check and unit suite, and the regression tests it adds read on the delivered
tree and over the base's source ([score-tests.mjs](score-tests.mjs)).

| task | arm | hidden oracle | visible check, unit suite | regression tests added (fail over base source) | artifact |
| --- | --- | --- | --- | --- | --- |
| unparse attached values | Swarm (launch 0, kept workspace, scored after the halt) | pass | pass, pass | 4 (4) | correct and complete |
| unparse attached values | OpenCode (launch 1) | pass | pass, pass | 2 (2) | correct and complete |
| long-prefix short alias | OpenCode (launch 2) | pass | pass, pass | 8 (6; the other 2 hold behaviour the base had) | correct and complete |
| long-prefix short alias | Swarm (launch 3) | fail (exit 3) | pass, **fail (3 tests)** | 0 | not correct: `-t 10` and `-j 4`, which the task said must not change, now throw |

**B. Product delivery behaviour.**

| launch | exit | lifecycle | claim | what the product said | against A |
| --- | --- | --- | --- | --- | --- |
| 0 Swarm | 4 | `completed` | none | `unverified`: "the final verification could not measure the change"; build and tests gates `n/a` because "this change altered the instrument that measured it (lib/cli/unparse-args.js)"; named its 4 added cases | **a refusal of a correct, complete artifact**, from a product defect (below) |
| 1 OpenCode | 0 | | claimed | finished with a summary | accurate |
| 2 OpenCode | 0 | | claimed | finished with a summary | accurate |
| 3 Swarm | 1 | `max-wall-time` | none | `not accepted`: tests and task-acceptance failed, no test file added, repair attempt 1 rejected by the ratchet, attempt 2 withheld for want of wall | accurate: the artifact is wrong and the product said so |

**C. Cost** (arm wall from spawn to exit; tokens as each product reported them; readiness and
scoring apart; no human intervention in any launch).

| task | Swarm | OpenCode |
| --- | --- | --- |
| unparse | 324.5 s, 148,823 tokens | 62.8 s, 300,146 tokens |
| alias | 468.5 s, 1,416,957 tokens (a lower bound: 2 calls reported no usage) | 113.7 s, 549,895 tokens |

**Swarm's repair** ([reconstruct-first.mjs](reconstruct-first.mjs), both first candidates rebuilt
to their recorded digests, `scored/first-*.json` in the pack). Launch 0: no repair ran (escalated
after 0 of 3 attempts); the delivered tree is the first candidate. Launch 3: attempt 1 spent its
24 steps, was cut at the wall, and was rejected by the ratchet (lint passed before it and failed
after) and rolled back; attempt 2 was withheld; the delivered tree is the first candidate. Repair
neither improved nor damaged either artifact: it changed nothing delivered.

**Exposure** ([exposure-search.mjs](exposure-search.mjs), `scored/exposure.json`): no stream or
evidence file of the four launches names the mirror, this repository's path or an upstream id.

## Answers

- **Which product produced the better artifact?** Unparse: equivalent; both trees are correct and
  add regression tests that fail on the base (Swarm 4, OpenCode 2; the protocol does not rank the
  count). Alias: OpenCode's; Swarm's tree breaks behaviour the task said must not change and adds
  no test.
- **Did Swarm's repair improve its first candidate?** No. It ran on one task, was rolled back, and
  left the first candidate delivered.
- **Did Swarm's additional machinery improve correctness or meaningful test coverage?** No. It
  added a refusal of a correct tree (launch 0) and an accurate refusal of a wrong one (launch 3),
  but no correctness and no test OpenCode lacked.
- **What did it cost?** Swarm used 13.2 arm-minutes against OpenCode's 2.9 and 1,565,780 tokens
  (lower bound) against 850,041, and delivered one correct artifact to OpenCode's two.
- **Human intervention?** None in any launch.
- **Did Swarm outperform OpenCode on either task?** No.

## What the launches showed about the product

**A test-runner project's own source is read as the instrument.** In launch 0 each of the three
independent verifications (records 110, 133 and 156 of session `20261021T213030-b3dabd`) puts
`lib/cli/unparse-args.js` in the configuration files of every check, because the `mocha` tool
rule's closure resolves the `mocha` package to the project itself. The tests check then reads
`not-applicable` ("this change altered the instrument that measured it"), the sealed acceptance
gate's inspection exits 1 as "setup unavailable" (record 134), repair is classed unavailable (135),
and the run exits 4 with a correct, complete tree. Any change to mocha's `lib/` meets this; the
alias launch failed earlier, on its own work. Not fixed in this stage: the protocol forbids a
product change between the scored arms, and a fix needs its own registered trial.

**The alias run did not finish its work inside its share.** The first loop used its 40 steps on a
source change that passed the visible check (which asks only for `--t`) and broke the one-dash
forms, with no test written; the one repair attempt that ran was cut at the model-work cutoff
after 24 steps, and the ratchet rejected it because lint, which passed before it, failed after.
OpenCode's run delivered a correct change and 8 tests in 114 s.

**The corrected assessment, live.** Launch 3's worker assessment is `run-acceptance-v5` with
lifecycle `max-wall-time` and `wallStop` `{ beforeDeadline: true, effectsSettled: true }`: the
cut was the model-work cutoff, and the run was still refused, because its checks failed. The
correction lifted the refusal of a verified tree, not the refusal of a failing one.

## Limits

Two small bug fixes in one repository, one model, one host, one launch per arm per task. The
unparse task is a one-line source change; the alias task's upstream change is four lines. The
upstream fixes are public and may be in the model's training data. One of the two pairs is
decided by a product defect specific to projects that run their own tests. Nothing here measures
either product on larger work or with another model.

## Reproduction

    node scripts/evidence-pack.mjs restore docs/evidence/2026-10-21/fresh-comparison/packed-derived/payloads
    # the patches are payloads/patches/*.patch, the Swarm sessions payloads/launch-{0,3}/session-*
    node scripts/comparison/rescore.mjs --stage docs/evidence/2026-10-21/fresh-comparison --task <id> --arm <arm> --patch <patch> --out <json>
    node docs/evidence/2026-10-21/fresh-comparison/score-tests.mjs --manifest docs/evidence/2026-10-21/fresh-comparison/manifest.json --task <id> --patch <patch> --label <name> --out <json>
    node docs/evidence/2026-10-21/fresh-comparison/reconstruct-first.mjs --manifest docs/evidence/2026-10-21/fresh-comparison/manifest.json --task <id> --session <restored session> --out <dir>
    node docs/evidence/2026-10-21/task-continuation/assessment-replay/usage-account.mjs <restored session>

The launches themselves: `node scripts/comparison/run.mjs --manifest docs/evidence/2026-10-21/fresh-comparison/manifest.json`
with the pinned build (`736251101`, built as [launches.md](launches.md) records) and OpenCode
1.14.48 against the same Ollama model; inference is not deterministic, so a rerun is a new sample,
not a replay.

## Correction, 2026-10-22

[correction-2026-10-22/](correction-2026-10-22/README.md), appended; nothing above is rewritten. The
OpenCode alias patch passed the frozen evaluation but returns before the base's long-alias
normalization: `--timeouts 200` throws, `--reporter-options a=b` and `--globals window` read as
`["true"]` with the value left as a spec, and ESLint reports `no-unreachable`. Under the task's
broader requirements neither alias artifact is correct; that is not a Swarm win. The Swarm alias
repair made no edit, and its lint "regression" was the project's own order-dependent lint, reproduced
on the untouched base.
