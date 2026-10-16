# Comparison protocol amendment of 2026-10-16: the scored comparison without a calibration gate

Registered before any scored launch. It amends
[../../2026-10-15/comparison/protocol.md](../../2026-10-15/comparison/protocol.md)
(`sha256:e2c4b4ec107e30bd7438f1db285ce2acd460edac1477258c2c9e4c7b48c0fb84`). That protocol, its
candidates, its validation and the task module (`scripts/pilot/tasks-2026-10-15.mjs`,
`sha256:ddd33ca249729b223e0aaf7ed98b1848c92ff49d73a4ff767da030ef96c75c04`, the bytes the
calibration manifests pinned) are unchanged. Every rule there that this file does not name still
holds. The 2026-10-15 calibration and diagnosis launches stay as they were recorded. They are
development records, not scored observations, and nothing here pools with them.

## What changes

1. **The calibration prerequisite is removed.** Brad authorized this on 2026-10-16. Neither tool
   has to deliver a calibration task before stage A. Readiness now means:
   - the integrations work;
   - the effective configuration and budgets are correct and observed;
   - the task and scoring instruments are valid;
   - the stop controls work;
   - the records can be inspected.

   A working tool's incorrect solution is an outcome, not a setup defect. All eight stage A
   launches run even if early results already miss the spending rule.
2. **The deadline is the deadline.** Each launch has one fifteen-minute deadline. Every
   invocation, correction and internal verification ends at it. Past the deadline the arm's
   process group is killed. The sixty seconds of grace now only bound confirming that kill and
   stopping any process still working in the launch's directory; they are not solving time. Both
   are recorded as cleanup, apart from agent time.
3. **Swarm's verification is inside the deadline.** Swarm gets
   `--max-wall-minutes = floor((time left − 60 s) / 1 min)`. The product keeps its own documented
   30 s of that wall for its final verification, so 60 s more stays before the launch's deadline.
   The size is measured, not guessed: on the final build, everything Swarm ran after its last
   model call took at most about 31 s across the four tasks' references and bases (gates, bonds,
   and a final verification of 7 to 14 s). See the timings in [preflight/replays/](preflight/replays/).
4. **Corrections need time left.** A correction starts only with at least a minute of solving
   time before the deadline. Swarm also needs its 60 s reserve, so 120 s in all. A correction is
   never given time past the deadline.
5. **Per-task environment, declared before the freeze, the same for both arms.**
   - mime declares `packageManager: npm@11.2.0`. Every command of the mime launches runs with
     that npm release first on `PATH`: preparation, both arms, the supervisor's checks and the
     scorer. Swarm refuses to spend model calls in an undeclared environment. Without this, its
     launch would have recorded a setup refusal as the arm's failure.
   - mime's Prettier lint already fails at the base, on files the task does not touch.
     [candidates.md](../../2026-10-15/comparison/candidates.md) already holds neither arm to it.
     Swarm's lint gate is declared advisory for the mime task and its stage B twin
     ([swarm-gates.json](swarm-gates.json)): it is still run and reported, but not blocking. The
     launcher checks that the product's own plan reads it so.

## Readiness, established before the freeze

| item | evidence | result |
| --- | --- | --- |
| integrations | the 2026-10-15 canaries and request captures ([../../2026-10-15/comparison/readiness/](../../2026-10-15/comparison/readiness/)) | Reused. Since then, Swarm's provider code and OpenCode's configuration writer have not changed (checked by `git diff` against the calibration build). Swarm and OpenCode connected, called tools, edited, ran checks and reported on Ollama. No integration probe was launched: 0 of the 16 authorized launches went to probes. |
| effective request settings | the same captures | Both send `max_tokens` 8192 and all three spellings of thinking off (`enable_thinking`, `chat_template_kwargs.enable_thinking`, `reasoning_effort: "none"`). OpenCode also sends `top_p` 0.95. Ollama 0.32.14 honours `reasoning_effort`. |
| token allowance and walls through the real product | [preflight/budget-proof.json](preflight/budget-proof.json) | The proved runner dispatched the pinned Swarm build against a scripted model, with two corrections. Each session sealed the cap less what earlier invocations spent (40,000, then 33,397, then 32,793). Internal repairs drew on that one allowance. Each wall ended the reserve before the deadline. |
| 8,000,000 reaches execution where the contract names none; a smaller bound binds | `src/cli-goal-budgets.integration.test.ts` | Checked through the command line from the sealed run spec. A goal contract cannot name a token budget, so the case of a contract naming a smaller one is covered by `src/agent-run.test.ts` on the same function. |
| the whole task reaches each model | [preflight/prompt-delivery.json](preflight/prompt-delivery.json) | Both products were pointed at the scripted endpoint, which recorded the requests they sent, and the first user message was compared with the prompt the harness builds, on all four tasks. Swarm sends it verbatim. OpenCode's `run` wraps the message in quotes and escapes each inner double quote (only csstree's text has any), which loses nothing. All requests carry `max_tokens` 8192 and the three thinking-off fields. |
| task instruments | [validation-2026-10-16/](validation-2026-10-16/) | All four re-validated on this host. Base: fails visible and hidden. Reference: passes both. Wrong implementation: rejected by the hidden oracle. |
| Swarm's acceptance path accepts a correct change and refuses none | [preflight/replays/](preflight/replays/) | Final build. The maintainer's reference, limited to the authorized paths, is accepted on all four tasks; the unchanged base is refused on all four. |
| verification replay of the retained OpenCode calibration patches | [replay-calibration/](replay-calibration/) | See the readiness note below. |

Defects found by this preflight and repaired before the freeze, each with a regression that
fails on the earlier source:

- **The launcher** (`scripts/comparison/`):
  - the grace was a minute more solving time;
  - an unconfirmed kill was scored and the next launch dispatched;
  - a process an arm detached was never looked for;
  - a correction could start with less than a minute and run past the deadline;
  - Swarm's wall left its final verification no room.
- **Token accounting:**
  - OpenCode 1.14's disjoint `cache.read` and `cache.write` were left out of its comparable
    total;
  - calls answered without usage counted as zero for both arms. Swarm's `stopped` event now
    carries the count.
- **Swarm's final verification counted pako's build entries as instrument**
  (`src/gates/instrument-identity.ts`). pako's build program hands vite `'src/index.ts'` by
  name. The rule counted those strings as instrument, put the changed source back to the
  base's, and so refused the maintainer's own fix on both pako tasks
  ([preflight/replays-build-c4370c043/](preflight/replays-build-c4370c043/)). A run program's
  strings are now its input unless it starts processes or loads code by a computed name;
  configuration strings and imports are followed as before.
- **The run assessment cited a withheld repair attempt.** It named that attempt's stop record as
  its lifecycle record, and every bundle that withheld an attempt was refused by its own verifier
  (it reproduced on the 2026-10-15 calibration bundles). Both the assessment and the bundled
  verifier now take the last stop of a loop.

### Readiness note: the retained OpenCode calibration patches under Swarm's verification

Both retained OpenCode argparse patches pass Swarm's sealed visible criterion, the project's lint
and its test suite, and Swarm accepts both. The hidden oracle rejects both: `float("5.")` in the
first; the sign of `float("-0")` and a missing rejection in the second. The regenerated sealed
contract digests to the value both calibration sessions sealed, and Swarm reported exactly the
checks it ran. This is a coverage limit of the sealed criterion, not a misreport. It stays a
limitation of what Swarm's acceptance can establish, and it is not imported into any solver's
contract.

## Frozen configuration

| what | value |
| --- | --- |
| model and server | Ollama 0.32.14 at `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b` (qwen35moe, 35.5 B parameters, Q4_K_M, Modelfile parameters unchanged), one model resident, one request stream at a time |
| Swarm | build `~/.cache/swarm-comparison/tools/swarm-917312983` from commit `917312983a13784a47c2a9812f1d54859fbaedd4`; the CLI and whole-dist digests are in the manifests |
| OpenCode | 1.14.48 (`opencode-darwin-arm64`, `sha256:3e1db587b78982ad2c4bac2918658a7c90f5c4a8a857c9c0d27498e07ee42de8`) |
| Node | v24.15.0 |
| harness | the digest over `scripts/comparison/*.mjs` named in the manifests |

| binding limit | Swarm | OpenCode |
| --- | --- | --- |
| launch deadline | 15 min for everything, corrections and internal verification included; killed at it | 15 min; killed at it |
| cleanup | at most 60 s, kill confirmed within 10 s, reported apart | the same |
| own wall | `floor((left − 60 s) / 1 min)` minutes, of which the product keeps 30 s for its final verification | none |
| tokens | 8,000,000 per launch, shared by every invocation; a bound checked between calls (the next prompt is reserved, and one call's growth can overshoot), not a hard cap | no native cap |
| output per call | 8192 | 8192 (its model entry's `limit.output`) |
| steps | 40 per loop | none |
| internal repair attempts | 3 gate-repair attempts, with no attempt started without one answer's tokens and a minute left | none |
| scripted corrections | at most 2, visible failure output only, each with at least 120 s left | at most 2, the same rule, each with at least 60 s left |
| permissions | lexical path and program policy with `--approve auto`, sealed goal contract, private child HOME | edit and shell allowed in the workspace, no web fetch, HOME is the launch's own directory |

The arms are matched on the wall, not on tokens, and no claim treats their limits as equal.
Neither runs in a sandbox, so security claims are about the tasks' tested properties only.

## Launch order, stage A (eight launches, frozen by the seeded hash, first arm alternating)

| order | task | arm |
| --- | --- | --- |
| 0 | pako-feature-inflate-push-after-end | swarm |
| 1 | pako-feature-inflate-push-after-end | opencode |
| 2 | csstree-upgrade-esbuild-0-24 | opencode |
| 3 | csstree-upgrade-esbuild-0-24 | swarm |
| 4 | mime-bugfix-gettype-line-terminators | swarm |
| 5 | mime-bugfix-gettype-line-terminators | opencode |
| 6 | pako-refactor-options-default-param | opencode |
| 7 | pako-refactor-options-default-param | swarm |

Stage B, frozen now: the bug fix and the feature, unchanged, under the ids with suffix `-rep`, in
the order pako feature (swarm, opencode), then mime bug fix (opencode, swarm). It runs only if
the stage A spending rule holds. The repetitions test reliability and are not new tasks.

## Scoring additions

- **Claims.** Each launch's final report is classified under one explicit rule, the same for both
  tools (`final-report-claim-v1`, defined in `scripts/pilot/analyze.mjs`):
  - **claims completion:** the report says the requested change is done, or that every
    requirement is met, and names nothing it left unmet or failing. Swarm's
    "outcome: accepted" is one.
  - **no completion claim:** the report says the work failed or is incomplete, or it reports
    only particular observations (such as "the visible tests pass") without saying the task is
    done.
  - **unjudged:** the report is missing, unreadable or mixed.

  The classification is made from the final report text alone, extracted without the oracle's
  verdict beside it, and kept with the quote in each stage's `claims-review.json`. A false
  completion claim is a completion claim on a patch the hidden oracle rejects. An unjudged
  report is neither a claim nor a delivery.
- **Tokens.** Each arm's comparable total counts every prompt and completion token once, as the
  server counted them. Swarm's reasoning and cached figures are subsets of its output and input.
  OpenCode's are disjoint parts. Calls without reported usage are counted apart.
- **Unchanged.** The review rubric, the security and coding checks, reproducibility, and the
  spending rule (the 2026-10-15 rule, items 1 to 4, and stage B's) are as registered.

## Cache warm-up

Before launch 0, a settings check loads the model: one request with `max_tokens` 10 and
`reasoning_effort` `"none"`, with no tool. Ollama's default keep-alive (5 minutes) then applies,
so a launch that starts after an idle gap longer than that pays the model's load time inside its
deadline. The load time measured before launch 0 is reported, and the gaps are visible in the
records' timestamps.

## Live allowance

At most 16 launches and 240 agent-minutes, including any probe and any rerun after a validity
repair. The intended 12 launches use at most 180 agent-minutes. A reserve launch is only for a
validity repair, never for a better score.
