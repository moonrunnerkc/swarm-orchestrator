# The three-arm comparison on `yargs-parser-bugfix-count-sentinel`

Registered by [amendment 2](../protocol.md) after the first selected task's Swarm arm halted in the
runner's preparation before any model call ([halted-fxp/](halted-fxp/)). One task from
yargs/yargs-parser, chosen by the rule fixed before the product was frozen, launched in the 2026-10-11
cohorts and not used to develop this work. All arms: `qwen3.6:35b-a3b` on the local Ollama, the
same task text, base, visible check and limits (14 minutes and half a second, killed at 15), no
correction, run by the comparison runner unchanged in the registered order. Swarm is the frozen
build `9a5052750`. Records: the runner's records, streams and the exact patch in [records/](records/);
both Swarm arms' session chains packed losslessly in [packed-derived/comparison-streams](packed-derived/comparison-streams/);
`records/arm*-reading.json` are [../read-launch.mjs](../read-launch.mjs) over those chains, which
re-derive identically from the restored pack.

## Results, correctness first

| arm | hidden oracle on the exact patch | the product's own reading | final verification of the delivered tree | agent wall | tokens | repair |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Swarm, `--plan-checks` | **pass** | `accepted`, exit 0 | completed: tests, `task-acceptance` and `task-diagnostics` passed, independent verification passed (50.6 s, reserve 91.2 s measured) | 497 s (planning 355 s) | 1,881,582 (planning 1,190,697) | none ran |
| 2. Swarm, no workflow flag | **pass** | `accepted`, exit 0 | completed: tests and `task-acceptance` passed, independent verification passed (26.9 s, reserve 60 s, the policy floor) | 110 s | 620,893 | none ran |
| 3. OpenCode 1.14.48 | **pass** | exit 0, success claimed | none (the product has none) | 44 s | 263,751 | n/a |

All three delivered the same patch, byte for byte ([records/final.patch](records/final.patch),
`sha256:391cab14...`): the numeric-value increment applies only to options declared under `count`.
In every arm the lint gate reads not-applicable (the repository declares no lint script) and there
is no build gate. Neither Swarm arm repaired, so there is no candidate to score for repair's
contribution; repair changed nothing here.

## Reading the arms separately

- **Planned checks against ordinary Swarm (arm 1 against arm 2):** no difference in correctness,
  status or the delivered patch on this task, at 4.5 times the wall and 3.0 times the tokens.
  Planning declared five checks, dropped one whose kept case the base contradicts, and its revision
  admitted two replacements before its own wall ended; nothing was reported uncovered. The checks
  ran on the delivered tree as diagnostics and agreed with it. On this task `--plan-checks` made no
  demonstrated difference except cost.
- **Ordinary Swarm against OpenCode (arm 2 against arm 3):** the same patch; Swarm took 2.5 times the
  wall and 2.4 times the tokens, and its result is an `accepted` reading backed by the supplied
  check and a final independent verification of the exact tree in a fresh checkout, where
  OpenCode's is its own claim. That is a difference in what each result rests on, not in
  correctness, which the hidden oracle found equal.
- **Planned-check Swarm against OpenCode (arm 1 against arm 3):** the same patch at 11.2 times the
  wall and 7.1 times the tokens.

One task cannot show either product, or either Swarm configuration, better in general. This task's
fix is one line, which every arm found first time; a task where the first candidate is wrong, or
where a requested outcome is easy to miss, is where planned checks and repair would have to show
their value, and this one is not such a task.

## What the changes of this work did here

The bounded view carried arm 1's one long output (a 29,980-byte `npm test`). The largest worker
request was 43,367 input tokens in arm 1 and 44,885 in arm 2; arm 1's planner reached 54,926. Both Swarm arms' final gates and independent verification
completed inside their reserve, and the reserve came from the measured preflight in arm 1 and from
the policy floor in arm 2. The requirement-coverage changes reported nothing uncovered, which on
this task was correct by the oracle.

## Correction, appended 2026-10-19 (after the comparison; the scores above stand)

Appended by the follow-up in [../../outcome-coverage/](../../outcome-coverage/README.md); nothing
above is rescored. Two readings above say more than the comparison shows:

- **Correctness.** All three patches, identical byte for byte, passed the task's independent hidden
  oracle. On correctness the arms tie. Swarm's `accepted` reading, its supplied check and its final
  independent verification of the exact tree are records an additional capability produces; this
  comparison did not establish any practical benefit from them, since the hidden oracle reached the
  same verdict on OpenCode's patch, which had none. "A result backed by a final independent
  verification" and "a difference in what each result rests on" describe that capability, not an
  advantage the comparison measured.
- **Planned checks.** `--plan-checks` did not improve the result on this task: arm 1 delivered the
  same patch as arm 2 at 4.5 times the wall and 3.0 times the tokens. Nothing in this comparison
  is evidence that planned checks improve results.
