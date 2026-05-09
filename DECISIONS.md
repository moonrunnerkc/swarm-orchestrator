# DECISIONS

Architectural decisions for Swarm Orchestrator. New entries append to the bottom. Each entry is dated, scoped, and cites evidence. Reversals reference the original entry by date and add a follow-up note rather than editing history in place.

## Adapter Decisions

This section records choices made for the adapter-reintegration work tracked in
`docs/adapter-integration.md`. Adapters are *falsifiers*, not alternative
producers; the producer side of v8.0.1 is untouched.

### 2026-05-08 — Branch and gating posture

Work lives on `feat/adapter-reintegration-v8` branched off `origin/main`. No
merge path bypasses verification or quality gates. Phases land sequentially and
each phase is gated on empirical evidence from the previous phase. Pre-building
later phases is a plan violation.

### 2026-05-08 — Phase 1 obligation target: `property-must-hold`

Codex's first (and, until Phase 1's dev gate clears, *only*) strategy is
adversarial test input generation against `property-must-hold` obligations.

**Why this fit, against the current obligation mix in v8.0.1:**

- `property-must-hold` predicates are shell commands (`! grep -r 'eval(' src/`,
  `! find . -size +500c`, etc.) — exit 0 means the property holds. Source of
  truth: `src/contract/types.ts:84-96` and the extractor prompt at
  `src/contract/extractor/anthropic-extractor.ts:178-182`.
- An external CLI agent can attack a shell predicate the same way an attacker
  would: synthesize adversarial inputs (files, content, paths) inside a
  workspace-write sandbox, run the predicate, observe whether it still exits 0.
  That maps cleanly onto Codex's `workspace-write` sandbox with
  `approval-policy never`.
- The other v1 obligation types are a poor first target for adversarial test
  input generation:
  - `function-must-have-signature` is an AST signature check
    (`src/contract/types.ts:61-75`) — there is no input space to attack; the
    file either declares the signature or it doesn't.
  - `import-graph-must-satisfy` is a structural graph property
    (`src/contract/types.ts:108-116`) — falsified by editing imports, not by
    test input synthesis.
  - `coverage-must-exceed` reads a coverage report
    (`src/contract/types.ts:124-134`) — input space is "what tests run", which
    is not what an adversarial test-input strategy produces.
  - `performance-must-not-regress` reads a benchmark baseline file
    (`src/contract/types.ts:144-154`) — adversarial latency inputs are a
    different research problem and not in scope.
  - `file-must-exist`, `build-must-pass`, `test-must-pass` are deterministic
    workspace facts — there is nothing to falsify with synthesized inputs.

**Decision:** keep the plan default. Codex Phase 1 targets
`property-must-hold` only. If the obligation mix in real runs shifts away from
`property-must-hold` such that Phase 1 has no usable inputs, revisit before
Phase 1's dev gate is run, do not paper over it.

**Reversibility:** changing the target obligation type is a one-strategy
swap inside `CodexFalsifier`. The contract in
`src/falsification/adapters/types.ts` is obligation-type agnostic.

### 2026-05-08 — Cost instrumentation path

Per Phase 0 of the plan, per-adapter dollar totals extend the existing
`cost-attribution.json` schema (`src/metrics-types.ts`). One file, one schema,
locked before Phase 1 lands. New fields are additive; readers that ignore
unknown fields stay valid.

### 2026-05-08 — Sandbox posture for Phase 1

Codex runs with `--sandbox workspace-write` and `--approval-policy never`. No
`--yolo`, no `--dangerously-bypass-approvals-and-sandbox`, no
`danger-full-access`. This matches the "Falsifier as attack vector" risk in
the plan's risk register and is a hard requirement of the adapter contract,
not an adapter-internal preference. Adapters that need to escape sandbox in
the future require an explicit decision entry here first.

### 2026-05-08 — OPEN: 48-hour post-merge regression check (Phase 2 input)

The plan's Phase 2 lists "post-merge defect rate (48-hour regression
follow-up)" among its measurement metrics. Whether that follow-up is
necessary, or whether the existing falsification battery (the `BatteryResult`
pipeline at `src/verification/battery-runner.ts` and `src/verifier/`) already
captures the regression signal Phase 2 cares about, is **not yet decided**.

This is intentionally left open. Phase 2 must not start until this question
has its own dated decision entry below. The two paths the resolution could
take:

- **Battery suffices:** Phase 2 measures pass-rate, cost, latency on the same
  N=30 stratified obligation set, with no separate 48-hour wait window. Fast
  iteration, single-source signal, but assumes battery covers the regression
  surface area we care about.
- **48-hour check necessary:** Phase 2 adds a follow-up measurement window.
  Slower iteration, requires merge-then-watch tooling, but catches drift the
  battery cannot model (real-world inputs after merge).

Resolution requires either (a) evidence that the battery's existing layers —
`differential-gate`, `mutation-gate`, `cheat-detector`, `property-gate`,
`attestation` (`src/verification/battery-runner.ts:21-27`) — already exercise
the post-merge regression surface, or (b) a concrete scenario where it
demonstrably misses one. Until one of those exists, Phase 2 is blocked.

### 2026-05-08 — Out of scope, restated

The following are explicitly out of scope for the Phase 0/1 work and must
not appear in the diff: plugin SDK, signature verification, plugin signing,
multiple strategies per adapter, stigmergic evidence board, pheromone
propagation, cross-run posterior persistence, dashboard or UI, auto-installation
of adapter CLIs, any Phase 2–6 deliverable. This restates the plan's "What's
Explicitly Out of Scope" section so reviewers can grep for it without leaving
this file.
