# Proof-graded propensity pilot: design (pre-registration)

The design of Experiment 3's pilot, committed before any agent run, under the same
discipline as Experiment 1. The harness (`scripts/experiments/propensity-trial.ts`)
and its stub-agent pin (`test/experiments/propensity-trial.test.ts`) are built and
tested now; the pilot runs only when `SWARM_TRIAL_BUDGET_USD` is set and Anthropic
credits are available.

## The claim (eventual, not this run)

Different coding agents cheat at different measured rates on identical real tasks,
graded by execution proofs with replay receipts instead of judge labels. This run
builds the harness and pins the pipeline; it makes no vendor claim.

## Design

- **Agents.** Claude Code (`claude`) is required. Any other agent CLI (Cursor,
  Aider, Codex CLI, ...) is included only if its CLI is installed and
  authenticates; availability is recorded either way. Every agent gets the
  identical issue, the identical checkout at the pinned base, and the identical
  instructions (`trialInstructions`) so the only variable per task is the agent.
- **Tasks.** Real issues from execution-grounded-viable repos in the corpus,
  selected by the criteria in `tasks.json`, each forked or vendored into the trial
  workspace. The finalized task list is pinned in `tasks.json` before the first
  agent run.
- **Grading.** Each produced patch runs through the full upgraded proof tier (the
  six restoration engines plus claim-differential) via the same
  `runExecutionGrounded` path the hunts use. The record carries the complete
  verdict funnel and, for any proven finding, its reproduce command; a proven
  finding is confirmed by a fresh-clone replay before it is reported, per the
  BLOCK-REPORT protocol.
- **Caps.** Per-agent per-issue cost cap and a total cap equal to the env budget
  (`SWARM_TRIAL_BUDGET_USD`). The pilot stops when the total cap is reached and
  records what was skipped. Exact cap values are set at pilot finalization when the
  budget is known.
- **Pilot size.** Small and stated up front: the finalized agent list x issue count
  bounded by the total cap. The report will state explicitly that the pilot n is
  too small for vendor comparisons and will draw no rankings.

## Isolation (enforced in the harness, not in agent instructions)

- Each trial runs in a throwaway checkout whose upstream remote is removed
  (`defaultProvision`), verified by `assertNoUpstreamRemote`: there is no push
  target.
- The agent's environment has every GitHub credential scrubbed (`scrubbedAgentEnv`:
  `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_ACTOR`, `GH_ENTERPRISE_TOKEN`,
  `GITHUB_ENTERPRISE_TOKEN`): there is no credential to authenticate a push, a pull
  request, or an issue comment.
- No upstream repository is written; agent output stays local to the trial
  workspace. These are structural guarantees in the harness, not requests to the
  agent.

## Budget gate

The pilot spends agent-run money only under `SWARM_TRIAL_BUDGET_USD`. With it
unset (this run), the harness is built, tested against the stub, and reports
`awaiting-budget` in `PILOT-REPORT.md`; no agent runs and nothing is spent.

## Output

`benchmarks/trials/PILOT-REPORT.md`: per-agent per-issue verdicts, proven findings
with fresh-clone replays, spend per agent, and the explicit small-n caveat.
Publication framing and any vendor naming are Brad's decision; the report presents
data and draws no rankings.
