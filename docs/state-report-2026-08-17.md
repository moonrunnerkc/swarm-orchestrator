# Swarm Orchestrator v13: state of the system

- **Branch:** `crossfire-h3`
- **HEAD:** `1303aa2c566c6a676dbd4577406407c5c1ce54ff` ("Scope the scrub property test to its own artifacts", 2026-08-17 21:28:57 -0600, moonrunnerkc)
- **Package:** `swarm-orchestrator@13.0.0` (`package.json` lines 2-3)
- **Report date:** 2026-08-17
- **Working tree at report time:** clean (`git status --short` empty)

Every status claim below names a file, a commit, or a command and its output. Where the repo does not establish a fact, it is listed under [Not verifiable from repo](#not-verifiable-from-repo).

---

## 1. Repo state

### Current branch and tips

| Ref | Commit | Subject | Date |
|---|---|---|---|
| `HEAD` (`crossfire-h3`) | `1303aa2c566c6a676dbd4577406407c5c1ce54ff` | Scope the scrub property test to its own artifacts | 2026-08-17 21:28:57 -0600 |
| `v13-main` and `origin/v13-main` | `d2aa3722cd2da8ccdb3ccdf4b24c776e4323e532` | Declare the Node version the coverage cycle actually needs | 2026-08-17 15:41:01 -0600 |
| `main` and `origin/main` | `b2b681ff529929d39a14c0541d0e2b71b642b5da` | chore(ci): bump LOC budget to cover the multi-ecosystem execution seam | 2026-07-26 22:54:01 -0600 |

`v13-main` is an ancestor of `HEAD`. Seven commits sit on `crossfire-h3` that are not on `v13-main`:

```
1303aa2c Scope the scrub property test to its own artifacts
a098f55a Fuzz the ratchet's measurement layer, the diff reader, and bundle reading
da7b9794 Judge a value by the name that introduced it, and read a payload once
6a24c2e3 Record what has been examined here, and what has not
7324f0fa Carry the fuzz corpus between runs instead of rediscovering it
999634d5 Fuzz the secret detector and the claim predicate parser
7343ccf2 crossfire round 1: 1 confirmed, 1 closed, tests pass
```

`main` and `v13-main` have no merge-base (`git merge-base main v13-main` printed nothing; `git log --ancestry-path main..v13-main` counted 0). They are unrelated histories. `v12-final` is not an ancestor of `v13-main`. `v13` seed commit `7caa6943` is not on `main`.

### Default-branch repoint

It has not happened.

- `git remote show origin` reports `HEAD branch: main`.
- `main` at `b2b681ff` is `swarm-orchestrator@12.1.1` with bins `swarm`, `swarm-audit`, `swarm-orchestrator` (`git show main:package.json`).
- `docs/build-guide.md` section 5.1 (line 125) states the decision: v13 keeps the name, takes major 13, ships one binary, and "Before the default branch becomes v13, tag the last v12 commit so section 3.10's design inputs stay reachable."
- Local annotated tag `v12-final` exists and peels to `b2b681ff` (same commit as `main`). Message: "Last commit of the v12 auditor, kept reachable for the design inputs v13 phase 3 reads."
- That tag is **not** on `origin` (`git ls-remote --tags origin` has no `v12-final`).

So the last v12 commit is tagged locally. The remote default branch is still the v12 auditor.

### Tags

**Local tags** (`git tag -l`): `phase-5-complete`, `phase-6-complete`, `pre-cleanup-v8.0.3`, `schema-v1`, `v10.0.0` through `v12.1.1`, `v12-final`, `v2.0.1` through `v9.0.0`, plus advisory and archive tags.

**Local and not on remote** (`comm` of local tags vs `git ls-remote --tags origin`):

| Tag | Type | Peeled commit | Lineage |
|---|---|---|---|
| `phase-5-complete` | lightweight | `d237e740` "chore(phase-5): recalibrate LOC ceiling to measured floor" | `main` (v12), not v13 |
| `phase-6-complete` | annotated | `7a9d0be3` "Phase 6 (v6 deletion) complete" | `main` (v12), not v13 |
| `schema-v1` | annotated | `79c9c856` "Schema v1 commit" | neither `main` nor `v13-main` |
| `v12-final` | annotated | `b2b681ff` (current `main`) | `main` (v12), not v13 |

There is no `v13.0.0` tag locally or on the remote. Remote tags otherwise match the published v2 through v12.1.1 set. No remote tags are missing locally.

These phase-complete tags name **v12 auditor** milestones. They are not v13 phase gates.

### Package identity and Node version

From `package.json`:

```
name: swarm-orchestrator
version: 13.0.0
private: true
bin.swarm: src/cli.ts
engines.node: >=24.0.0
```

`.nvmrc` contains `24`.

The code's actual floor is Node 24 because the coverage cycle and the base-control arm spawn `node --test --test-isolation=process`. Node 22 rejects that flag. Stated in:

- `package.json` lines 8-10
- `docs/build-guide.md` line 83
- `CLAUDE.md` line 46
- commit `d2aa3722` (changed `.nvmrc` from `22` to `24`, and `engines.node` with it). Commit body: verified on Node 22.22.3 (15 failures) and Node 24.15.0 (those files pass). "23.x was not available to test; 24.15.0 is the version confirmed to work."

This report's commands ran on **Node v24.15.0** (`node -v`).

`tsconfig.json` targets `es2024`, `module: nodenext`, `strict: true`, `noEmit: true`.

Remote: `origin` is `https://github.com/moonrunnerkc/swarm-orchestrator`. Tracked remotes: `main`, `v13-main`, `crossfire-fuzz-02`, `dogfood/tamper-demo`.

---

## 2. Roadmap source of truth

The only v13 roadmap in the tree is `docs/build-guide.md` (163 lines). Section 6 (lines 127-137) is the implementation sequence. The opening sentence names "the companion prompts file"; that file is not in the repository.

Other markdown in the tree is not a phase plan: `CLAUDE.md` / `AGENTS.md` (invariants and architecture map), `docs/security-coverage.md` (what was scanned), `fuzz/README.md`, `redteam/**/*.md` (loop contract).

There is no README, no LICENSE, no `action.yml`.

### Phases as stated in `docs/build-guide.md`

| Phase | Stated scope (one line) | Path |
|---|---|---|
| 0 | Scaffold: repo, strict TS, Biome, Vitest, CI, CLAUDE.md, empty module boundaries. Gate: all gates green on empty project. | `docs/build-guide.md:131` |
| 1 | An agent that codes: provider layer (frontier, one local via OpenAI-compat, fixture provider), tool layer with chokepoint stub, core loop, minimal TUI. Gate: loop/termination/sandbox tests against the fixture provider, and a real small task completes in a scratch repo. | `docs/build-guide.md:132` |
| 2 | Evidence: ledger, blobs, provenance tags, DAG, bundle export, embedded verifier, HTML review page, replay command. Gate: bundle verifies without v13 installed; tamper fails; false and missing-record claims render UNVERIFIED. | `docs/build-guide.md:133` |
| 3 | Gates and auto-resolve: engine, numeric ratchet, slop detectors, diff budget, escalation. Gate: injected failing test auto-resolves within cap; oscillation escalates; deleting failing tests is rejected. | `docs/build-guide.md:134` |
| 4 | Hardware fit: probe, shortlist fetch, static recommendation with reasoning shown. Gate: sensible recommendations on at least three real hardware profiles. | `docs/build-guide.md:135` |
| 5 | Calibration and routing: micro-eval harness, calibration bundle, reward logging, bandit activation threshold. Gate: distribution-aware report; disagreement with the static pick is explained by measurements. | `docs/build-guide.md:136` |
| 6 | Optional scale-out: git-worktree workers, sequential merge queue, and bundle-format alignment with prEN 18229-1 / ISO 24970 once those standards finalize. Gate: two parallel tasks land without conflict corruption; deferred without guilt if single-agent serves. | `docs/build-guide.md:137` |

The document ends at section 7.1 (accepted residuals). There is no Phase 7 and no Phase 8 in this file.

### Numbering map (docs vs this query vs v12 tags)

| Name in this query / elsewhere | What this repo's v13 docs call it | What the v12 lineage used the same number for |
|---|---|---|
| Phases 0-6 | Same numbers, coding-agent sequence in `docs/build-guide.md` section 6 | Different product. Local tags `phase-5-complete` / `phase-6-complete` are v12 auditor milestones on `main`. |
| Phase 7 | Not in v13 docs | v8/v12 commits on `main` (personas, obligations, dashboard). Not this tree's code. |
| Phase 8.1 / 8.2 (sealed criteria, falsification bonds, competency-table router, and the rest named below) | **Not in any v13 doc.** Closest shipped work is Phases 2-5 under other names. | Not found on `v13-main` or `crossfire-h3`. |

---

## 3. Phase-by-phase completion map

Status key: **implemented** means code and a test that exercises it exist. **partial** lists what is present and what is not. **not started** means no implementation under that name.

### Phase 0, scaffold: implemented

Present: `package.json`, `tsconfig.json`, `biome.json`, `.nvmrc`, `.github/workflows/gates.yml`, `CLAUDE.md`, `AGENTS.md`, eight module directories under `src/`.

Tests: the suite itself. CI workflow runs `npm ci` then `npm run gates` on `push` (`.github/workflows/gates.yml` lines 1-22), Node version from `.nvmrc`.

Seed commit: `7caa6943` "Seed v13 repo with project docs and ignore rules".

### Phase 1, an agent that codes: implemented (one phase-gate item not recorded)

| Piece | Code | Tests |
|---|---|---|
| Core loop | `src/core/loop.ts` | `src/core/loop.test.ts` (9 tests) |
| Termination | `src/core/termination.ts` | `src/core/termination.test.ts` (3) |
| Fixture provider | `src/providers/fixture-provider.ts` | `src/providers/fixture-provider.test.ts` (6) |
| Frontier + local + fixture registry | `src/providers/registry.ts`, `ai-sdk-model-client.ts`, `local-discovery.ts` | `registry.test.ts`, `ai-sdk-model-client.test.ts`, `local-discovery.test.ts` |
| Chokepoint + sandbox + tools | `src/tools/chokepoint.ts`, `sandbox.ts`, `file-tools.ts`, `shell-tool.ts`, `search-tool.ts` | `chokepoint.test.ts` (21), `sandbox.test.ts` (25) |
| TUI + plain fallback | `src/tui/screen.ts`, `plain-lines.ts`, `session-view.ts` | `session-view.test.ts` (13) |
| CLI + one-task entry | `src/cli.ts`, `src/agent-run.ts` | `cli-options.test.ts` (37), `agent-run.test.ts` (6) |

`src/core` has no `Date.now`, `Math.random`, or `process.env` reads (only the comment in `src/core/random-source.ts:1`). AI SDK imports are confined to `src/providers/` (`rg` of `from "ai"` / `@ai-sdk` outside that directory: none).

Phase-gate "loop, termination, and sandbox tests pass against the fixture provider": held in this run (those files passed).

Phase-gate "a real small task completes end to end in a scratch repo": **not verifiable from repo**. `npm run dev` points at `.swarm/dev-workspace` (`package.json` line 18). No recorded transcript, bundle, or log of a live model completing a scratch-repo task is committed. `src/agent-run.test.ts` drives the path with fixtures, not a live model.

The build-guide Phase 1 text still says "chokepoint stub". The stub was replaced in `25998bd9` "Replace the chokepoint stub with one that records evidence". The code is the real chokepoint (`src/tools/chokepoint.ts`), tested.

### Phase 2, evidence: implemented

| Piece | Code | Tests |
|---|---|---|
| Append-only ledger, hash chain | `src/evidence/ledger.ts` | `ledger.test.ts` (10) |
| Content-addressed blobs | `src/evidence/blob-store.ts` | `blob-store.test.ts` (3) |
| Claims / predicates | `src/evidence/claim.ts`, `predicate.ts` | `claim.test.ts` (17), `predicate.test.ts` (10) |
| DAG | `src/evidence/dag.ts` | `dag.test.ts` (5) |
| Bundle + embedded verifier + HTML page | `src/evidence/bundle.ts`, `verifier/verify.mjs`, `review-page.ts` | `bundle.test.ts` (13), `verifier-parity.test.ts` (7) |
| Replay | `src/evidence/replay.ts` | `replay.test.ts` (4) |
| Signing | `src/evidence/signing.ts` | `signing.test.ts` (9) |
| Session store outside workspace | `src/evidence/session.ts` (`defaultSessionRoot` joins `~/.swarm/sessions`) | `session.test.ts` (6) |

`calibrate.test.ts` line 249: "exports a bundle whose own verifier passes with nothing installed" (passed in this run).

Phase-gate items about tamper and UNVERIFIED claims are exercised in `bundle.test.ts`, `claim.test.ts`, and `redteam-adversarial.test.ts`. A bundle verified on a machine that does not have this repo cloned is **not verifiable from repo** (no such machine-side artifact is committed).

### Phase 3, gates and auto-resolve: implemented

| Piece | Code | Tests |
|---|---|---|
| Gate definitions as data | `src/gates/gate-definition.ts`, `default-gates.ts` | `project-type.test.ts` (19) |
| Engine / runner | `src/gates/engine.ts`, `gate-runner.ts` | `auto-resolve.test.ts` (20) |
| Numeric ratchet | `src/gates/ratchet.ts`, `measures.ts`, `measure-snapshot.ts` | `ratchet.test.ts` (16), `measures.test.ts` (18) |
| Coverage artifact (lcov, harness-built argv) | `src/gates/coverage-artifact.ts`, `node-test-command.ts` | `coverage-artifact.test.ts` (11), `node-test-command.test.ts` (12) |
| File-set + placeholders + secret scan | `src/gates/file-set.ts`, `inspection-gates.ts` | `file-set.test.ts` (13), `inspection-gates.test.ts` (24) |
| Escalation (to a human) | `src/gates/escalation.ts` | `acceptance.test.ts` line 208 |
| Corpus replay of v12 diffs | `src/gates/corpus-replay.test.ts` | 3 tests, ran this session (not skipped) |

Phase-gate cases live in `src/gates/acceptance.test.ts` and passed here:

- injected failing test auto-resolves and leaves attempt history in the bundle (line 161)
- oscillation / regressions restore and stop at the cap (line 208)
- deleting failing tests is rejected by the numeric ratchet (line 261)
- coverage numeric rejects a green-looking cheat (line 380)

`benchmarks/falsification-corpus/` is not in this tree. `corpus-replay.test.ts` lines 47-52 extract it with `git archive main`. Locally that succeeded (file reported 3 passed, 642-663 ms, not skipped).

prEN / ISO alignment named in the Phase 6 line is not implemented in `src/` (only mentioned in `docs/build-guide.md` lines 13 and 137).

### Phase 4, hardware fit: implemented in code and synthetic tests; live-profile gate not recorded

| Piece | Code | Tests |
|---|---|---|
| Hardware probe | `src/select/hardware-probe.ts` | `hardware-probe.test.ts` (13), mocked `runCommand` |
| Shortlist fetch + bundled snapshot | `src/select/shortlist-source.ts`, `coding-models.v1.json` | `shortlist-source.test.ts` (9), `shortlist.test.ts` (13) |
| Static recommendation | `src/select/recommendation.ts` | `recommendation.test.ts` (25): consumer GPU, Apple Silicon, low-memory, unknown VRAM |
| Printed install/serve commands | `src/select/select-report.ts`, `backend-command.ts` | `select-report.test.ts` (18), `backend-command.test.ts` (3) |

The phase gate asks for "sensible recommendations on at least three real hardware profiles." The tests use synthetic profiles (for example RTX 4090, Apple Silicon 32 GB, 8 GB no GPU in `recommendation.test.ts`). No committed probe output from three physical machines was found.

`swarm select` can probe the current machine at runtime (`src/cli.ts` imports `probeHardware` and `systemProbeEnvironment`). No captured live `select` report is in the tree.

### Phase 5, calibration and routing: implemented against fixtures; no committed live calibration

| Piece | Code | Tests |
|---|---|---|
| Golden set + cases | `src/select/golden-set.ts`, `calibration-cases.v1.json` | `golden-set.test.ts` (12), `calibration-case.test.ts` (8) |
| Micro-eval | `src/select/calibrate.ts`, `calibration-run.ts` | `calibrate.test.ts` (9), fixture models |
| Distribution report | `src/select/calibration-report.ts`, `calibration-summary.ts` | `calibration-report.test.ts` (20), `calibration-summary.test.ts` (7) |
| Reward log | `src/select/reward.ts`, `routing-log.ts` | `reward.test.ts` (16), `routing-log.test.ts` (9) |
| UCB1 + epsilon + threshold | `src/select/ucb.ts` (`minSamples: 20`, `epsilon: 0.1`) | `ucb.test.ts` (14) |

`calibrate.test.ts` asserts the phase gate's report properties (distribution per dimension, pick justified by measurements, agreement reported as corroboration, bundle verifier passes). Those tests use `createFixtureModelClient`, not a local GPU.

Pick/reward files are specified to live under `~/.swarm/routing/` (`pick-store.ts`, `routing-log.ts`). None are committed.

Ledger type `"routing-decision"` is declared in `src/evidence/ledger-record.ts` and is not written by a recorder in `src/` (only the declaration). Routing prints and later writes `reward` records (`src/cli.ts`).

### Phase 6, optional scale-out: partial

**Present and tested:**

- Worktrees: `src/workers/worktree.ts`, `worktree.test.ts` (10)
- Merge queue: `src/workers/merge-queue.ts`, `merge-queue.test.ts` (10)
- Parallel run: `src/workers/parallel-run.ts`, `acceptance.test.ts` (9). Header (lines 23-27) states the phase gate: two workers, real git, real worktrees, real tests, real merge queue.
- Combined bundle: `src/evidence/combined-bundle.ts`, `combined-bundle.test.ts` (6)
- CLI `swarm parallel`: `src/cli-options.ts` lines 57-69

`src/agent-run.ts` does not import `src/workers`. `src/cli.ts` lines 77-78 import workers only for the `parallel` command. That matches `CLAUDE.md` line 25: workers are not on the single-agent path.

**Not present:**

- Bundle-format alignment with prEN 18229-1 / ISO 24970. Named as deferred until those standards finalize (`docs/build-guide.md:137`). No schema fields or exporter for those formats in `src/`.

Phase-gate "two parallel tasks land without conflict corruption": held by `workers/acceptance.test.ts` in this run.

### Phase 7: not started (not in the v13 roadmap)

No Phase 7 section, module, or commit on the v13 lineage.

### Phase 8: not started (not in the v13 roadmap)

The features named as 8.1 and 8.2 in the request do not appear as identifiers, modules, or doc headings in this tree. Nearby earlier-phase work is listed so it is not mistaken for them.

#### 8.1 Sealed criteria, falsification bonds, re-derivation

| Named piece | Status | Where the code lives | Tests | End-to-end artifact |
|---|---|---|---|---|
| Sealed criteria (criteria authored by a separate model before the editor sees the repo) | **not started** | No criteria-authoring role, no pre-edit criteria record. Closest: the same agent declares a file set via `declare_file_set` (`src/gates/file-set-tool.ts`). Ledger "sealed" means fail-closed after a failed append (`src/evidence/ledger.ts` lines 79-103). | `file-set.test.ts`, `ledger.test.ts` exercise those other meanings | No sealed-criteria record |
| Falsification bonds | **not started** | No bond type. Closest: static replay of v12 synthetic diffs in `src/gates/corpus-replay.test.ts` (section 3.10 input 4). That is a fixture suite, not a bond a model posts against a verdict. | `corpus-replay.test.ts` (ran locally this session) | No bond record. Corpus itself is not in this tree; it is archived from `main`. |
| Re-derivation (verdicts exported as re-executable derivations, verifiable in a clean container) | **not started** | No derivation-bundle format, no Dockerfile, no container verifier. What exists: transcript replay (`src/evidence/replay.ts`, "no network, no model rerun"), embedded Node verifier (`src/evidence/verifier/verify.mjs`), and a comment that a reviewer can recompute calibration numbers from ledger rows (`src/select/calibration-run.ts` lines 76-79). `src/tools/derivation.ts` is the section 3.4 injection heuristic. | `replay.test.ts`, `bundle.test.ts`, `derivation.test.ts` | No derivation bundle |

None of these three has a committed run artifact of the kind the request asked for.

#### 8.2 Competency-table router and related routing

| Named piece | Status | Where the code lives | Tests | End-to-end artifact |
|---|---|---|---|---|
| Competency-table router | **not started** | No competency table. Router is UCB1 + 10% epsilon + 20-sample threshold per task class (`src/select/ucb.ts` lines 19-23, 56-59). | `ucb.test.ts` (14) | No competency table. Runtime reward log is specified under `~/.swarm/routing/`, not committed. |
| Calibration data from real hardware | **not started** as a dataset. Phase 5 harness exists. | `src/select/calibrate.ts`, `hardware-probe.ts`. Tests mock the probe and use fixture models. | `calibrate.test.ts`, `hardware-probe.test.ts` | No committed live calibration report |
| Cache-aware switch-cost logic | **not started** | No `switchCost` / cache-aware identifier. "prompt cache" appears only as a rapid-mlx property in `docs/build-guide.md:100`. Reward uses gate outcome, attempts, latency, optional USD (`src/select/reward.ts`). | none for switch cost | none |
| Per-role model assignment | **not started** | One `ModelClient` for the loop (`src/core/loop.ts`). `role` in code is chat role. Task *class* (edit / multi-file / test-fix / tool-heavy) is keyword routing (`src/select/task-class.ts`), not planner/editor/reviewer models. | `task-class.test.ts` (9) | none |
| Mid-run escalation (to another model) | **not started** | Gate escalation is to a human after the attempt cap (`src/gates/escalation.ts` lines 3-6, 33-38). Provider failure retries the same model then stops (`src/core/loop.test.ts`). Registry refuses a silent local fallback (`src/providers/registry.test.ts` "refuses a local model with no endpoint rather than guessing a port"). Build guide section 4.3 (`docs/build-guide.md:112`) still describes a configured fallback model; that path is not implemented. | `auto-resolve.test.ts`, `acceptance.test.ts`, `registry.test.ts` | none |
| Pull offers for uninstalled candidates | **not started** as a router offer | `swarm select` prints `ollama pull {model}` / `rapid-mlx pull {model}` (`src/select/select-report.ts` lines 105-114, `coding-models.v1.json`). Local discovery lists models a running server already serves (`src/providers/local-discovery.ts`). No mid-run "this candidate is not installed, pull it?" path. | `select-report.test.ts` line 68, `backend-command.test.ts` | none |

---

## 4. Red-team loop state

### Lap count

| State directory | Laps on disk | Last decision | What it is |
|---|---|---|---|
| `redteam/loop/state/` | **1** | WAKE-HUMAN | Default live driver state |
| `redteam/loop/state-dryrun/` | 2 | CONVERGED | `--dry-run` fixture replay |
| `redteam/loop/state-wake/` | 2 | WAKE-HUMAN | Fixture path that removes R2 (not applied to this tree) |

`highestLapInState()` in `redteam/loop/driver.mjs` lines 345-353 counts `lap-<n>-(attacker|fixer).jsonl`. Default state highest lap is 1. The next live driver start would be lap 2.

Live lap 1 (`redteam/loop/state/summary.md`):

```
## lap 1 (2026-08-15T01:33:11.694Z)
- items fixed: none (no fix pass this lap)
- successes by severity: trust-root=9 mechanical=2 doc=1
- residual set: baseline: C4, C7, R1, R2, R3, R4
- gates: pass (872 tests passed)
- decision: WAKE-HUMAN
- because: attacker succeeded at trust-root severity: A1, A2, A3, A8, E1, E2, E3, E6, E8
```

`redteam/loop/state/lap-1-fixer.jsonl` is empty (0 bytes). `lap-1-attacker.jsonl` has 34 rows: 12 succeeded, 16 caught, 6 residual-holds (C4, C7, R1-R4).

### Driver

`redteam/loop/driver.mjs`: one lap is fixer (Claude) on base if prior successes exist, `npm run gates`, commit, cut `redteam/loop/lap-<n>`, attacker (Grok) on a throwaway, commit findings on whatever branch HEAD actually is, return to base, route in `evaluate.mjs`. It never merges a throwaway and never applies attacker tests to base (file header lines 9-14).

Defaults (`driver.mjs` lines 70-91, 185-186): `--max-laps 3`, state `redteam/loop/state` (or `state-dryrun` under `--dry-run`), fixer `claude`, attacker `grok`. Exit 0 converged, 1 driver error, 2 wake human, 3 laps exhausted.

### Work after lap 1 that is not a recorded lap

The live `state/` directory was not appended after lap 1. Later attacker work exists as branches and pass directories:

| Ref / path | Evidence |
|---|---|
| `redteam/loop/lap-1` | `635140f4` empty throwaway / gates baseline |
| `redteam/loop/lap-1-attack` | `cdbe9651` attacker findings |
| `loop/shakedown` | `fd81acac` "Close the two new scrub gaps instead of documenting them" |
| `redteam/loop/lap-2-attack` | `dd92b033` "red-team lap 2: argv spawn and scrubbed-env findings" (adds `redteam/pass7/`) |
| `5b240076` | "red-team loop lap 2: attacker probes, closures, and golden cases" (adds `redteam/pass6/`) |

Those commits did not write `redteam/loop/state/lap-2-*.jsonl`. Treating "lap 2" as a completed driver lap is not supported by the live state directory.

`state-wake` lap 2 claims R2 removed and a fixer revert of `9b2a0945`. That is fixture output. Current `docs/build-guide.md` section 7.1 and `redteam-adversarial.test.ts` still treat the constant-return stub as a residual.

`redteam/leep/` is an empty directory. There is no `redteam/pass5/` on this tree (lap-1 rows cite `redteam/pass5/closures.regression.ts`).

### Open vs closed findings (live lap 1 vs current tree)

Lap-1 succeeded rows that later commits closed at the harness (current suite asserts the closure, not the hole): A1/A3 suffix collision, A2 hit-only lcov, A8 quoted isolation, E1-E3 printed FAIL lines, E4 destination collision, E6 TAP-in-spec, E8 TS2305 as load error, M1 lookalike TODO, D2 array-join wording. Evidence: subsequent v13-main commits (`82e5d7e5`, `4389dc76`, `46d8f796`, `fa156547`, `07c8e624`, and others in `git log 635140f4..v13-main`) plus `src/evidence/redteam-adversarial.test.ts` and `src/gates/*` tests that passed in this run.

Lap-1 residual-holds C4 (Cyrillic `password`) and C7 (array of wrappers under a credential name) are **closed on this tree**, not residuals:

- `src/evidence/redteam-adversarial.test.ts` lines 1095-1114
- `docs/build-guide.md` line 149: "the fourth pass found two more candidates and both were closed at the root"

The four judge-shaped residuals remain open (next subsection).

`docs/security-coverage.md` carries a separate open set (scrub disagreements, ReDoS test gaps, unbuilt-then-built fuzz targets). That is CROSSFIRE/fuzz work, not the loop ledger. See section 5.

### Four judge-shaped residual gaps

Canonical list: `docs/build-guide.md` section 7.1 (lines 147-159). The suite is required to **assert the gap**. Widening a check until one turns green is documented as a regression (`redteam-adversarial.test.ts` lines 50-53).

| Gap (query name) | Doc name | Status | Evidence |
|---|---|---|---|
| Non-constant cross-line tautology | "Meaning-gutting test rewrites over non-constant expressions" | **Open** for `expect(v0.a).toBe(v0.a)`. **Closed** for the constant/cross-line cousin (`expect(true)` / `.toBe(true)` on the next line). | Open: `redteam-adversarial.test.ts` line 440, expects the rewrite accepted and 3 assertions. Closed cousin: `src/gates/measures.ts` lines 43-52, `measures.test.ts` lines 74-89, `redteam-adversarial.test.ts` "counts no assertion in a tautology whose matcher sits on the next line". Pass-7 lock: `redteam/pass7/closures.regression.ts` lines 489-494. |
| Constant-return stub | "The constant-return stub" | **Open** | `docs/build-guide.md:153`. `redteam-adversarial.test.ts` line 582: `return 0` and `return ''` leave the placeholder gate passed. Pass-7 lines 497-523. `state-wake` "removed R2" is fixture only. |
| Split-and-rejoined secret across non-credential-named fields | "A secret split across fields nobody named as a credential" | **Open** for `{firstHalf, secondHalf}` / ordinary-name pieces. **Closed** for lookalike names and wrapped arrays under a credential name. Companion remainder: multi-line assignment in non-JSON text (`docs/build-guide.md:157`). | Open: `redteam-adversarial.test.ts` lines 1116-1129, `scrub.ts` lines 568-573. Closed cousins: lines 1095-1114. Pass-7 "still misses a secret split across unnamed fields". |
| Rephrased-shell derivation miss | "The rephrased shell command the derivation heuristic misses" | **Open** for flag insertion plus `sh`→`bash` (and the env-prefix framing). Interpreter swap alone on a flagged command is caught. | Open: `redteam-adversarial.test.ts` lines 777-803. Boundary: `src/tools/derivation.test.ts` lines 102-119. Invariant 5 in `CLAUDE.md` names this a heuristic, not a guarantee. |

All four are still listed in the live lap-1 residual set as R1-R4. After C4/C7 closed, the current documented set is those four only.

---

## 5. Verification infrastructure

### Fuzz harnesses present

Eight Jazzer.js harnesses (`ls fuzz/*.fuzz.cjs`):

| Harness | Corpus seeds (smoke output) |
|---|---|
| `adapter-output` | 9 |
| `bundle-read` | 6 |
| `gate-parsers` | 12 |
| `ledger-chain` | 7 |
| `predicate` | 15 |
| `scrub` | 14 |
| `swarm-toml` | 9 |
| `unified-diff` | 12 |

`fuzz/README.md` still describes only three (`adapter-output`, `ledger-chain`, `swarm-toml`).

### `fuzz:build` and smoke, this session

Command: `npm run fuzz:build` on Node v24.15.0. Exit 0.

```
> swarm-orchestrator@13.0.0 fuzz:build
> rm -rf .swarm/fuzz-build && tsc -p fuzz/tsconfig.build.json && node fuzz/smoke.mjs

fuzz/smoke: adapter-output ran 9 seed(s)
fuzz/smoke: bundle-read ran 6 seed(s)
fuzz/smoke: gate-parsers ran 12 seed(s)
fuzz/smoke: ledger-chain ran 7 seed(s)
fuzz/smoke: predicate ran 15 seed(s)
fuzz/smoke: scrub ran 14 seed(s)
fuzz/smoke: swarm-toml ran 9 seed(s)
fuzz/smoke: unified-diff ran 12 seed(s)
```

Smoke does not replay `fuzz/findings/*.input` (`fuzz/findings/README.md` lines 8-10: a known-failing input in the corpus would keep `fuzz:build` red).

### Scrubber and regex-safety

**Scrubber** (`src/evidence/scrub.ts`, tests `scrub.test.ts` 37 tests, plus residual cases in `redteam-adversarial.test.ts`):

- Floor is `shortestCredential = 4` (`scrub.ts` lines 167-188). Comment at 182-186 states the previous eight-character floor let `hunter2` through. Tests at `scrub.test.ts` lines 401-425 redact `pw12`, `s3cr3t`, `hunter2`, `hunter22` under `password`, leave `"pw"` (length 2), and still do not *block* on opaque `hunter2`.
- One detector, three sites: write-time, export scan, secret-scan gate (invariant 9; structural walk of JSON).
- Lookalike fold: `src/evidence/latin-lookalikes.ts`, tested at `scrub.test.ts` line 249 and `redteam-adversarial.test.ts` line 1095.

**Regex safety** (`src/tools/regex-safety.ts`, `regex-safety.test.ts` 43 tests):

- Refuses nested quantifiers, competing quantifiers, and the grouped spelling `(a+)(a+)$` (lines 101-111).
- `a+a+$` is in the catastrophic list (line 39), so ReDoS fix (1) from `docs/security-coverage.md` now has a regression test.
- No test in `regex-safety.test.ts` names octal `\141` or a 256-code-unit probe. ReDoS fix (3) in the security doc remains without a dedicated test in that file.

### `docs/security-coverage.md` vs this tree

The file was added in `6a24c2e3` (2026-08-17 19:46:22 -0600). Two later commits on this branch changed the facts it records:

| Claim in `docs/security-coverage.md` | Current tree |
|---|---|
| Five harnesses; `parsers.ts`, `unified-diff.ts`, `readBundle` "not built" (lines 87-104, 326) | Eight harnesses. `gate-parsers`, `unified-diff`, `bundle-read` added in `a098f55a` (after the doc). |
| `classifyValue` drops values under 8 characters; `hunter2` leaks (lines 179-190) | Floor is 4 (`da7b9794`, after the doc). `hunter2` is redacted under a credential name (`scrub.test.ts:403`). `"pw"` still leaks. |
| ReDoS fixes (1) and (3) shipped with no regression test (lines 169-173, 325) | (1) `a+a+$` is tested. (3) octal/256 still has no dedicated test found. |
| One scrub fuzz finding, `scrub-nested-multibyte-key.input` (lines 204-221) | That file is still in `fuzz/findings/` and still described in `fuzz/findings/README.md`. Four additional `.input` files exist (`scrub-dispatch-flip`, `scrub-marker-in-key`, `scrub-name-separator`, `scrub-overlapping-spans`) from `999634d5` / `da7b9794`. Only the nested-multibyte case is documented in the findings README. Whether the other four still fail was not replayed in this session. |
| Corpus-replay never ran in CI; `git archive main` fails when only `origin/main` exists (lines 327-331) | Locally the suite ran. CI workflow now uses `fetch-depth: 0` (`.github/workflows/gates.yml` lines 14-16). Whether GitHub Actions has ever executed the corpus cases is not recorded in this repo. |
| `@types/node` 22.20.1 vs 26.2.0 (lines 80, 223-225) | `package.json` still has `"@types/node": "^22.20.1"`. Still true. |
| No scheduled re-scan (lines 321-324) | Still no scheduled workflow beyond `gates.yml` on push. |

The security doc is a snapshot of the tree at `6a24c2e3`. It has drifted on harness count, the short-credential floor, and the "three unbuilt boundaries" list.

---

## 6. Test and gate state

Ran on Node v24.15.0, 2026-08-18T04:03:21Z (22:03 local, 2026-08-17).

### `npm test`

```
Test Files  81 passed (81)
     Tests  984 passed (984)
  Duration  8.70s
```

No failures. One expected stderr line from `ai-sdk-model-client.test.ts` ("the runtime dropped the connection") while that test still passed.

81 test files: 80 under `src/` plus `redteam/loop/evaluate.test.mjs` (47 tests).

### `npm run gates`

```
> npm run typecheck && npm run lint && npm test
> tsc --noEmit
> biome check
Checked 198 files in 55ms. No fixes applied.
Test Files  81 passed (81)
     Tests  984 passed (984)
```

Exit 0. Typecheck produced no output. Lint applied no fixes.

### Coverage artifact from this suite

`npm test` is `vitest run`. There is no root `vitest.config.*`. After the run: no `coverage/`, no `.nyc_output/`, no `*.lcov` in the repo root.

The harness writes lcov for **subject** workspaces it measures (`src/gates/coverage-artifact.ts`), outside those workspaces, under the session store. That path is not this repo's own test run. `src/gates/coverage-artifact.test.ts` (11 tests, including a live node-runner case) passed.

### Gate / ratchet state files

None committed. Ratchet decisions are specified as ledger records (`CLAUDE.md` invariant 7). Session ledgers live under `~/.swarm/sessions/<id>/` (`src/evidence/session.ts` line 52-54). This workspace has no committed session ledger.

`.swarm/` is gitignored except `!.swarm/audit-config.yaml`. After `fuzz:build`, `.swarm/fuzz-build/` holds compiled JS. That is a local build product, not a ratchet state file.

`corpus-replay.test.ts` ran (not skipped). Categories the static replay leaves undecided are asserted as a list (`corpus-replay.test.ts` lines 223-232): coverage-erosion, dead-branch-insertion, test-relaxation, no-op-fix, error-swallow, exception-rethrow-lost-context, fake-refactor, mock-of-hallucination.

---

## 7. Unvalidated-items check

| Item | Evidence in repo |
|---|---|
| Calibration validation on real hardware / real local models | None. `src/select/calibrate.test.ts` uses fixture models. No committed calibration report, pick file, or log from a live `swarm calibrate`. |
| Edit-quality benchmarking | None. No bench directory, no result file, no doc of an edit-quality run on this lineage. |
| Real-project shakedown | None. Branch name `loop/shakedown` exists (`fd81acac`) and is a red-team fix branch, not a shakedown report. No shakedown log or result file. |

Search of `*.md`, `*.ts`, `*.json`, `*.jsonl` for `unvalidated`, `edit-quality`, `shakedown`, `calibration.validation`, `real-project` found no result artifacts. `src/tools/tool-definition.ts` uses "unvalidated" only as ordinary prose about schema checks.

---

## 8. Release state

### Packaging

| Item | Value | Source |
|---|---|---|
| Name / version | `swarm-orchestrator` `13.0.0` | `package.json` |
| `private` | `true` | `package.json` line 4. npm will refuse publish. |
| `files` | absent | Default pack set. No publish allowlist. |
| `bin` | `swarm` → `src/cli.ts` | TypeScript source. Node 24 type-stripping (`node --help` lists `--experimental-strip-types`). Shebang `#!/usr/bin/env node`. |
| `main` / `exports` | absent | CLI-only package as declared. |
| README | none | `git ls-tree HEAD` has no README |
| LICENSE | none | same |
| `action.yml` | none | retired per `docs/build-guide.md:125` |
| Publish script | none | `package.json` scripts: typecheck, lint, format, test, gates, dev, fuzz:build |

### Current install path (this checkout)

`package.json` line 18:

```
npm run dev  →  mkdir -p .swarm/dev-workspace && node src/cli.ts --workspace .swarm/dev-workspace
```

That is source execution, not an installed npm package. There is no `dist/`.

Published v12 remains `swarm-orchestrator@12.1.1` on `main` with three bins (`git show main:package.json`). v13 has not taken that name on the registry from this tree.

### Blockers the repo itself records

1. `"private": true` (`package.json:4`).
2. Default branch still `main` (v12). Section 5.1 of the build guide treats the repoint as a precondition, not a done step.
3. No README. Section 5.1 says the README is replaced with the v13 code. It is absent, not replaced.
4. No LICENSE in the v13 tree.
5. `v12-final` exists only locally. Section 3.10 / 5.1 want that tag reachable (`git show v12-final:<path>`). It is not on `origin`.
6. Regulatory claims in `docs/build-guide.md` line 13 are explicitly not to appear in any README or public page until re-verified.
7. `@types/node` still on 22.x while runtime is 24 (`d2aa3722` body: aligning types is a separate upgrade).
8. `docs/security-coverage.md` and `fuzz/README.md` are behind the current harness set (section 5).

No `CHANGELOG` or release checklist file exists on this branch.

---

## 9. Drift and deltas

### `CLAUDE.md` / `AGENTS.md` vs each other

They are different files (different inodes and sizes: 14480 vs 11907 bytes). `diff` shows invariant 7 and invariant 9 in `AGENTS.md` are shorter:

- `AGENTS.md` invariant 7 still describes coverage as "the harness forces process isolation" and does not include the later argv-built-by-the-harness / no-shell / one-section-per-file / skipped-test rules that `CLAUDE.md` and `docs/build-guide.md` section 3.6 state.
- `AGENTS.md` invariant 9 omits lookalike folding of credential names.

`CLAUDE.md` matches the current ratchet and scrub code more closely. `AGENTS.md` is stale relative to both `CLAUDE.md` and the code.

### `CLAUDE.md` invariants vs code

| Invariant | Status against this tree |
|---|---|
| 1 Claims / kinds / UNVERIFIED | Implemented and tested (`claim.test.ts`, `record-kind.test.ts`, `redteam-adversarial.test.ts`). |
| 2 Append-only ledger | Implemented (`ledger.ts`, `ledger.test.ts`). "Sealed" here means fail-closed after a write error, not 8.1 sealed criteria. |
| 3 Chokepoint | Implemented (`chokepoint.ts`, `chokepoint.test.ts`). |
| 4 SHA-256 blobs | Implemented (`blob-store.ts`). |
| 5 Provenance + heuristic derivation | Implemented (`derivation.ts`). Residual R4 is the documented miss. |
| 6 Gates as data | Implemented (`default-gates.ts` comment lines 13-16, `gate-definition.ts`). |
| 7 Numeric ratchet + coverage/control arms | Implemented (`ratchet.ts`, `coverage-artifact.ts`, `base-control.ts`, `node-test-command.ts`) with tests named in section 3. |
| 8 No ambient nondeterminism in `src/core` | Holds (`rg` found only the explanatory comment). Clock/random live at `src/cli.ts` lines 80-93. |
| 9 Known-pattern scrubbing, one detector | Mostly holds. Floor is 4 characters, not "any length." `"pw"` under `password` is still not redacted (`scrub.test.ts:420-424`). Nested multibyte-key disagreement is still an open finding (`fuzz/findings/README.md`). Invariant text does not mention the length floor. |
| 10 Zod at boundaries | Present on config, ledger, bundle, escalation (`swarm-toml.ts`, `ledger-record.ts`, `bundle-manifest.ts`, `escalation.ts`). Completeness of every provider-response path is not independently re-audited here. |
| 11 Session store outside workspace; keychain signing | `defaultSessionRoot` is `~/.swarm/sessions`. Sandbox denial of that path is tested in `sandbox.test.ts`. Live OS keychain use is implemented in `signing.ts`; this session did not run a live keychain export. |
| 12 File-set declaration before edit | Implemented (`file-set.ts`, `file-set-tool.ts`, `file-set.test.ts`). |

No invariant is implemented as the opposite of what `CLAUDE.md` says. Two are narrower than the heading: 9 still has a length floor and a known text/scan disagreement; 5 is a heuristic with a locked residual.

Build-guide section 4.3 still describes mid-task model fallback. The registry test refuses silent fallback. That is doc-vs-code drift in the build guide, not in `CLAUDE.md`.

### Substantial work the roadmap (section 6) does not mention

- Red-team loop (`redteam/loop/driver.mjs`, `evaluate.mjs`) and passes 2, 3, 4, 6, 7.
- Eight fuzz harnesses, smoke, accumulating corpus under `.swarm/fuzz-corpus`.
- `docs/security-coverage.md` and CROSSFIRE findings memory notes.
- Regex-safety reader for model-supplied search patterns (`src/tools/regex-safety.ts`).
- Lookalike folding shared by placeholder gate and scrubber (`src/evidence/latin-lookalikes.ts`).
- Combined worker bundles (`src/evidence/combined-bundle.ts`).
- Pricing table and cost-aware reward (`src/select/pricing.ts`, `task-cost.ts`, `model-pricing.v1.json`).
- `swarm routing` / `swarm calibrate --add-case` CLI commands (`src/cli-options.ts`).
- Adversarial residual suite kept in `src/evidence/redteam-adversarial.test.ts` (49 tests).

Section 7.1 of the build guide *does* mention the five adversarial passes and the four residuals. It does not mention the loop driver, fuzz, or security-coverage scan.

---

## Not verifiable from repo

- Whether a live model has ever completed a Phase 1 scratch-repo task.
- Whether a reviewer has verified an exported bundle on a machine without this repo.
- Recommendations measured on three physical machines (tests use synthetic profiles).
- A calibration run against real local models on real hardware (no committed report).
- Contents of `~/.swarm/sessions/` or `~/.swarm/routing/` on this machine (outside the repo; not inspected for this report).
- Whether GitHub Actions has ever executed `corpus-replay` without skip (no CI log in the tree).
- Whether `origin` default-branch change has been requested or rejected on GitHub beyond `git remote show origin` saying `HEAD branch: main`.
- Whether `swarm-orchestrator@13.0.0` exists on the npm registry (repo only shows `private: true` and no publish config).
- Whether the four extra `fuzz/findings/*.input` files other than `scrub-nested-multibyte-key.input` still crash the current `scrub` harness (not replayed; only the nested-multibyte case is documented).
- Long-run fuzz budgets and coverage-curve numbers in `docs/security-coverage.md` (historical; not re-measured here).
- Semgrep / OSV numbers in that same file (not re-run here).
- Companion prompts file named in `docs/build-guide.md` line 3 (not in the tree).
- EU AI Act / prEN 18229-1 / ISO 24970 current status (build guide says re-verify before any public claim).
- Phase 8 as a numbered plan: not in the repo, so scope, acceptance, and "done" for 8.1/8.2 cannot be checked against an in-repo spec.
- How many live red-team laps a human ran after lap 1 without writing `state/` (pass6/pass7 and `lap-2-attack` exist; they are not driver summary sections).
- `redteam/pass5/` contents (path cited by lap-1 rows; directory absent on this tree).
- Whether `schema-v1` was intended to remain a dangling tag.

---

## Appendix: commands run

```
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git log -1 --format='%H%n%s%n%ci%n%an'
git branch -vv
git remote -v
git rev-parse v13-main main origin/v13-main origin/main
git tag -l
git ls-remote --tags origin
git remote show origin
git log -5 --oneline main
git log -5 --oneline v13-main
git log -8 --oneline HEAD
git merge-base main v13-main
git merge-base --is-ancestor main v13-main
git merge-base --is-ancestor v13-main main
git log -1 --format='%H %s %ci' main
git log -1 --format='%H %s %ci' v13-main
git log -1 --format='%H %s %ci' HEAD
git merge-base --is-ancestor v13-main HEAD
git log --oneline v13-main..HEAD
comm -23 <(git tag -l | sort) <(git ls-remote --tags origin | …)
git show-ref --tags | rg 'phase-|v13|v12-final'
node -v
cat .nvmrc
cat tsconfig.json
git status --short
git log --oneline --left-right main...v13-main
git rev-parse v12-final main
git merge-base --is-ancestor v12-final main
git merge-base --is-ancestor v12-final v13-main
git show main:package.json | head -15
git show v13-main:package.json | head -15
git log --all --oneline --grep='repoint|default.branch|…'
ls -la
find .github -type f
wc -l docs/build-guide.md docs/security-coverage.md CLAUDE.md AGENTS.md
ls README* LICENSE* action.yml
find . -name '*.md' -not -path './node_modules/*' -not -path './.swarm/*'
git log --all --oneline --grep='Phase 7|Phase 8|…'
git for-each-ref --format='…' refs/tags | rg 'phase-|v12-final|schema-v1|v13'
git rev-parse v12-final v12-final^{} phase-6-complete^{} schema-v1^{}
diff -u CLAUDE.md AGENTS.md
git ls-tree -r --name-only HEAD | rg -i 'npmignore|license|readme|files'
rg -n 'publish|private|npm' package.json .gitignore
git log --oneline v13-main --grep='Phase [0-9]|…'
git show --stat dd92b033
git ls-tree -r --name-only dd92b033 | rg 'redteam/loop/state'
rg -n '18229|24970|prEN|ISO' docs src
rg -n 'Date.now|Math.random|process.env' src/core
rg -n "from 'ai'|from '@ai-sdk'" src
node -e '… package.json fields …'
git check-ignore -v .env
rg -n 'coverage|lcov' (repo, excluding node_modules)
find . -name 'vitest.config.*' -not -path './node_modules/*'
git log --oneline v13-main --grep='scratch|end to end|e2e|real task'
find . -iname '*calibrat*' / '*shake*' / '*bench*' / '*edit-quality*'
rg -n -i 'publish|release|private: true|npm pack|not ready' docs CLAUDE.md AGENTS.md package.json
git show --stat --format=… d2aa3722 6a24c2e3 5b240076
git log --oneline 635140f4..v13-main
git log --all --oneline --grep='scratch repo|real small task|dogfood'
git ls-tree -r --name-only 5b240076 | rg 'redteam/loop/state'
rg -n 'from workers' src/agent-run.ts src/cli.ts …
ls fuzz/*.fuzz.cjs fuzz/findings/
node --help | rg strip
git log --oneline -- fuzz/*.fuzz.cjs fuzz/findings/
git log -1 --format=… -- docs/security-coverage.md
git log -1 --format=… da7b9794 a098f55a
find src -name '*.test.ts' | wc -l
ls coverage .nyc_output *.lcov
git ls-tree HEAD | rg 'README|LICENSE'
git show --stat a098f55a 999634d5
rg -n '^\s+it\(' src/gates/acceptance.test.ts src/workers/acceptance.test.ts src/select/calibrate.test.ts
npm test
npm run fuzz:build
npm run gates
```

Plus read-only inspection of the files cited above, and two read-only explore passes over Phase 8 identifiers and `redteam/`.
