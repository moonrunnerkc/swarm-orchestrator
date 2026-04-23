# Swarm Orchestrate

Parallel wave-based execution of multi-step plans using specialized agents.

## Trigger

This skill activates when you need to:
- Execute a multi-step development plan in parallel
- Coordinate multiple specialized agents working on different parts of a codebase
- Build a full-stack application from a high-level goal

## Instructions

1. Parse the goal into discrete, dependency-ordered steps
2. Assign each step to the most appropriate specialized agent based on scope
3. Group independent steps into waves for parallel execution
4. Execute each wave: spawn agent sessions, capture transcripts, verify outputs
5. Merge verified work before advancing to the next wave
6. Track metrics (timing, commits, verification status) throughout execution

## Available Agents

- **BackendMaster**: Server-side logic, APIs, database operations
- **FrontendExpert**: UI components, styles, client-side logic
- **TesterElite**: Tests, coverage, quality assurance
- **SecurityAuditor**: Vulnerability scanning, security fixes
- **DevOpsPro**: CI/CD, deployment, infrastructure
- **IntegratorFinalizer**: Component integration, end-to-end validation

## Wave Scheduling

Steps with no unmet dependencies run in the same wave. Each wave completes (all steps verified) before the next wave begins. Failed steps trigger repair sessions with classified failure context before retry.

## Resources

- Agent profiles: `agents/*.agent.md`
- Verification: `skills/swarm-verify/SKILL.md`
- Quality gates: `skills/swarm-gates/SKILL.md`
