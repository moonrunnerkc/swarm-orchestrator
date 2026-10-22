# Repair-trace trial and fresh three-arm comparison: protocol, registered before any inference

Registered after the verification corrections (`5fc92a51f`, `f93d9bf62`), the repair-input
corrections and the experimental repair trace (`3196a0818`), and the task selection
(`6e8bc3045` rule, `06531fb5e` tasks) were committed, and after the product was built, with no
model run for any of it. Every launch goes in [launches.md](launches.md), entered before it
starts. This file is not edited after the first launch; a change of plan is an amendment appended
below the line, dated, before the launch it affects.

## Questions

1. Does one focused repair intervention (preservation-trace-v1, `--repair-trace`) turn a faulty
   candidate into a complete, correct change? (development pair)
2. On two fresh tasks, does it improve the delivered artifact against the same Swarm without it,
   and how do both compare with OpenCode? (three arms per task)

A same-model result measures these configured systems on one host. Eight launches cannot
establish general superiority; a single successful exposed repair is development evidence.

## Configurations

| what | value |
| --- | --- |
| model and server | Ollama 0.32.14 at `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b`, thinking off, `max_tokens` 8192 per call, as the runner configures every arm; one model resident, one request at a time, nothing heavy beside a launch |
| Swarm build | commit `06531fb5e`, cloned to `~/.cache/swarm-comparison/tools/swarm-06531fb5e`, `npm ci` and `npm run build` on Node v24.15.0: `dist/cli.js` `sha256:35681373fdcf164487a22164e8c4f516400dfc1ab0bdb0c655280617d1b927f3`, 870 files under `dist/`. Both Swarm arms run this one build, so both carry the verification corrections and the repair-input corrections |
| Swarm control | ordinary configuration: no workflow flag |
| Swarm trace | the same build with `--repair-trace` and nothing else different |
| OpenCode | 1.14.48, configured by the runner as in every earlier launch |
| task words, starting tree, scope, visible check | the runner's `taskPrompt`, identical for every arm of a task; a fresh depth-1 clone of the base with the visible check committed; the allowed-change policy of `scripts/comparison/change-policy.mjs` |

## Tasks

**Development pair:** `mocha-bugfix-long-prefix-short-alias` of the 2026-10-21 stage, started at
the repair boundary of its Swarm launch (session `20261021T214114-aa33a0`): the retained faulty
candidate (`payloads/patches/mocha-bugfix-long-prefix-short-alias.swarm.patch`,
`sha256:fa5bce2f...`) is written by a scripted first loop of three calls, and every later call
goes to the live model ([development-pair/alias-repair-boundary.mjs](development-pair/alias-repair-boundary.mjs)).
Same recorded sealed goal contract, task words, 9-minute wall, 40-step loops and 3 attempts as that
launch. The arms differ only in `--repair-trace`.

**Fresh tasks**, selected by [fresh-tasks/selection-rule.md](fresh-tasks/selection-rule.md)
(committed before any candidate was read) and validated with no model
([fresh-tasks/](fresh-tasks/)):

| task | repository | base | upstream | the work |
| --- | --- | --- | --- | --- |
| `acorn-bugfix-member-target-pattern-errors` | acornjs/acorn | `d788421b2` | `1cd3fd47d` | the parser keeps an object literal's shorthand-default and duplicate `__proto__` errors when the literal is the object of an assigned member expression |
| `entities-bugfix-restore-get-code-point` | fb55/entities | `08ef000a2` | `c257e6c66` | restore the deprecated `getCodePoint` export of `src/escape.ts` |

Both are small: the acorn change is 15 source lines with 45 test lines; the entities change is one
exported function. The entities task is the smaller of the two and the rule took it as written.
The upstream fixes are public and may be in the model's training data.

## Limits

| limit | value |
| --- | --- |
| launches | at most 8: the development pair (2) and three arms on each fresh task (6) |
| wall | 9 minutes per launch for every arm (`--max-wall-minutes 9` for Swarm; the runner's deadline of 9 minutes and half a second, with 59.5 s to confirm a kill) |
| agent-minutes | at most 90 of inference and failed starts in all, counted in [launches.md](launches.md) |
| Swarm limits | its defaults: 40 steps per loop, 3 gate-repair attempts, 8192 output tokens per call; nothing raised |
| tokens | one safety bound of 8,000,000 per launch |
| spend | no paid API, no model download, no server restart without authorization |
| corrections | none; no person interacts with any arm; no evaluator result reaches a worker |

## Order, registered now

0. development pair, Swarm control; 1. development pair, Swarm trace;
2. acorn, Swarm control; 3. acorn, Swarm trace; 4. acorn, OpenCode;
5. entities, OpenCode; 6. entities, Swarm trace; 7. entities, Swarm control.

Sequential, nothing else running. The fresh launches run through `scripts/comparison/run.mjs`
with two frozen manifests that differ only in their pinned Swarm workflow flags
([control/manifest.json](control/manifest.json) for the control and OpenCode arms,
[trace/manifest.json](trace/manifest.json) for the trace arm), each launch selected with
`--only <task> --arm <arm>`.

## Failure handling, registered now

A launch that ends for an infrastructure reason as the runner classifies it (the endpoint died or
restarted, a request stalled past the deadline, a workspace could not be prepared, the scorer
could not judge, a record could not be written) is recorded with its halt record, counts against
the eight, and is not relaunched; the runner is recovered with a recorded justification only to
continue to the next registered launch. An arm's own failure (a wrong or empty patch, a false
claim, a stop at the wall, an exit the product chose) is a result. Nothing is rerun for a more
favourable result. Nothing learned from the development pair changes the product, the tasks or the
evaluators before the fresh launches: all are frozen now.

## Scoring, frozen now, on each exact delivered tree, whatever the arm reported

1. **Required and preserved behaviour**: the hidden behaviour check (`fresh-tasks/hidden/`; for
   the development pair, the frozen check of 2026-10-21 and the 2026-10-22 expanded preservation
   check of [../2026-10-21/fresh-comparison/correction-2026-10-22/](../2026-10-21/fresh-comparison/correction-2026-10-22/README.md)),
   reported by case, required and preserved apart.
2. **The hidden oracle** (the runner's `hiddenVerdict`): the upstream test files overlaid and run
   by the hidden argv, the behaviour check, the project's test command, the allowed-change policy.
3. **The delivered tree's own reading**: the visible check and the project's test command.
4. **Requested deliverables**: a source change and regression tests.
5. **Meaningful added tests** ([score-tests.mjs](score-tests.mjs)): the test files the patch
   writes pass on the delivered tree and fail over the base's source; counts as the runner
   reports them.
6. **Swarm first candidate against delivered**: the first candidate rebuilt from the ledger
   (`../2026-10-21/fresh-comparison/reconstruct-first.mjs`) and scored by 1 to 5. Repair
   **improved** the artifact where the first candidate is not correct or not complete and the
   delivered tree is; **preserved** it where both read the same; **damaged** it where the first was
   and the delivered is not. A first candidate not reproduced to its recorded digest is reported
   as not reconstructed, never scored. For the development pair the first candidate is the
   retained one, scored already.
7. **Product verdict accuracy**: the product's exit, outcome and claim against 1 to 5.
8. **Cost**: arm wall from spawn to exit; model time (the sum of recorded model-call response
   times, Swarm from its ledger; OpenCode where its stream records it, otherwise not measured);
   Swarm's verification time (its independent-verification and gate intervals on the ledger);
   tokens as each product reported them, with calls of unknown usage named and a total containing
   one marked as a lower bound.
9. **Trace fidelity** (trace arms): whether the notice was given (`preservation-trace-v1`
   records), how many `compare_base` comparisons ran, and whether an edit followed.

An artifact is **correct** where 1 (every required and preserved case), 2 and 3 pass, and
**complete** where it is also correct and 5 finds at least one meaningful added test. Between two
artifacts of one task, one is **better** where it is complete and the other is not, or correct and
the other is not; otherwise they are equivalent and the numbers are reported, not ranked. A
different status, more assertions or a longer evidence trail is not a better artifact.

## Decision rule

The repair intervention is credited with an improvement only where a trace arm's delivered tree is
better than its own first candidate and better than the control arm's delivered tree on the same
task, by the definitions above. Without that it stays experimental and off by default. Swarm is
credited with a better artifact than OpenCode only where one of its delivered trees is better than
OpenCode's on the same task. A newly found evaluator gap gets a dated supplemental audit; the
registered scores are not rewritten.

---

## Amendments

### 1. 2026-10-22 09:04 UTC, after launch 6: the runner's preflight is corrected for launch 7; launch 6 stands as halted

Launch 6 (entities, Swarm trace) halted before dispatch, with no inference (0 s, 0 tokens), on the
runner's own gate-plan preflight (`halt-1.json` of the trace manifest's runs, class
`configuration`): the product's effective tests gate for `npm run test:vi` is its structured form
of that script (the same `vitest run` suite with a JSON reporter, which the product substitutes
only for a script body of exactly `vitest` or `vitest run`), and the preflight compared the two
command strings. It is a defect of the comparison harness, not of an arm and not a change of
product. Under the failure handling above, launch 6 counts against the eight and is **not
relaunched**; the entities trace arm is unmeasured.

Launch 7 would halt the same way. So before it, and only for it: the preflight
(`scripts/comparison/checks.mjs`, `structuredRewriteOf`) also accepts an effective gate that is
exactly what the pinned build's own `structuredRunner` renders for the task script's body at the
base, and nothing else; the evaluator (`hiddenVerdict`, `visibleVerdict`, the change policy and
the scorers) is unchanged. The harness digest changes with it, so launch 7 runs under a control
manifest re-frozen at that commit ([control-amended/manifest.json](control-amended/manifest.json))
with the same pins, flags, budgets and tasks and launch 7 alone. Launches 2, 4 and 5 stand under
the original control manifest.
