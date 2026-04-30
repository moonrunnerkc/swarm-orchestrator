# Swarm Orchestrate

Worker and reviewer step execution with analyzer-gated greedy scheduling. Steps run on isolated branches; ready steps run together only when the static dependency analyzer clears them.

## Trigger

This skill activates when you need to:
- Execute a multi-step development plan with verified per-step branches
- Run worker and reviewer roles against discrete tasks in a goal
- Build a feature from a high-level goal with audit-ready run artifacts

## Instructions

1. Parse the goal into discrete, dependency-ordered steps.
2. Assign each step a role (worker for implementation, reviewer for synthesized tests and diff review). Reviewer mode (security, accessibility, general) is a policy, not a separate role.
3. Push steps onto the work-stealing queue. The queue dispatches greedy as-ready: a step starts as soon as its dependencies complete and the static dependency analyzer says it cannot conflict with anything currently running.
4. Each step runs in its own git worktree on a per-step branch, capturing a `/share` transcript.
5. Verify the step against transcript evidence and the falsification battery, then merge the branch.
6. Track metrics (timing, commits, verification status) throughout the run.

## Roles

- **Worker**: writes implementation code, runs tests, commits changes, and does not edit pre-existing test files unless the goal explicitly authorizes it.
- **Reviewer**: read-only. Synthesizes tests before worker execution and reviews diffs after worker execution. Security, accessibility, and general review modes are reviewer policies, not separate agent roles.

## Scheduling

Steps with satisfied dependencies are eligible to run. The work-stealing queue dispatches up to its concurrency cap; the static dependency analyzer must prove two eligible steps cannot conflict before they run together. Otherwise execution is serial. Failed steps trigger repair sessions with classified failure context before retry.

## Resources

- Agent profiles: `agents/*.agent.md`
- Verification: `skills/swarm-verify/SKILL.md`
- Quality gates: `skills/swarm-gates/SKILL.md`
