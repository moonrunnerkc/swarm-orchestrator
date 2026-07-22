# Patch 12.1.1: HALT, pre-existing regeneration failure of published numbers

Date: 2026-07-22
Baseline HEAD: c1c394e1d3c68316a6e838731d8906f9e0455541 (main, clean tree)
Halt condition invoked: "Any committed-script regeneration of a currently
published number fails BEFORE your change lands."

## What happened

Phase 0 passed fully green (see phase0-baseline.md). Phase 1 (the
builtin-module exemption in mock-of-hallucination) was implemented and
tested. The phase then requires regenerating every report derived from
re-auditable committed outputs via their committed scripts. Running the
committed one-command regenerator surfaced that several published numbers
do not reproduce at the pristine baseline, before any change of mine
lands.

## The repro, at pristine baseline

All Phase 1 edits were stashed; the tree was byte-identical to
c1c394e1. Then:

    npm run build
    node dist/scripts/benchmarks/full.js --no-live

Result (git status afterward, saved with the diffs in the session
scratchpad):

    M benchmarks/oracle-corpus/COVERAGE.md
    M benchmarks/oracle-corpus/evasion-data.csv
    M benchmarks/oracle-corpus/evasion-report.md
    M benchmarks/oracle-corpus/judge-primary-vs-structural.md
    M benchmarks/oracle-corpus/oracle-results.json
    D benchmarks/oracle-corpus/live-path-runs/*.json   (6 files)

A committed script, run with the committed judge cache and `--no-live`,
rewrites five published artifacts and deletes a committed sidecar
directory.

## Root causes (three distinct problems)

### 1. COVERAGE.md is irreproducible under any judge environment

Two independent causes, both provable from committed data alone:

- The "survives cosmetic evasion" column. In the committed
  `evasion-data.csv` at c1c394e1 (md5 42c3502cbdb1e020f6a8b2e819d0f649,
  verified against the git object, not the working copy), every
  category carries depth rows 0 through 4 except cheat-mock-mutation,
  whose behavioral-evader rows extend to depth 6 (landed in commit
  70ce5c4c, "bench(audit): add semantic evasion survival curves").
  `loadEvasionRobust` in `scripts/benchmarks/full.ts` computes one
  global max depth (6, contributed only by cheat-mock-mutation) and
  looks up every category's rate at that depth; the twelve other
  categories have no depth-6 row, so their rates resolve to 0 and the
  column regenerates as "no" for all eleven structural detectors. The
  committed COVERAGE.md says "yes (robust)" for all eleven. The
  committed artifact predates the CSV change and was never
  regenerated. (Correction note, 2026-07-22: the first version of
  this report said "structural rows at depths 0 to 4 and semantic
  rows at depths 0 to 6"; goal-not-fixed in fact stops at depth 4,
  so the raggedness is one category deep, not a structural/semantic
  split. The per-category depth census from the committed object is
  authoritative.)
- The semantic recall rows. Committed COVERAGE.md says goal-not-fixed
  0.68 and cheat-mock-mutation 0.16. Committed `oracle-results.json`,
  the file COVERAGE.md is a pure aggregation of, says 0.76 and 0.96.
  The two committed artifacts contradict each other; no regeneration
  environment can reproduce both.

### 2. benchmarks:full mixes two judge environments across its outputs

The committed artifacts were generated under different judge
configurations, verified by cache-replay:

- `oracle-results.json`, `judge-primary-vs-structural.md`, and the
  semantic rows of `evasion-data.csv` / `evasion-report.md` replay
  byte-identically from the committed cache only under
  `SWARM_JUDGE_PROVIDER=ollama SWARM_JUDGE_MODEL=qwen3.6:35b-a3b`
  (the judgeModel recorded in oracle-results.json).
- `tail-defect-recovery.md` and `per-hunk-localization.md` replay
  byte-identically only under the default provider (local,
  glm47-flash-abl); under the ollama environment their cache lookups
  miss and the numbers degrade to zero.

One invocation of `benchmarks:full` (the documented single command)
can therefore never reproduce the committed artifact set, regardless
of environment.

### 3. oracle:build deletes the committed live-path-runs sidecar

`writeCases` in `scripts/oracle/build-corpus.ts` removes every
directory under `benchmarks/oracle-corpus/` before writing, despite
its own comment saying it removes only the category directories the
build owns. `live-path-runs/` (six committed JSON files) is deleted by
any `npm run oracle:build`. The committed corpus and that sidecar
cannot both survive a documented rebuild.

## Why this is the halt condition and not my change

Every observation above was reproduced at the pristine baseline with
Phase 1 stashed. The detector recall numbers themselves (structural
recall, including mock-of-hallucination 25/25) replay byte-identically;
the failures are confined to COVERAGE.md, the evasion artifacts under
the wrong environment, and the sidecar deletion.

## State of the tree at halt

Nothing is committed and nothing was pushed. The working tree contains
the completed, tested Phase 1 work:

- `src/audit/cheat-detector/node-builtins.ts` (new) plus the exemption
  wired into `mock-of-hallucination.ts` (version 2.1.0): node:-prefix
  stripped, subpath resolved to root, membership checked against
  `builtinModules` from node:module. Four new detector tests pass
  (node:child_process, bare fs, node:fs/promises all silent; an
  undeclared module still blocks).
- Honest (negative) oracle case: `builtin-mock-honest` injector in
  `src/audit/oracle/inject/`, registered in a separate
  `HONEST_INJECTORS` list so defect consumers (twins, evasion,
  arbiter, restoration) never see it; label carries `honest: true`;
  `loadOracleCorpus` excludes honest cases unless opted in;
  `run-oracle` scores them as a must-not-fire exemption check
  (result: 1 case, 0 false positives, pass).
- Offline re-audit of the committed cloudflare-workers-sdk diffs:
  14091 is ADVISORY-CLEAN, 14063 still fires fake-refactor and
  assertion-strip, 14132 still fires error-swallow.
- Regenerated deterministic artifacts only: oracle-corpus INDEX.md,
  injection-coverage.md, per-detector-recall.md, oracle-results.json
  (replayed under the pinned qwen environment; only additions are the
  honest section and the timestamp), and the new
  `mock-of-hallucination/builtin-mock-honest/` case.
- A candidate fix for cause 3 is included in
  `scripts/oracle/build-corpus.ts` (writeCases now removes only the
  category directories the build owns), verified to spare
  live-path-runs/.

Phases 2 through 5 were not started. No DECISIONS.md entry was written
yet (the file does not exist in the repo; see phase0-baseline.md).

## What the maintainer needs to decide

1. Whether COVERAGE.md's committed numbers should be re-derived (fix
   `loadEvasionRobust` to use per-category max depth, regenerate under
   a single declared environment) or re-stated with the environment
   split documented.
2. Which judge environment `benchmarks:full` should pin, or whether
   each step should record and replay its own environment.
3. Whether the writeCases fix in this tree is the desired shape for
   protecting live-path-runs/.

Scratchpad copies of the baseline drift diffs:
baseline-coverage-drift.diff, baseline-evasion-drift.diff,
baseline-oracle-results-drift.diff, baseline-repro-status.txt under
the session scratchpad directory.
