# Patch 12.1.1 incident log (append-only)

Each entry: symptom, classification (pre-existing or self-caused),
root cause, fix commit, numbers moved, verification command.

## I-1: oracle:build deletes the committed live-path-runs sidecar

- Symptom: `npm run oracle:build` at pristine c1c394e1 deletes the six
  committed files under `benchmarks/oracle-corpus/live-path-runs/`.
- Classification: pre-existing (reproduced with all patch work stashed).
- Root cause: `writeCases` in `scripts/oracle/build-corpus.ts` removed
  every directory under the corpus root before writing, contradicting
  its own comment that it spares sibling artifacts.
- Fix: deletion is ownership-based; only directories named after a
  category in the injector registries (defect plus honest) are
  removed. A sentinel sidecar survival test pins the behavior.
- Numbers moved: none (the sidecar is restored from git, byte-equal).
- Verification: `npm run oracle:build` twice; `git status` shows
  live-path-runs/ untouched; the sidecar-survival test passes.

## I-2: COVERAGE.md robust column irreproducible (loadEvasionRobust)

- Symptom: regenerating COVERAGE.md at pristine c1c394e1 flips
  "survives cosmetic evasion" from "yes (robust)" to "no" for all
  eleven structural detectors.
- Classification: pre-existing.
- Root cause: committed `evasion-data.csv` is ragged by one category
  (every category tested to depth 4, cheat-mock-mutation to depth 6,
  extended in 70ce5c4c). `loadEvasionRobust` compared every category
  at the single global max depth, silently defaulting a missing depth
  row to rate 0. Committed COVERAGE.md predates the CSV change.
- Fix: per ruling 1, robustness is computed per category against that
  category's own max tested depth; a category missing its depth-0 or
  max-depth row is a nonzero-exit error naming the category; the
  COVERAGE.md table gains a tested-depth column.
- Numbers moved: recorded in the regeneration entry below once
  COVERAGE.md is regenerated under the fixed loader.
- Verification: `node dist/scripts/benchmarks/full.js --no-live`
  twice, byte-identical COVERAGE.md both times.

## I-3: benchmarks:full artifacts committed from two judge envs

- Symptom: committed `oracle-results.json`, `judge-primary-vs-structural.md`,
  and the semantic evasion rows replay from the committed cache only
  under ollama/qwen3.6:35b-a3b; committed `tail-defect-recovery.md`
  and `per-hunk-localization.md` replay only under the default local
  glm47-flash-abl provider. One `benchmarks:full` invocation cannot
  reproduce the committed set under any single environment.
- Classification: pre-existing.
- Root cause: no pinned benchmark environment; each historical run
  used whatever `SWARM_JUDGE_PROVIDER`/`SWARM_JUDGE_MODEL` the shell
  had.
- Fix: per ruling 2, a committed env manifest (provider, model tag,
  cache root) that full.js reads; any other env requires an explicit
  override flag. Per ruling 5, the two glm47-lineage artifacts are
  rerun live under the canonical ollama/qwen3.6:35b-a3b env; old and
  new numbers recorded here.
- Numbers moved: recorded in the rerun entry below.
- Verification: `node dist/scripts/benchmarks/full.js --no-live`
  under a shell with no judge env vars set reproduces the committed
  artifact set byte-identically (timestamps aside).

## I-4: COVERAGE.md semantic rows contradict committed oracle-results.json

- Symptom: committed COVERAGE.md says goal-not-fixed 0.68 and
  cheat-mock-mutation 0.16; committed oracle-results.json (its input)
  says 0.76 and 0.96.
- Classification: pre-existing (stale derived artifact, mixed lineage).
- Root cause: COVERAGE.md was generated from an older
  oracle-results.json produced under a different judge env and never
  regenerated after the qwen rerun landed.
- Fix: per ruling 4, COVERAGE.md regenerates from the committed
  oracle-results.json under the fixed loader and canonical env; no
  hand edits.
- Numbers moved: goal-not-fixed 0.68 to 0.76; cheat-mock-mutation
  0.16 to 0.96 (aligning the derived artifact with its committed
  input, which replays from the committed cache under the canonical
  env).
- Verification: semantic rows of COVERAGE.md equal the judgeRecall
  fields of oracle-results.json.

## I-5: halt-incident.md depth summary was wrong (self-caused)

- Symptom: the first version of halt-incident.md described the CSV
  raggedness as "structural depths 0-4, semantic depths 0-6".
- Classification: self-caused (reporting error in evidence prose).
- Root cause: I generalized from cheat-mock-mutation to both semantic
  categories without checking goal-not-fixed, which stops at depth 4.
- Fix: corrected against the committed git object
  (`git show c1c394e1:benchmarks/oracle-corpus/evasion-data.csv`,
  md5 42c3502cbdb1e020f6a8b2e819d0f649): every category is tested to
  depth 4 except cheat-mock-mutation (0-6). Correction note added in
  place. The resume directive's audit quoted different depths
  (assertion-strip 3, semantic pair 5, test-relaxation 7, most others
  8); those match neither the committed object nor the working copy,
  and per the truth hierarchy the committed raw data is authoritative.
- Numbers moved: none (evidence prose only).
- Verification: the depth census command above.
