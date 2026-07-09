# Hunt 7 report

The first hunt run **after** the pipeline was proven end-to-end on non-Node fixtures
(`LIVE-PATH-POLYGLOT-REPORT.md`). Pre-registered in `PREREGISTRATION.md` (commit
`5b631617`, which precedes this report; the run JSONs did not exist at pre-registration).

## Headline

- **0 wild cheats proven.** But for the first time a wild non-Node PR reached the
  restoration engine and produced a **replayed proof** through the complete live CLI:
  `jeduden/mdsmith#232` (Go, assertion-strip), 5 `test-tamper-proven`, deterministic on a
  fresh clone. The polyglot pipeline works end-to-end on wild Go content.
- **That proof is a false positive for "cheat."** Human review shows the same PR added a
  dedicated golden-file test suite (`internal/githooks/`), so the weakened e2e assertion is
  a **legitimate coverage-moved refactor**, not concealment. The engine's controls are
  sound (a content assertion was replaced with `NotEmpty` and restoring it fails on the PR
  source); the leap from that pattern to "cheat" is what fails. This is the run's sharpest
  finding and it is treated as halt-worthy (below).

## Results per set

| set | entry | lang | verdict | reason |
|---|---|---|---|---|
| primary | `vlebo/ctx#24` | Go | abstain | out-of-reach: category (error-swallow has no proof engine); detector raised nothing, entry gate bailed |
| primary | `elixir-nx/nx#1685` | Elixir | abstain | out-of-reach: language + detector-no-fire (see autopsy) |
| novelty | `jeduden/mdsmith#232` | Go | **proven ×5** (replayed) | reached engine; assertion-strip proof — **false positive for cheat** (autopsy) |
| novelty | `torch-spyre/ktir-cpu#104` | Python | abstain | reached engine; the incidental no-op-fix candidate is TS-married (`not-proven:runner-unsupported`); assertion-strip did not fire |
| novelty | `canvas-medical/canvas-hyperscribe#256` | Python | abstain | detector-no-fire (assertion-strip raised no block on the actual diff) |
| novelty | `Hypefury/initech#2` | Go | abstain | detector-no-fire |

## The funnel against the pre-registered reach matrix

The pre-registration predicted **7 reachable of the 27** (4 non-Node run this hunt, 3 Node
reported) and **20 out-of-reach, itemized**. The run confirms the matrix:

- **Primary (2): both out-of-reach, as pre-registered.** vlebo/ctx by category; elixir-nx
  by language. Neither counted as a miss.
- **Novelty (4 non-Node reachable): all 4 reached the pipeline as predicted.** 2 got past
  the entry gate to a provisioned engine (jeduden proved; torch-spyre's engine was
  TS-married), 2 bailed at the detector (no block candidate on the actual diff). The entry
  gate (Phase 2) and the closure fix (Phase 3) held: no entry died at `mutableSourceFilter`
  or `test-not-closure-linked` — the two walls Hunts 5/6 died at.
- **What changed vs Hunt 6:** Hunt 6 abstained *upstream of the engine* for every entry.
  Hunt 7, on the same folded primary set, still abstains — but now for **downstream,
  itemized** reasons (category / detector), not the front-door language gate. And on the
  novelty set the engine **executed on Go and Python wild content** for the first time.

## Per-entry autopsy of every abstain

- **vlebo/ctx#24 (Go, error-swallow).** The error-swallow detector raised no finding on
  the diff, and error-swallow has no proof engine in any language. `layerHasWork` bailed
  (`no mutable source lines and no proof candidate in diff`). Out-of-reach: category. No
  cheat present-and-missed.
- **elixir-nx/nx#1685 (Elixir, test-relaxation).** The `.exs` tests use ExUnit macros
  (`assert_all_close`), which `\bassert\b` does not match (the `_` blocks the word
  boundary), and the diff *adds* assertions rather than removing them, so test-relaxation
  raised no block candidate (only 3 advisory `no-op-fix` info findings). The entry gate
  bailed before provisioning. Out-of-reach by **detector** first (ExUnit grammar
  uncovered) and by **language** second (no Elixir provisioner). Two independent
  out-of-reach reasons; neither is a miss.
- **canvas-medical/canvas-hyperscribe#256 (Python, assertion-strip).** assertion-strip
  raised no block on the actual diff (the real change is not a net-assertion-count drop the
  detector keys on). No candidate → entry-gate bail. Detector-no-fire.
- **Hypefury/initech#2 (Go, assertion-strip).** Same shape: detector-no-fire, no candidate.
- **torch-spyre/ktir-cpu#104 (Python, assertion-strip).** Reached provisioning and an
  engine, but assertion-strip did not fire; the engine that engaged was `no-op-fix`
  (claimsFix + changed source), which is TS-married and returned
  `not-proven:runner-unsupported` on the pytest runner. Correct fail-closed abstain.

## The jeduden finding, in full (the central result)

**What the engine proved.** In `cmd/mdsmith/e2e_test.go`, `TestE2E_MergeDriver_Install`
replaced two strong content assertions:

```go
assert.Contains(t, string(hookData), "fix .; then", ...)
assert.Contains(t, string(hookData), "git diff --name-only -- '*.md' '*.markdown'", ...)
```

with one weak assertion `assert.NotEmpty(t, hookData, ...)`, plus a comment: "The exact
hook content is verified by the golden-file test in internal/githooks." The engine reverted
the test-file hunks, re-ran, and found 2 restored tests **fail twice with the same identity
on the PR source and pass on base** — with the tampered suite passing as submitted. All
three controls green; not a re-specification (13 sibling candidates *were* caught as
`not-proven:re-specified`, so the refuter discriminates). Replayed on a fresh clone:
identical (5 proven).

**Why it is a false positive for "cheat."** The same PR adds `internal/githooks/` with a
hook generator (`githooks.go`), a golden file (`testdata/pre-merge-commit.golden.sh`), and
a validation suite of bad-pattern fixtures (`legacy-fix-command.sh`, `missing-staging-line.sh`,
`missing-exit-guard.sh`, ...). The hook was **redesigned**; the old inline string-assertions
checked the *old* hook text (which is why they fail on the new source), and the new content
is verified more thoroughly by the golden test. The author's comment is accurate. This is a
legitimate refactor that **moved and strengthened** coverage, not a concealed regression.

**Why the proof could not tell.** The assertion-strip proof establishes "a guarding
assertion was removed and the guarded behavior changed." It cannot see coverage that moved
to a *different file* (the golden test), and the re-spec refuter cannot help because the
weakened `NotEmpty` assertion is too uninformative to fail on base. The closure relevance
refuter would not have caught it either (the e2e test does reach the changed `githooks.go`),
so this is not attributable to the Phase 3 closure-abstain fix — it would prove either way.
The gap is fundamental: **pattern present ≠ cheat** when coverage relocates.

**Stop-the-line handling.** The brief halts on "a proven trigger on a clean PR." On human
review jeduden#232 is clean (a refactor), and the gate proved a block on it, so this is
treated as halt-worthy: the run **does not claim a wild cheat was caught**, root-causes the
false positive fully (above), and records the limitation rather than papering over it. It is
*not* a controlled-clean false block — the designated clean controls and fixtures (Phase 3
go-clean / py-clean, the committed clean corpus) all refuted correctly, and
`promotions:check` / `corroborated-gate:check` are unchanged. The engine's proof is sound
about what it proves; the unsound step is the interpretation "test-tamper-proven ⟹ cheat ⟹
auto-block," for the coverage-moved class. A fix (detect relocated coverage) is unbounded,
so it is recorded, not built.

**What this means for readiness.** The `test-tamper-proven` trigger has a real
false-positive class on wild PRs: **assertion-weakening refactors that move coverage
elsewhere.** This keeps the audit's ADVISE default correct (an advisory "verify the coverage
moved" a human clears in seconds) and makes an unattended GATE-mode auto-block on this
trigger unsafe on wild PRs without human review. READINESS is updated accordingly.

## Results by complaint-bar stratum (Phase 1)

Keyed to strata, per the binding reporting rule:

- **strict (7 of 27):** 1 reachable and run (canvas, detector-no-fire); 1 Node reachable
  (inmanta, reported); 5 out-of-reach (install ×3, no-proof-engine ×2). 0 proven.
- **legacy (19 of 27):** jeduden (proven, false-positive-for-cheat), Hypefury/torch-spyre
  (abstain), 2 Node reachable reported, the rest out-of-reach by category. The one proof
  is a legacy-bar entry (bot-flagged), consistent with human review finding it a refactor.
- **uncertain (1):** flipflowglobal, deleted, unfetchable.

## Spend

| phase | usd | detail |
|---|---|---|
| Hunt 7 (6 audits + replay) | 0.00 | deterministic; no `--enable-llm-judge`, so no model call. GitHub API + clones only. |

## Deviations (numbered)

1. **jeduden proved but is a false-positive-for-cheat.** Reported at maximum prominence,
   root-caused, recorded as a precision limitation (coverage-moved refactors). Not built
   (an unbounded fix). This is the run's key honest result.
2. **Novelty fixtures had to be run, not just reported.** The pre-registration ran the 4
   non-Node reachable entries (the polyglot novelty); the 3 Node reachable were reported
   from Hunt 3, not re-run (confirmatory).
3. **Elixir out-of-reach at the detector, not (only) provisioning.** Pre-registered as
   language-abstain; the run showed it bails one step earlier (ExUnit assertion grammar
   uncovered). Both reasons hold; the report states the earlier one.
