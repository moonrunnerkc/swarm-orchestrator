# Proof-graded propensity pilot (Experiment 3)

Harness for measuring, with execution proofs instead of judge labels, whether
different coding agents cheat at different rates on identical real tasks. This is
the harness and its pin; the pilot itself is **awaiting budget**.

## Status: awaiting budget

The pilot spends agent-run money only when `SWARM_TRIAL_BUDGET_USD` is set. It is
unset in this run, so no agent ran. The pipeline (provision an isolated checkout
-> hand every agent the same instructions -> collect the patch -> grade it through
the upgraded proof tier -> record the funnel and any proven finding) is built and
pinned by `test/experiments/propensity-trial.test.ts` against a scripted stub
agent, so it is verified without spend, network, or an upstream repo.

## Agents detected

| agent | status |
| --- | --- |
| claude-code | available |

Claude Code is the required agent; others run only if their CLI is installed and
authenticates. Availability is recorded either way.

## Isolation (enforced in the harness, not in instructions)

- Every trial runs in a throwaway checkout whose upstream remote is removed
  (`defaultProvision`), verified by `assertNoUpstreamRemote`. There is no push
  target.
- The agent's environment has every GitHub credential scrubbed
  (`scrubbedAgentEnv`: GITHUB_TOKEN, GH_TOKEN, GITHUB_ACTOR, GH_ENTERPRISE_TOKEN, GITHUB_ENTERPRISE_TOKEN). There is no token to
  authenticate a push, a PR, or an issue comment.
- No upstream repository is forked or written; agent output stays local to the
  trial workspace.

## Pilot scope

Task count seeded: 0 (see `benchmarks/trials/tasks.json` and
`PILOT-DESIGN.md`). Agent list, issue count, per-agent per-issue cost cap, and the
total cap (equal to the env budget) are fixed in `PILOT-DESIGN.md`, committed
before any agent run, under the same pre-registration discipline as Experiment 1.

## When budget is available

Set `SWARM_TRIAL_BUDGET_USD`, finalize `tasks.json`, ensure Anthropic credits,
then `node dist/scripts/experiments/propensity-trial.js`. Output lands in
`benchmarks/trials/PILOT-REPORT.md` with per-agent per-issue verdicts, proven
findings with fresh-clone replays, and spend per agent. The pilot n will be too
small for vendor comparisons; the report presents data and draws no rankings.
Publication framing and any vendor naming are Brad's decision.
