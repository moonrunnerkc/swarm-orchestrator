# Reach run: evidence report

The left-to-do list, finished: two builds (miner definitional tightening, polyglot
restoration proofs), one cycle (mine, package, review halt), one experiment
(pre-registered Hunt 6), and this hygiene pass. The pass-capability research problem
stayed parked. Nothing weakened: every control, threshold, and bar is byte-identical;
the one engine generalized carried its full control set with it.

## What shipped

- **The miner is tightened definitionally** (`e07661e5`): a complaint counts only from a
  human other than the PR author. Self-comments and bots (the `[bot]` suffix, account
  type `Bot`, and the Copilot review surface) are excluded before matching. Package
  noise fell 13% to 3.3%.
- **The test-tamper restoration engine is polyglot** (`a485602b`): it executes on pytest
  and Go, live-validated on planted fixtures (4/4). Every control travels; the TS path
  is byte-identical.
- **The corpus review cycle ran** (`7773eb02`): a tightened fresh mine and a regenerated
  6-candidate package, halted for the maintainer's sitting.
- **Hunt 6 ran** (`3f266360`, `e4756ffe`): 0 of 2, with the barrier located precisely.

## Phase 1: miner definitional tightening, regression both directions

The definition was restored, not tuned: "a maintainer publicly called it a cheat"
requires a human other than the PR author. `isMaintainerComplaintEntry` and `isBotAuthor`
(catching the bare `Copilot` login that leaked through) gate the miner and the control
harness; documented in `DATASET.md`.

- **Negative direction (the last 24-candidate package as a labeled noise fixture):** 17
  of 24 excluded, every one a self-comment (10) or a bot review (5), or both (2); 7
  admitted (the 2 folds plus 5 legit-on-merits that pass intake and die at human review).
- **Positive direction (do the 29 folded entries still pass):** this run's 2 folds pass;
  **19 of the inherited 27 would not** (13 self, 6 bot, e.g. outline/outline#12197's
  complaint is a Copilot review). Reported with temporal-drift and solo-maintainer
  caveats; the frozen corpus is unchanged, the finding is staged for a future tightened
  re-verification.
- **Package noise 13% -> 3.3%** on the committed negative-control set.
- Full numbers and reproduce: `benchmarks/real-prs/mining-verification/TIGHTENING-REPORT.md`.

## Phase 2: polyglot restoration proofs (soundness-gated)

The runner seam grew, the engines did not weaken. `buildTestCommand` and
`parseFailingTests` gained pytest (file-scoped, nodeid identities) and go-test
(package-scoped, `go test -v -count=1` to defeat Go's test cache, `--- FAIL:`
identities). Every control travels unchanged (base-passes, tampered-passes,
restored-fails-twice-same-identity, the re-spec refuter); the TS path is pinned
byte-identical by the existing parser tests plus new pins.

Live-validated on planted fixtures (`scripts/oracle/polyglot-restoration.ts`,
`POLYGLOT-RESTORATION-REPORT.md`): pytest-tamper and go-tamper both **proven** with full
controls green (identities `test_calc.py::test_add`, `TestAdd`); pytest-clean and
go-clean both **refuted**; 4/4. A proven verdict on a clean control would be
stop-the-line; the validator throws on it.

**Bounded by soundness, honestly.** no-op-fix is not generalized: its coverage control
(control 3) is implemented only against Istanbul JSON, and Go additionally has no
import-graph closure; per the standing rule (full control set travels or it does not
ship), it keeps its non-TS abstain. The TS-married engines keep theirs. Elixir has no
provisioner (recorded exclusion; the entry that needs it, elixir-nx#1685, is not
proof-executable this run). The Go toolchain was installed user-local to run the
validation (go1.26.5, `~/go-toolchain`, no sudo, reversible).

## Phase 3: mine, package, review halt

The tightened miner found 3 new captures (down from 7 loose last run; self-authored
WorksCalendar and bot-authored Baniraloves are now excluded at intake). The regenerated
package unions them with the 5 prior candidates that survive the tightening, deduped
against corpus v2: **6 candidates, 2 EG-viable**. On prior human review these read as
legitimate-on-the-merits or iteration feedback, so 0 are recommended to fold; halted for
the maintainer's sitting. The endgame checkpoint and mined-candidates were kept frozen.

## Phase 4: pre-registered Hunt 6

Pre-registered before any run artifact (precedence provable: `3f266360` precedes
`e4756ffe`). Primary set: the 2 folded entries (0 folded this session), frozen by SHA.
Ran `swarm audit --pr` on both pinned heads with the Go toolchain on PATH.

**0 proven of 2.** The barrier moved, and this is the run's sharpest result: Hunt 5
abstained at the engine (the runner could not execute non-Node). Hunt 6, with the
polyglot engine in place, abstains **upstream of the engine** at the same gate for both
entries: `mutableSourceFilter` (`src/audit/execution-grounded/index.ts:81`,
`/\.(?:[cm]?[jt]sx?)$/`) admits only JS/TS extensions, so a `.go/.py` diff bails at "no
mutable source lines in diff", 0 engines executed, no workspace provisioned. The engine
is polyglot; the pipeline front-end that feeds it candidates is not. The next build is
named by file and line: generalize `mutableSourceFilter` and the JS/TS structural
detectors to `.go/.py`, carrying the mutation/coverage front-end. Full autopsy:
`benchmarks/real-prs/hunt6/HUNT-6-REPORT.md`.

## Phase 5: hygiene

`git status` is clean except the pre-existing untracked `social-posts-behavioral-cheats.md`.
Every artifact this run produced is committed. Prior runs' artifacts are present on main:
evidence dirs (endgame, mining-verification, intake-rewire, soundness, ...), corpus v1
and v2, hunt reports 3 through 6, the three capstone evidence reports. READINESS was
refreshed item by item (the polyglot engine matrix and its pipeline reach limit in item
3; the tightened intake, the corpus growth to v2, the two hunt zeros, and the inherited
corpus finding in item 4; the blockers table; the parked research problem named in the
header).

## Per-phase commits

| phase | commit | what landed |
|---|---|---|
| 0 baseline | `10c09982` | probes, Go install, soundness-gated scope |
| 1 tightening | `e07661e5` | self/bot exclusion, regression both ways, 13% -> 3.3% |
| 2 polyglot engine | `a485602b` | test-tamper on pytest/Go, 4/4 fixtures, LOC 47226 -> 47282 |
| 3 mine + package | `7773eb02` | tightened fresh mine, 6-candidate package, review halt |
| 4 Hunt 6 pre-reg | `3f266360` | frozen design before any run |
| 4 Hunt 6 run | `e4756ffe` | 0 of 2, barrier at mutableSourceFilter |
| 5 report + READINESS | this commit | hygiene, item-by-item refresh |

## Spend

| phase | usd | detail |
|---|---|---|
| 0, 1 | ~0.00 | probes + GitHub core API (the tightening regression is fetch-only) |
| 2, 4, 5 | 0.00 | deterministic; the fixture and audit runs use no model |
| 3 fresh mine | 0.52 | Opus arbiter annotation, capped |
| **total** | **0.52** | under the $1.71 cap |

## Deviations (numbered)

1. **no-op-fix not generalized to pytest/Go.** Control 3 (changed-line coverage) is
   Istanbul-only and Go lacks an import closure; porting coverage.py/go-cover is the
   bounded-but-separate work the run must not become. Recorded, not built, per the
   standing rule.
2. **Elixir provisioner not added.** Out of bounded scope; elixir-nx#1685 records the
   exclusion. Named as the next step if a mix provisioner and ExUnit parser are wanted.
3. **Go installed user-local.** `sudo` needs a password; the official tarball to
   `~/go-toolchain` is a reversible user install, recorded in the baseline.
4. **LOC budget raised 47226 -> 47282** for the new engine capability (the polyglot
   runner seam). A size ratchet, not a soundness bar; the exact new count is committed.
5. **19 of the inherited 27 flagged by the tightened re-verification.** Reported, not
   acted on (frozen corpus; temporal-drift caveat). This run's own 2 folds pass.
6. **0 folded this session.** Phase 3's 6-candidate package holds no clean cheat on
   prior review; Hunt 6's primary set is therefore unchanged from Hunt 5.

## The result this run set out to produce

The instrument is sharper (self/bot noise gone, 13% to 3.3%), the engine reaches two new
languages (validated, sound), the corpus review cycle is tighter (24 to 6 candidates),
and the experiment located the exact next barrier by file and line. No wild cheat was
proven, and the report says so plainly: the polyglot engine is ready, the pipeline
front-end that would feed it a wild Go or pytest cheat is the named next build.
