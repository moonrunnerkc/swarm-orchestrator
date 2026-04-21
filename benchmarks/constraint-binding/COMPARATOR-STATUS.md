# Constraint-Binding Comparator Status

This document explains which baselines this benchmark compares the orchestrator
against, and why.

## Included

| Producer | Invocation | Status |
|----------|------------|--------|
| `ORCHESTRATOR` | `swarm run --goal "<prompt>" --tool claude-code` | included |
| `SINGLE_SHOT` | `claude -p "<prompt>"` (Claude Code, one premium request) | included |
| `LADDER` | Claude Code called with a deterministic prompt ladder, up to `BUDGET_CAP` requests | included |

All three producers receive the **byte-identical** `prompt` field from each
task YAML. Enforced by `test/constraint-binding/prompt-invariant.test.ts`.

## Intentionally excluded

### Cursor (cursor-agent)

Not installed on the benchmark runner at the time of measurement. Adding
Cursor was considered and declined for PR 3a because:

1. Cursor's agent-mode CLI requires a paid license. Running it non-interactively
   across 60+ task instances has historically been less batch-friendly than
   `claude` or `copilot`.
2. The comparison that matters for this benchmark's thesis is vs the Claude
   Code baselines, because that is the tool Anthropic itself publishes numbers
   for. Adding Cursor as an n-of-one comparator is weaker evidence than a clean
   comparison against tools with public reference numbers.
3. Nothing about the orchestrator's design prevents a future PR from adding
   Cursor as a fourth producer. The comparison would need a dedicated runner
   (`run_cursor()`) in `run_fresh.sh` that honours the byte-identical-prompt
   invariant.

### GitHub Copilot CLI (as a direct comparator)

Installed on the runner, but not wired as a constraint-binding comparator for
PR 3a. The orchestrator already uses Copilot as one of its own agent backends;
running Copilot as ORCHESTRATOR and again as a separate producer duplicates
measurement. When Copilot matters as a standalone baseline, the right shape is
a `copilot -p` single-shot producer mirroring `SINGLE_SHOT`; tracked as a
follow-up.

## Adding a comparator

Open an issue with:

1. The CLI invocation that accepts a prompt string and writes code to the
   current directory.
2. Evidence the CLI is batch-capable (non-interactive, no TTY dependence,
   deterministic exit on completion).
3. License status if the tool is paid.

Do **not** add a comparator that cannot be invoked with the byte-identical
prompt. Any producer that rewrites, summarises, or truncates the prompt
violates the fair-test invariant and will be rejected at review.
