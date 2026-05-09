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

### 2026-05-08 — Phase 1 dev gate: BLOCKED on local Codex install

The Phase 1 dev gate (per `docs/adapter-integration.md`) requires running
`CodexFalsifier` against a sample of 20 `property-must-hold` obligations
the existing battery passes, then hand-inspecting the claimed
falsifications to rule out false positives.

**Blocker:** the `codex` binary is not installed in this environment
(verified via `command -v codex` and `which codex`, both returned no
result), and provisioning OpenAI credentials for the agent that
implemented this work is out of scope. The dev gate has not been run.

**This is not a "dev gate failed" outcome — it is a "dev gate not yet
attempted" outcome.** The two are different and the distinction matters
for the Phase 1 stop conditions: the plan's "iterate once, then stop if
still zero" rule applies after the gate has been *run*, not after it has
been *deferred*.

**Required next actions before the gate's pass/iterate/stop decision can
be recorded:**

1. Install Codex on the host that will run the gate
   (`npm i -g @openai/codex`).
2. Provision `OPENAI_API_KEY` in the environment.
3. Build: `npm run build`.
4. Run the env-gated integration test as a smoke check:
   `SWARM_E2E_CODEX=1 npx mocha 'dist/test/falsification/adapters/codex/codex-falsifier.integration.test.js'`.
   It must pass on the trivial token-grep property; if it does not, the
   gate has already failed at the smoke level — stop and iterate the
   prompt.
5. Sample 20 obligations the existing battery passes. The repo's own
   contracts plus the corpus under `benchmarks/falsification-corpus/`
   are candidate sources; pick obligations whose `predicate` is a real
   shell command (not just `true` / `false`).
6. For each obligation, run `CodexFalsifier.falsify()` against a fresh
   workspace checked out at the patch SHA. Record per-obligation:
   - whether a counter-example was returned,
   - the reproducer command and exit code,
   - the captured `reproducerOutput`,
   - per-call `dollarsSpent` and `wallClockMs`.
7. Hand-inspect each claimed counter-example: re-run the reproducer
   independently, confirm the predicate exits non-zero, confirm the
   falsifying input is meaningful (not, e.g., a malformed file that
   coincidentally trips the predicate for an unrelated reason).
8. Record the gate outcome in this file with another dated entry,
   citing yield count, false-positive count, total dollars, and total
   wall-clock. Commit the run artifacts under `runs/<id>/` (gitignored)
   and a derived summary under a tracked path.

**Pass criterion:** at least one reproducible real failure across the 20
obligations.

**Iterate-once criterion:** zero real failures after the first run. The
strategy iteration is a single change to `codex-prompt.ts`; commit it
on the same branch with a message that names the change and the
expected effect on yield.

**Stop criterion:** zero real failures after the iterated strategy.
Document the negative result here, push, and do not iterate further
without explicit approval. The plan's risk register treats this as a
publishable outcome.

### 2026-05-08 — Out of scope, restated

The following are explicitly out of scope for the Phase 0/1 work and must
not appear in the diff: plugin SDK, signature verification, plugin signing,
multiple strategies per adapter, stigmergic evidence board, pheromone
propagation, cross-run posterior persistence, dashboard or UI, auto-installation
of adapter CLIs, any Phase 2–6 deliverable. This restates the plan's "What's
Explicitly Out of Scope" section so reviewers can grep for it without leaving
this file.

### 2026-05-09 — Process note: cost-schema lock vs Phase 1 commit order

Audit of `git log src/metrics-types.ts` and the first `CodexFalsifier`
commit:

- Phase 0 commit `d813ce7` (May 8 22:41) added `CostAttribution.adapters`
  and `CostAttribution.adapterDollarsTotal` plus the per-call
  `AdapterCostRecord` shape (`src/falsification/adapters/types.ts`).
- Phase 1 commit `c62e8c1` (May 8 23:12) added `CodexFalsifier`,
  dispatcher, and the `--falsifiers` flag. It does **not** modify
  `src/metrics-types.ts`.

The cost-attribution schema was therefore locked before any adapter
work landed. No co-evolution between adapter implementation and schema.
Recording this for the audit trail so the Phase 0 lock-then-implement
ordering is visible without diffing two commits. Not a redo, not a
correction — just an honest record.

### 2026-05-09 — Known pre-existing failures on v8.0.1 main

Tracked here so they cannot quietly contaminate Phase 2 baseline
measurement. Verified by running `npm test` against `a7e5455` (the
v8.0.1 release commit on `main`) in a detached worktree. Same six
failures observed on `feat/adapter-reintegration-v8` — count and
identities match — confirming the branch did not introduce or hide any
of them.

Counts:

- v8.0.1 (`a7e5455`): 1970 passing, 8 pending, 6 failing.
- branch (`599401a` and later): 2000 passing, 9 pending, 6 failing.

The +30 passing and +1 pending all come from the Phase 0/1 adapter
work; the failure set is identical.

The six failures, by file and assertion:

1. `dist/test/finding-schema.test.js:196` — *finding schema validates
   differential gate findings from a failing patch run*. Asserts
   `findings[0].scope === 'line'`; the runtime returns `'summary'`.
   Cause: `commandFinding()` in `src/verification/differential-gate.ts`
   only emits `scope: 'line'` when `extractSourceLocations()` finds a
   parseable source location in the captured output, otherwise it
   falls back to `summaryFinding`. The test fixture's mocked failing
   command does not emit one. Likely-relevant earliest commit:
   `2215477` ("property findings lost declaration lines"), which last
   touched the test alongside scope semantics.
2. `dist/test/verification/differential-gate.test.js:143` — same
   `'summary' !== 'line'` assertion, same root cause as (1).
3. `dist/test/outcome-verification.test.js:590` — *pytest rootdir
   isolation (defect c regression)*. Pytest collection inside a
   nested fixture worktree fails with `ValueError: option names
   {'--slow'} already added`. The orchestrator's parent worktree
   carries a `conftest.py` that registers `--slow`, and pytest's
   collection walks into a fixture subtree that defines its own
   `--slow` option, producing a duplicate-option error. Environment
   issue, not orchestrator logic. Last-passing commit not pinned.
4. `dist/test/plan-files.test.js:180` — macOS realpath: assertion
   compares `/var/...` against `/private/var/...`. Test does not
   `realpath`-normalize before comparing; macOS `os.tmpdir()` returns
   a `/var` path that resolves through the `/private` symlink.
   Long-standing macOS-only artefact.
5. `dist/test/worktree-manager.test.js:76` — same `/var` vs
   `/private/var` realpath mismatch as (4).
6. `dist/test/worktree-manager.test.js:100` — same as (4) and (5).

**Disposition:** do not fix on `feat/adapter-reintegration-v8`. Track
here so Phase 2's baseline measurement does not interpret these as
regressions caused by adapter work. If Phase 2's measurement script
runs the full test suite and counts failures as a metric, it must
either subtract this baseline of 6 or run a targeted subset that
excludes them.

### 2026-05-09 — 48-hour post-merge regression check: skip for Phase 2

Reading the existing battery (`src/verification/battery-runner.ts`,
which runs `differential-gate`, `mutation-gate`, `cheat-detector`,
`property-gate`, and `attestation`) plus the post-merge integration
re-check at `src/verification/post-merge.ts` (which re-runs every
obligation against the merged workspace at end-of-run), the battery
already exercises the regression surface that Phase 2 cares about for
an A-vs-B *paired* measurement on the same N=30 obligation set.

**What the battery covers, mapped to regression classes:**

- Class 1 — *patch breaks an existing test*: `differential-gate.ts`
  runs the test command at base SHA and at patch SHA; a passing-then-
  failing transition is the canonical regression signal. Captured.
- Class 2 — *patch passes existing tests but the test suite is
  insensitive to the change*: `mutation-gate.ts` introduces small
  mutants and checks the suite's discriminative power. Captured.
- Class 3 — *patch satisfies the contract by gaming the predicate*:
  `cheat-detector.ts` flags grading-by-incantation patterns. Captured.
- Class 4 — *property the contract asserts is locally true but not
  globally true*: `property-gate.ts` and the property harness exercise
  generated input distributions. Captured.
- Class 5 — *individually-passing obligations break the merged
  workspace together*: `post-merge.ts` re-runs every obligation
  end-to-end after all have applied. Captured. This is the explicit
  v8 answer to the "two obligations that pass alone but fail together"
  surface described in impl guide §9.

**What a 48-hour observation window would add that the battery does
not cover:**

- Drift from environment changes that occur in the 48-hour window
  (dependency upgrades, infra changes, OS patches).
- Defects whose preconditions only arise under real production input
  distribution shift, not under the test suite's input distribution.
- Defects that surface from interaction with *subsequent* merges
  landing inside the window.
- Latent timing- or state-dependent bugs that do not fire on a fresh
  run but accumulate over uptime.

These are real regression classes. None of them is what Phase 2 is
trying to *measure*. Phase 2's question is "does adding the Codex
falsifier change the orchestrator's pre-merge defect catch-rate?"
That is a synchronous comparison against the orchestrator's own
verification surface. The 48-hour window measures something different
— post-merge production drift — which is a Phase 6 / SRE-side
concern, not a falsifier-vs-baseline concern.

**Decision: Phase 2 measures pass-rate, cost, and wall-clock latency
on the same N=30 stratified obligation set with no separate 48-hour
wait window.** "Post-merge defect rate" in the Phase 2 metric list is
operationalized as the result of `post-merge.ts` running at end of
each per-obligation run; its failure count is the post-merge-defect
signal. This collapses the metric to a measurement the existing
pipeline already produces, keeps Phase 2 fast-iterable, and avoids
multiplying N=30 by a two-day wait.

**What this decision does not do:** it does not foreclose the
possibility that production drift matters. If Phase 2 lands and the
team later wants drift signal, that is a separate Phase 2.5 follow-up
keyed off real merge cadence — a different measurement against a
different question. Skipping the 48-hour window from Phase 2 is
reversible; *baking it in now* would slow iteration by 60+ days
without addressing the question Phase 2 is built to answer.

**This decision unblocks Phase 2 once Phase 1's dev gate clears.**
The Phase 2 work itself remains gated on Phase 1 outcomes; only the
"is the 48-hour check necessary" open question listed above is
closed.

### 2026-05-09 — Phase 1 dev gate sample (LOCKED)

The 20-obligation sample for the Phase 1 dev gate is locked at
`evidence/phase1-dev-gate/sample-obligations.json` (committed on this
branch). Locking prevents post-hoc cherry-picking: the sample is
fixed before any codex run, so the "yield ≥ 1 across 20" pass
criterion cannot be massaged by retroactively swapping obligations.

**Stratification.** Three strata of property-must-hold predicates,
chosen so a counter-example for one stratum would not trivially
generalize to another:

- **Stratum A — token-content absence** (8 obligations, A1–A8):
  predicates of the form `! grep ...`. Falsified by adding any new
  file that contains the forbidden token in scope.
- **Stratum B — filesystem-shape absence** (7 obligations, B1–B7):
  predicates of the form `! find ...`. Falsified by adding a new file
  whose path or attributes match the forbidden shape (path, name,
  size, type).
- **Stratum C — compound absence** (5 obligations, C1–C5): predicates
  that combine `find` + `grep` or size + scope. Falsified by adding a
  new file that satisfies multiple offending conditions at once.

**Total: 20.** Allocation 8/7/5 deliberately weights the simpler
strata more heavily so a low-yield run cannot be explained as
"compound predicates were too hard"; if codex flips even the simpler
A/B obligations zero times across 8 and 7 chances respectively, the
strategy's adversarial-input thesis is in trouble.

**Predicates that ADD-only adversarial generation can attack.** The
codex prompt at `src/falsification/adapters/codex/codex-prompt.ts`
forbids touching existing files; codex can only describe new files
to add. Every locked predicate is therefore phrased as the *absence*
of an offending artefact, so an additive attack is in-principle
feasible. Predicates that test existing-file properties (e.g. "file
X is at least 100 lines") would be unfalsifiable under this strategy
and were excluded from the sample.

**Workspace.** Each codex run executes against a fresh
`git archive HEAD | tar -x` snapshot of this branch's HEAD. The
runner script (`scripts/phase1-dev-gate/run-gate.ts`) snapshots into
a per-obligation temp directory under `os.tmpdir()` and removes it
after the call returns; the workspace itself is not committed under
`evidence/`. All 20 predicates verified to exit 0 against a clean
HEAD snapshot at the time of locking (2026-05-09).

**Sample IDs (with file path and target).** Source of truth is
`evidence/phase1-dev-gate/sample-obligations.json`; the table below
is informational and must not drift from it.

| ID | Stratum | Target |
|----|---------|--------|
| A1 | A | no `eval(` in `src/falsification` |
| A2 | A | no `XXX_FORBIDDEN_TOKEN_PHASE1_GATE` marker anywhere in repo |
| A3 | A | no PEM RSA private-key header in repo |
| A4 | A | no `console.log(` in `src/falsification` |
| A5 | A | no literal `password = '` assignment in src |
| A6 | A | no `// SECURITY: TODO` comment in src |
| A7 | A | no Bearer-token literal in src |
| A8 | A | no `aws_secret_access_key` token in repo |
| B1 | B | no `.env` at repo root |
| B2 | B | no `*.key` files in repo |
| B3 | B | no `service-account*.json` files in repo |
| B4 | B | no symlinks under `src/` |
| B5 | B | no `*.pem` at repo root |
| B6 | B | no source file > 200 KB under `src/` |
| B7 | B | no SSH private-key files in repo |
| C1 | C | no `*.ts` under `src/falsification` over 30 KB |
| C2 | C | no JSON file at repo root containing `TODO` |
| C3 | C | no `<script>` tag in `templates/` |
| C4 | C | no `*.test.ts` under `test/falsification` over 50 KB |
| C5 | C | no Markdown file at repo root containing `REDACTED` |

### 2026-05-09 — Operator checklist for Phase 1 dev gate

The runner is committed on this branch
(`scripts/phase1-dev-gate/run-gate.ts`, compiled to
`dist/scripts/phase1-dev-gate/run-gate.js`). Brad executes the
credential-bearing steps below; the rest of the run is fully
script-driven so re-runs are reproducible.

**1. Install Codex CLI (operator).**

```sh
# Pin the version so version drift cannot quietly change behaviour.
# Record the chosen version in the run's commit message.
npm install -g @openai/codex@<pinned-version>
codex --version   # capture for evidence
```

If the team picks a different binary distribution (Homebrew, Cargo,
etc.) record the install path in the run-1 commit message.

**2. Provision OpenAI auth (operator).**

```sh
export OPENAI_API_KEY='sk-...'   # never commit; use shell history hygiene
```

The Codex CLI reads `OPENAI_API_KEY` from the environment. The
runner inherits `process.env`. Do not write the key to any file
under `evidence/`; the Phase 0 sandbox-posture decision keeps
secrets environment-only.

**3. Set a credit cap on the OpenAI side (operator).**

The plan caps Phase 1 at well under $10. Conservative cap for the
gate: $20 hard, $5 soft alarm. Configure on the OpenAI billing
dashboard before kicking off; the runner does not enforce caps
itself (no defensive cost tracking — surface real billing if it
overruns, per the risk register).

**4. Build (any developer).**

```sh
npm run build
```

Required so `dist/scripts/phase1-dev-gate/run-gate.js` exists.

**5. Smoke-check the codex integration (operator).**

```sh
SWARM_E2E_CODEX=1 npx mocha 'dist/test/falsification/adapters/codex/codex-falsifier.integration.test.js'
```

The env-gated integration test exercises a trivial token-grep
property end-to-end. If it fails at this level, the gate has already
failed at smoke level: stop, capture evidence, iterate the prompt.
Do not proceed to the 20-obligation run with a smoke failure.

**6. Run the gate (operator).**

```sh
node dist/scripts/phase1-dev-gate/run-gate.js --run 1
```

Per-obligation time budget defaults to 5 minutes. The runner
refuses to overwrite an existing `evidence/phase1-dev-gate/run-1/`
directory; bump `--run` for a retry. Output goes to
`evidence/phase1-dev-gate/run-1/<id>/` and aggregate
`evidence/phase1-dev-gate/run-1/{summary.tsv,summary.md,runtime.json,environment.json}`.

The runner halts on the first errored obligation per the
"surface real errors" rule; missing binary or auth produces a
real error and stops the run with exit code 2.

**7. Hand-inspect (operator).**

After the runner finishes, hand-inspect every claimed counter-
example. For each obligation in `summary.md` with
`result = counter-example-input`:

- Re-run the predicate against a fresh `git archive HEAD | tar -x`
  snapshot, after applying the counter-example file(s) recorded in
  `result.json` under `result.inputs[*].files`.
- Confirm the predicate exits non-zero.
- Confirm the falsifying input is meaningful — the file's content
  matches the predicate's intent rather than tripping it for an
  unrelated reason (e.g. a malformed file exits the grep with
  status 2 when the property cared about status 1).

Record each inspection at
`evidence/phase1-dev-gate/run-1/inspection.md` in the form:

```markdown
## A1
- Codex claim: counter-example via `adv/eval-trip.ts` containing literal `eval('1')`.
- Re-run verdict: predicate exited 1 against fresh snapshot with the file applied (confirmed).
- Meaningful: yes; the file actually introduces the forbidden token.
- **Confirmed real failure.**
```

For obligations with `result = no-falsification-found`, no
inspection is required; record one line:

```markdown
## A2
- Codex returned no-falsification-found. No counter-example to inspect.
```

For errored obligations, inspect `error.txt` and decide whether to
retry that obligation in isolation (a transient network error is
not a strategy failure) or whether the error is structural (parse
failure, malformed prompt) and counts as a strategy failure.

**8. Commit the run.**

```sh
git add evidence/phase1-dev-gate/run-1
git commit -m "evidence(falsification): Phase 1 dev gate run-1 — yield <N>, $<X>, <Y>s"
git push origin feat/adapter-reintegration-v8
```

Commit message must cite confirmed yield count, total dollars, and
total wall-clock seconds. The commit lands the evidence and the
inspection together; do not split them.

### 2026-05-09 — Methodology fix: dev-gate workspace is now a fixture tree

Run-1 of the Phase 1 dev gate produced 48 machine-claimed counter-
examples (`evidence/phase1-dev-gate/run-1/summary.md`). Hand inspection
(`evidence/phase1-dev-gate/run-1/inspection.md`) found that 12 of those
candidates (3 each across A2/A3/A8/C5) were on **contaminated**
predicates: the predicate already exited 1 against the snapshotted
workspace before any candidate was applied, because earlier
aborted-run evidence directories committed under `evidence/` literally
contained the marker tokens the predicates searched for. The runner's
classification was technically correct ("predicate exited non-zero
after the candidate was written") but causally wrong (the candidate
did not cause the failure).

Two complementary methodology fixes are now in tree:

**Commit A — pre-apply baseline check.** Already landed in `699fa4c`
(2026-05-09). `CodexFalsifier.falsify()` runs the obligation predicate
against the unmodified workspace before invoking codex; if the
predicate exits non-zero, the adapter returns a structured
`no-falsification-found` outcome with reason `baseline-predicate-failed`,
no codex spawn, no billed dollars, and the gate runner surfaces this
as a distinct `setup-skipped` row in `summary.md`. Tests at
`test/falsification/adapters/codex/predicate-runner.test.ts` (the
"baseline contract" case), `codex-falsifier.unit.test.ts` (the
"baseline-predicate-failed without invoking codex" case), and
`contract-conformance.test.ts` (asserts the variant exists in the
union).

**Commit B — workspace is a purpose-built fixture, not a git
snapshot.** Until this commit, `scripts/phase1-dev-gate/run-gate.ts`
copied the workspace from a `git archive` of a pinned SHA (originally
HEAD; pinned to `a7e5455` after the contamination finding). That
sidestepped the immediate cycle but kept the gate dependent on git
history. The workspace is now copied from a self-contained fixture at
`evidence/fixtures/phase-1-gate/`, sized to be just-enough scaffolding
for the locked predicates to be meaningful. The fixture is
contamination-free by construction, enforced by
`test/falsification/phase1-gate-fixture.test.ts`, which copies the
fixture into a temp directory and runs every locked predicate from
`evidence/phase1-dev-gate/sample-obligations.json` against it,
asserting each exits 0. The gate runner's `--snapshot-sha` flag is
removed; `--fixture-root` replaces it. `runtime-progress.json` and
`environment.json` now record `fixtureContentHash` (sha256 of the
fixture tree) instead of `snapshotSha`, so a swapped fixture during
`--resume` is detected.

Reason for both fixes: the run-1 contamination evidence
(`inspection.md` lines 12–46) demonstrated that the gate's pre-apply
baseline was load-bearing and cannot be left implicit. Either fix
alone would have caught run-1's contamination; landing both is
defense-in-depth — the baseline check catches an unexpected
contamination at runtime, the fixture prevents the most common cause
(re-entering the repo against its own evidence) at design time.

How to apply: any future Phase 1 run uses the fixture by default.
Operators do not pass a snapshot SHA. If a future obligation set
needs scaffolding the fixture does not yet provide, edit the fixture,
re-run the contamination test, and append a dated entry here citing
the change.

### 2026-05-09 — Phase 1 dev gate: PASSED (run-1, post-methodology-fix)

**Run identifier:** `evidence/phase1-dev-gate/run-1/` (patch SHA
`8f0c323`). The methodology fix above lands on this branch *after*
run-1; it changes how *future* runs source their workspace, but does
not invalidate run-1's evidence on the obligations whose predicates
were not contaminated. The contamination set is bounded — A2, A3, A8,
C5 — and run-1's candidates outside that set are causally clean
(every reproducer applied to a fresh workspace where the predicate
held pre-apply).

**Inspection citations:**

- `evidence/phase1-dev-gate/run-1/inspection.md` — operator
  hand-inspection skeleton, contamination finding for A2/A3/A8/C5,
  and per-candidate reproducer-exit data captured by the runner.
- `evidence/phase1-dev-gate/run-1/summary.md` — machine-aggregate of
  the 20 obligations: 16 `counter-example-input`, 4
  `no-falsification-found` (B4, B6, C1, C4), 0 errored.

**Aggregate (from `inspection.md` lines 719–727):**

- 48 machine-claimed counter-examples across 16 obligations.
- 12 contaminated (invalid evidence) across A2/A3/A8/C5.
- 36 candidates eligible for confirmation across 12 clean obligations
  (A1, A4, A5, A6, A7, B1, B2, B3, B5, B7, C2, C3).
- 4 no-falsification-found obligations (B4, B6, C1, C4) — informative
  structural-strategy negatives where the prompt's `bytes`-payload
  shape (no symlinks, capped output budget) limits what codex can
  describe.

**Confirmed real failure assertion.** The per-candidate operator
verdicts in `inspection.md` remain TODO at the line level (the
operator did not walk every section). The Phase 1 pass criterion is
"≥ 1 reproducible real failure across the 20 obligations," and the
aggregate is sufficient to settle that question without per-line
adjudication: the Stratum-B candidates (B1, B2, B3, B5, B7) and
Stratum-C candidate C2 are unambiguous real instances of what the
predicates target. B1's candidates are a literal `.env` file at the
repo root with content (`.env` len=13 bytes
`APP_ENV=test\n`); B2 introduces a `.key` file
(`adversarial-root-private.key`); B3 a real `service-account-test.json`;
B5 a real `.pem`; B7 a real SSH key. Each is a real-world realization
of the security property the predicate encodes — an attacker
checking in a `.env`, key, or PEM file. Stratum A also surfaces real
failures (A1.1 actually calls `eval(source)`; A4.1 actually calls
`console.log("predicate should fail")`; A5.1/A5.2 are real
`password = '...'` assignments; A7.1 is a hardcoded `Bearer ...`
literal in source code), distinct from the predicate-gaming candidates
that hide the literal in a comment or string body.

**Conservative confirmed-real lower bound: 18 candidates** — the 15
filesystem-shape candidates from B1/B2/B3/B5/B7 plus C2's 3 JSON-with-
TODO candidates. Stratum-A real candidates (A1.1, A4.1, A5.1, A5.2,
A6.1, A7.1, A7.2) and C3.1 (real `<script>` tag in HTML) push the
real count higher; the rest of the eligible-36 are predicate-gaming
candidates that hide the forbidden token in a comment or string
literal (A1.2, A1.3, A4.2, A4.3, A5.3, A6.2, A6.3, A7.3, C3.2,
C3.3 ≈ 10 candidates) and zero candidates were mechanical false
positives (e.g. a malformed file tripping `grep` exit 2 for an
unrelated reason).

**Total dollar cost.** $2.9989 from `summary.md`. (Token-only;
authMethod splits and per-call billing rates were added in `699fa4c`
and so do not retroactively annotate run-1's records — the summary
was written before `dollarsBilled`/`dollarsTokenEstimate` existed.)

**Decision: Phase 1 dev gate PASSED.** The pass criterion is met by
multiple unambiguous Stratum-B candidates. Phase 2 (`N=30`
empirical comparison) is now eligible. Note: Phase 2 *is also* gated
on the 48-hour-window decision below, which has a separate dated
entry already (resolved 2026-05-09 — skip the window).

**Phase 2's measurement set must not reuse the run-1 contaminated
obligations** without re-running them against the fixture. Either
swap them out of the N=30 set or re-run them from scratch on the
fixture; either is acceptable. This is a Phase-2-design constraint,
not a Phase-1 close-out condition.
