# Close-out run: evidence report

The left-to-do list, finished: settle the complaint-bar question with facts, remove every
language gate in the pipeline and prove it end-to-end before spending a hunt, run Hunt 7,
and bring the tool to a state a stranger can install and benefit from, plus a claims ledger.
The pass-capability research problem stayed parked. Nothing weakened: every control,
threshold, and bar is byte-identical; the frozen corpus versions and checkpoints are
untouched.

## The result this run set out to produce

The single sharpest outcome: **the polyglot pipeline proved a `test-tamper` on a wild Go PR
end-to-end through the shipped `swarm audit --pr`, and the autopsy shows that proof is a
false positive for "cheat."** That is a better result than a clean catch: it demonstrates
the non-Node pipeline works on wild content (the walls Hunts 5/6 died at are gone) and it
surfaces, with a concrete wild example, the gate's one false-positive class (assertion
weakening that relocates coverage). No genuine wild cheat has been proven; the writable
claim is capability and its measured limit, not a catch.

## Per-phase commits

| phase | commit | what landed |
|---|---|---|
| 0 baseline | `9e6d86f6` | probes (gh + anthropic live via `.env`), suite green, spend cap $5.00 |
| 1 complaint-bar | `74d34167` | live-refetch authorship audit + v3 stratification (strict 9 / legacy 19 / uncertain 1) |
| 2 census | `1377a310` | pipeline language census, committed before any fix |
| 2 entry-gate fix | `55812896` | `layerHasWork` admits `.go`/`.py` proof candidates; TS path byte-identical |
| 3 closure fix | `cb44ea62` | `isClosureAnalyzable`, closure refuter abstains on non-analyzable languages (second wall, found by the live-path proof) |
| 3 live-path proof | `e4948644` | Go + Python test-tamper prove through `swarm audit --pr`, 4/4 + replay |
| 4 pre-registration | `5b631617` | Hunt 7 frozen before any run artifact |
| 4 Hunt 7 report | `aceb3362` | 0 wild cheats; jeduden false-positive-for-cheat; funnel vs reach matrix |
| 5 README + claims | `68aeeb47` | truth sweep, `docs/CLAIMS.md` |
| 6 READINESS | `ae6eaa16` | items 3, 4, 6 refreshed |
| 6 em-dash cleanup | `fc3bc73c` | fix-forward style cleanup |
| 6 this report | this commit | close-out |

## Phase 1: complaint-bar audit and stratification

The finding that gates everything: **fold-time capture never stored the complaint author.**
So no entry's strict-bar status is settleable from frozen evidence; a live re-fetch supplies
it (`complaint-bar-audit.ts`, reusing the committed `isMaintainerComplaintEntry` /
`isBotAuthor`, no bar changed). Over the 29: **strict 9, legacy 19 (6 solo-maintainer
self-flags), uncertain 1.** Of the inherited 27: strict 7, legacy 19, uncertain 1;
content-aware strict is 6 (one strict complainant, `alchemy1729-bot`, is an automated verdict
account the committed bar does not catch). The published "27 maintainer-flagged" is the
loose bar; the independent-human bar is 7 of 27. v1/v2 byte-identical; v3 is a new labeled
version. Deliverable: `benchmarks/real-prs/wild-cheat-corpus/COMPLAINT-BAR-AUDIT.md`.

## Phase 2: census, then the fixes

Two live traces (`vlebo/ctx#24` Go, `canvas-hyperscribe#256` Python) both bailed at the same
wall. The census (`evidence/closeout/PIPELINE-LANGUAGE-CENSUS.md`, committed before any fix,
cross-checked by an independent full-path trace) found the front-end has **one** hard JS/TS
gate: the execution-grounded entry condition reused `mutableSourceFilter` (JS/TS-only). Fix:
`layerHasWork` separates the mutation/coverage target set (stays JS/TS for Stryker/Istanbul)
from the layer entry condition (proceeds on any proof candidate). TS path byte-identical,
pinned by `layer-has-work.test.ts`. Everything downstream was already polyglot from the reach
run; the restoration-feeding detectors already fire on Go `t.Error`/`t.Fatal` and Python
`assert`.

## Phase 3: end-to-end proof on the live path

Running the live path surfaced a **second wall the static census could not see**: the
Protocol-1 closure relevance refuter only activates when a `repoRoot` is threaded (the live
path does; the engine harness did not), and its import analysis is TS/JS/Python only, so it
mis-refuted a genuine Go proof. Fixed by `isClosureAnalyzable` (abstain on non-analyzable
languages, the same fail-closed stance it takes for a capped BFS). The census was amended
(A2) to record it honestly.

Then, through the complete shipped CLI against private throwaway fixture repos:

- `py#1` / `go#1` tamper: `assertion-strip` block, entry gate admits, clone + install,
  restoration **proven** (3 controls), `test-tamper-proven`, gate exit 1.
- `py#2` / `go#2` clean: same candidate, restoration **refuted**, no trigger, exit 0.
- Attestation reports `test-restoration` executed on pytest/go-test (the non-Node matrix).
- Fresh-clone replay: both tampers reproduce proven.
- Zero-false-block: clean fixtures 0 triggers; `promotions:check` gate-eligible=0 and
  `corroborated-gate:check` `undefined-n`, both unchanged.

`benchmarks/oracle-corpus/LIVE-PATH-POLYGLOT-REPORT.md` (4/4). The tautology reach-fixtures
are not detector-detectable, so the live-path fixtures use an assertion deletion (recorded).

## Phase 4: pre-registered Hunt 7

Pre-registered before any run artifact (`5b631617` precedes the report; no run JSON existed).
Primary set (the 2 folds): 0 proven, both out-of-reach as pre-registered (vlebo/ctx by
category, elixir-nx by language and ExUnit-grammar). Novelty set (4 non-Node reachable): 1
reached the engine and proved (`jeduden/mdsmith#232`, replayed), 1 reached a TS-married
engine and abstained, 2 detector-no-fire. The funnel confirms the pre-registered reach
matrix (7 reachable of 27, 20 out-of-reach itemized, none a miss). **The jeduden proof is a
false positive for cheat** (the same PR moved coverage to a golden-file test the engine
cannot see); root-caused, recorded as the gate's one false-positive class, not built (an
unbounded fix). Full autopsy + stop-the-line handling in
`benchmarks/real-prs/hunt7/HUNT-7-REPORT.md`. Spend 0.00 (deterministic).

## Phase 5: user-ready product state

Fresh-clone quickstart executed (clone the local repo, `npm install`, `npm run build`,
`swarm --help`, `swarm audit --diff-stdin` rendering the advisory report; `npm link` needs
global perms unavailable in this sandbox, so the CLI was exercised via `node dist/src/cli.js`,
and `swarm audit --pr` was exercised dozens of times in Phases 3-4). README corrections: the
stale "proofs stay Node-only" claim fixed (test-tamper is polyglot, proven live); the GitHub
Action example fixed (the invalid `mode`/`detectors` inputs removed, advisory-default stated,
`docs/attestation.md` linked); the "27 maintainer-flagged" made precise (loose 27 / strict 7,
linked to the audit); the Hunt 7 false-positive class added to limitations. `docs/CLAIMS.md`
maps every publishable claim to its evidence artifact and regenerating script.

## Phase 6: close-out hygiene

Tree clean except the pre-existing untracked `social-posts-behavioral-cheats.md`. Every
artifact committed; prior evidence directories present (reach, endgame, intake-rewire,
soundness, mining-verification; hunts 2, 3, 5, 6, 7; corpus v1, v2, v3). Final gates green:
**2263 passing / 41 pending / 0 failing**, typecheck OK, LOC 47358/47358. `docs/READINESS.md`
refreshed: item 3 (pipeline reach grew, proven end-to-end), item 4 (v3 strata, Hunt 7), item
6 (polyglot-reach blocker closed; new rows for the gate false-positive class and the pytest
provisioning-install carry-over).

## Spend

| phase | usd | detail |
|---|---|---|
| all | **0.00** | no `--enable-llm-judge`, no arbiter annotation; every audit ran deterministic. GitHub API + clones only. |

Under the $5.00 cap. The Phase 2 census used a read-only subagent for the multi-file
enumeration (orchestration, not audit-model spend).

## Deviations (numbered)

1. **LOC budget ratcheted** 47282 → 47321 (`layerHasWork`) → 47358 (`isClosureAnalyzable`).
   Size ratchets for new capability, exact counts committed; no soundness-bar change.
2. **A second wall (closure refuter) surfaced during Phase 3, not the static census.** It
   only manifests at runtime (`repoRoot` threaded). Recorded, fixed, census amended (A2).
3. **The reach tautology fixtures are not detector-detectable**, so the live-path proof uses
   assertion-deletion fixtures; the reach engine-validation fixtures are left intact.
4. **jeduden proved but is a false-positive-for-cheat.** Root-caused, recorded as the gate's
   one false-positive class (coverage-moving refactors), not built (unbounded fix).
   Stop-the-line honesty applied: no wild-cheat-caught claim; designated clean
   controls/fixtures all held.
5. **pytest provisioning-install carry-over unfixed.** The sandbox installs pytest into a
   `.venv` but the run uses ambient `python3 -m pytest`; works where a system pytest exists
   (as here), not on a clean sandbox. Go has no such gap.
6. **Private GitHub fixture repos created** (`moonrunnerkc/swarm-eg-fixture-py`, `-go`) for
   the live-path proof, with the user's explicit approval. Private and deletable; the raw
   audit outputs are committed so the verdicts stand without the repos.
7. **`npm link` needs global perms** unavailable in this sandbox; the CLI was verified via
   `node dist/src/cli.js` (functionally identical). The README command is correct for a
   normal environment.
8. **Commit `aceb3362`'s message contains one em dash.** Not amended: rewriting committed
   history is a halt condition, and the violation is a message, not tree content. Recorded
   here; every other commit message and all authored docs are em-dash-free.
9. **Go installed user-local** (`~/go-toolchain`, carried from the reach run) so the go-test
   runner executes; reversible, no sudo.
