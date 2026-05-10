# Phase 4 pre-registered protocol

This document is committed **before** any Phase 4 run is executed. It
locks the obligation set, fixture, cost cap, statistical method, and
decision rules so that the Phase 4 result cannot be massaged by
post-hoc protocol changes. Any change to this file after the
pre-registration commit invalidates the run and requires a full restart
of the Phase 4 measurement.

The plan that frames Phase 4 is `docs/adapter-integration.md` Phase 4.
This document operationalizes that plan against the v8.0.1 codebase as
it exists on `feat/adapter-reintegration-v8` after the Phase 3
close-out (`af2528a`).

## What Phase 4 measures

Phase 4 introduces `ClaudeCodeFalsifier` — a control adapter in the
*same model family as the v8 producer* (Anthropic Claude). The Phase 4
question, verbatim from `docs/adapter-integration.md`:

> If it finds nothing the producer's persona race didn't already find,
> that's evidence cross-family diversity is doing the actual work; if
> it finds plenty, the diversity story is weaker than assumed and the
> architecture should be reconsidered.

Phase 4 is **not a ship/no-ship gate**. ClaudeCode ships regardless of
yield, behind its own per-adapter flag (`includeClaudeCode: true`,
default off; Codex and Copilot remain default on per the Phase 3
close-out). What Phase 4 measures is a downstream gate input: whether
*any* second adapter beyond Copilot earns its slot, which decides
whether Phase 5 (bandit dispatcher) is built.

## Locked artefacts

- **Obligation set:** `evidence/phase3/obligations.json` — the same
  N=20 set Phase 3 used. Reused per the agent brief; no new
  obligations introduced.
- **Fixture:** `evidence/fixtures/phase-3/`. Same fixture as Phase 3.
  Same content hash.
- **Harness:** `scripts/phase4/run-harness.ts` (compiled to
  `dist/scripts/phase4/run-harness.js`).
- **Analysis script:** `scripts/phase4/analyze.py` — passes the
  synthetic-paired-data self-test (`--self-test`).
- **Adapter:** `src/falsification/adapters/claude-code/claude-code-falsifier.ts`.
  Real `claude` CLI invocation via `-p --output-format json
  --max-budget-usd <N> --add-dir <workspace> --no-session-persistence
  --exclude-dynamic-system-prompt-sections`. No
  `--dangerously-skip-permissions`.

## What we measure

Per-obligation, paired across the two configurations on the same
obligation set, on the four pre-registered metrics:

1. **Pass rate** — system returns no falsification (no adapter
   reported a counter-example). Binary, paired.
2. **Token-estimate cost** — USD `dollarsTokenEstimate` summed across
   adapters that ran. (`dollarsBilled` is 0 for both configs because
   both Copilot and ClaudeCode authenticate via subscription tiers;
   the comparison axis is `dollarsTokenEstimate` per Phase 3's
   precedent.)
3. **Wall-clock latency** — milliseconds, end-to-end across all
   adapters that ran for the obligation.
4. **LLM call count** — number of adapter invocations that actually
   spawned the underlying CLI (baseline-skipped calls do not count).

`Config B' — producer + Codex + Copilot.` The shipped configuration
after Phase 3. The harness registers Copilot only (Codex's strategy
does not handle Phase 3 obligation types and would short-circuit to
strategy-not-applicable; omitting it from the harness keeps the
captured per-call cost clean).

`Config B'' — producer + Codex + Copilot + ClaudeCode.` Same as B'
plus ClaudeCode. Adapters dispatch sequentially in registration order;
each adapter sees a fresh fixture-rooted workspace.

## Cost cap

- **Config B':** `$0.65` per obligation, hard. Mirrors Phase 3.
- **Config B'':** `$1.50` per obligation, hard. Higher headroom for
  ClaudeCode's per-call cost (a smoke test against the real CLI showed
  ~$0.077 per simple turn on Opus + Haiku via the OAuth/Max session;
  the per-call max-budget-usd is set to `$1.00` inside the adapter).
  Worst-case Phase 4 spend: `20 × $0.65 + 20 × $1.50 = $43`. Inside
  the $20 Phase 4 ceiling? **No** — the ceiling forbids it. The
  harness halts on the first cost-cap hit per obligation; the operator
  may stop the Config B'' run early via SIGINT if the running total
  approaches the $20 ceiling. A hot-fix that lowers the per-obligation
  cap below the spend-cap ceiling is allowed under the protocol's
  measurement-non-affecting carveout iff cited in DECISIONS.md.
- **Cost-cap hits are logged, not retried.**

## Statistical method

Pre-registered in `scripts/phase4/analyze.py` (mirrors Phase 3's
analyzer with the comparison axis flipped to B' vs B'').

- **Pass rate (paired binary):** McNemar's test, exact-binomial fallback.
- **Token-estimate cost, wall-clock, LLM call count:** Wilcoxon
  signed-rank on per-obligation `B'' − B'` differences.
- **Bonferroni correction across the four comparisons.**
- **95% confidence intervals on every reported number.**

## Decision rule (verbatim from `docs/adapter-integration.md` Phase 4)

> Decision gate: not a ship/no-ship gate. Measurement input for Phase
> 5 sizing and for the question "is cross-family diversity
> load-bearing?" Ship the adapter regardless of yield because both
> outcomes are signal: low yield validates the cross-family thesis,
> high yield invalidates it and forces a rethink.

## Operationalization

- **ClaudeCode marginal yield:** count of obligations where B'
  passed (no falsification) AND B'' did not pass (a B''-only adapter,
  i.e. ClaudeCode, falsified the obligation).
- **Diversity-thesis verdict:**
  - Marginal yield = 0 → "confirmed" (cross-family diversity is doing
    the work; same-family adapter is redundant).
  - Marginal yield > 0 → "weakened" (same-family adapter caught
    things cross-family did not; investigate).
- **Phase 5 gate:**
  - Marginal yield = 0 → Phase 5 skipped per the agent brief
    ("If ClaudeCode yield is zero or negative, skip Phase 5;
    document in DECISIONS.md that two adapters running fire-all is
    the production configuration").
  - Marginal yield > 0 → Phase 5 (bandit dispatcher) is eligible.

## Reproducibility

Same shape as Phase 3. Workspace = fresh copy of
`evidence/fixtures/phase-3/`; obligations = locked at
`evidence/phase3/obligations.json`; ClaudeCode prompt + sandbox flags
unchanged from this commit; bootstrap seed=42.

## Restart conditions

Same shape as Phase 3. Modifying the obligation set, fixture, harness,
analysis script, ClaudeCode prompt, or the cost cap after this commit
invalidates the run. Hot-fixes to harness bugs that would otherwise
prevent any obligation from running are allowed; the DECISIONS.md
entry must cite the bug, the fix's commit SHA, and the rationale that
the fix does not change the measurement.
