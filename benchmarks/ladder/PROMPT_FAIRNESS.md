# Ladder Baseline — Prompt Fairness Policy

> _Last updated: 2026-04-17_

## Why this matters

The ladder baseline exists to answer a single question: **does the orchestrator's multi-agent coordination add value beyond what sequential single-agent prompts achieve for the same budget?**

If the ladder prompts are deliberately weak, vague, or poorly ordered, the orchestrator "wins" by default and the comparison is worthless. The ladder must be the **strongest reasonable sequence of single-agent prompts** that a skilled human could write — not a straw man.

## Policy

1. **Conservative prompts.** Every ladder prompt should be specific, actionable, and representative of what a competent developer would type into a CLI agent. No filler. No deliberately vague instructions. No prompts that set the agent up to fail.

2. **Canonical attribute ordering.** The ladder follows the rubric attribute order defined in [completeness-rubric.md](../harness/scoring/completeness-rubric.md). Each prompt targets one or more specific attributes. This is intentional — it gives the ladder the benefit of knowing what the rubric measures, which is an advantage the orchestrator does not explicitly have.

3. **First prompt includes everything.** The opening prompt is the same as the task prompt given to the orchestrator. This means the ladder agent gets the full specification in one shot — same as the orchestrator's initial goal.

4. **Community-improvable.** The ladder prompts live in [`benchmarks/harness/raw_data/rubric_tasks.json`](../harness/raw_data/rubric_tasks.json) under the `ladder_prompts` key. **PRs that strengthen these prompts are welcome and encouraged.** Strengthening the ladder is a feature, not a threat. An orchestrator that wins against a community-improved ladder is a much stronger claim than one that beats author-written templates.

5. **No prompt-engineering tricks in favor of the orchestrator.** The orchestrator receives only the `prompt` field — the same string the ladder gets as its first step. No hidden system prompts, no pre-seeded context, no warm-up.

6. **Repair phase is aggressive.** After exhausting explicit ladder prompts, the ladder script enters a repair phase that names the exact missing rubric attribute and asks the agent to fix it. This is deliberately generous to the ladder — it gets told exactly what's missing, which a real user might not know.

## How to contribute stronger prompts

Edit `benchmarks/harness/raw_data/rubric_tasks.json`. For each task object:

- `ladder_prompts` is an ordered array of strings
- Each prompt should target one or more rubric attributes
- Prompts execute sequentially in the same Claude Code session
- Total prompt count × 1 = premium request count (budget cap default: 30)

Guidelines for good ladder prompts:
- **Be specific:** "Add input validation middleware that rejects requests with missing required fields, returning 400 with `{error, message}` JSON" is better than "Add validation"
- **Name tools:** If a rubric attribute requires a specific tool (`npm audit`, `axe-core`), name it in the prompt
- **One concern per prompt:** Don't combine unrelated asks — the agent handles focused requests better
- **Order matters:** Build foundations first (scaffold, start, routes), then layer quality (tests, security, errors, a11y)

## Review checklist for ladder prompt PRs

- [ ] Does the first prompt match the task's `prompt` field exactly?
- [ ] Does each prompt target at least one rubric attribute?
- [ ] Are prompts specific enough that a capable agent could act on them without guessing?
- [ ] Is the prompt order logical (build → test → harden → document)?
- [ ] Total prompt count ≤ 30 (budget cap)?
- [ ] No prompt deliberately omits information to make the ladder fail?

## Risks

- **Prompt count vs quality:** More prompts ≠ better results. A 15-prompt ladder that covers all attributes clearly may outperform a 30-prompt ladder with redundant steps. Optimize for clarity, not count.
- **Session context drift:** Later prompts execute in the same Claude Code session as earlier ones. Very long sessions may degrade agent performance. This is a known limitation of the baseline design, not something to exploit.
- **Rubric awareness:** The ladder prompts know the rubric exists. This is an intentional advantage — the comparison is "orchestrator with no rubric knowledge" vs "manual sequence with full rubric knowledge."
