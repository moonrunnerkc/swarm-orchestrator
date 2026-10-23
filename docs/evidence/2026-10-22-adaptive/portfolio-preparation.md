# Broader portfolio: preparation, not launched

Written October 22, 2026, after held-out block 1. Nothing here has run. It sets up the next study
so that its questions stay separate and its cost is known before any launch.

## Three questions, three studies

They are not pooled, and a result in one is not reported as a result in another.

1. **Same-model orchestration benefit.** Does Swarm's controller (repair, continuation, the
   decision point) deliver more complete changes than Swarm's own worker loop alone on the same
   model? Arms: `swarm`, `swarm-control`, `swarm-direct` (the internal ablation). One build, one
   model, one endpoint, identical permissions. This is the only study that can attribute a
   difference to the controller.
2. **Product comparison.** Does Swarm deliver complete changes more often than another coding
   agent driving the same model? Arms: `swarm` and `opencode` (pinned 1.19.4) at matched launch
   wall. A difference here is a product difference (tools, prompts, loop, verification), not an
   orchestration effect.
3. **Local-model adapters.** How a model and its endpoint behave under each product (tool-call
   shape, context limits, thinking modes). Separate launches per adapter; never mixed into 1 or 2.

## What block 1 changes in the plan

- Repeated samples per cell. Block 1's within-Swarm differences occurred where the decision point
  did nothing visible (it chose `continue` at no cost), so single samples of a sampled model cannot
  separate the controller from sampling. Each cell needs at least three samples, with the pair
  counted per sample and per task.
- Evaluator audit before launch. One registered rule (fastify, an old file name inside an absence
  assertion) gave a false failure; [evaluator-audit.mjs](evaluator-audit.mjs) shows the amendment
  changes only that verdict. Every evaluator gets one extra control: a correct patch whose own
  tests assert the old behaviour is gone.
- Lint inside `npm test`. Three of block 1's failures were lint or type errors in otherwise passing
  changes. The report keeps "hidden behavior passed" and "complete delivery" as separate columns.
- Large mechanical edits. The fastify rename (11 files moved, 20 files touched) ran out of wall in
  every Swarm arm; the next portfolio includes two more tasks of that shape so the question is
  measured rather than anecdotal.

## Resource ceiling, computed first

Per launch 720,500 ms, as in block 1. Proposed: 8 tasks (two per family, at least three
repositories, none from block 1 or the development set), 3 samples, study 1 with 3 arms and
study 2 with 2 arms, sharing the `swarm` launches: 8 × 3 × 4 = 96 launches, 96 × 12 = 1,152
agent-minutes, about 19.2 agent-hours, plus scoring. That is under the 48-agent-hour campaign PR #95
described, and is not that campaign; expanding to it needs its own registration. Local inference
only, paid inference $0.

## Before the first launch

Selection by the registered rule with a fresh inventory; evaluator author separate, validated
against base, reference, faulty controls and the absence-assertion control; frozen manifest and
build; neutral smoke on all arms; preflight of every launch configuration including the product's
own fresh-checkout setup; then launches in registered order.
