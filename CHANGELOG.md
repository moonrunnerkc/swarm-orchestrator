# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/).

## [11.1.0] - 2026-06-02

### Execution-grounded checks: run the change instead of reading it

The cheat detectors and the judge read the diff; a reverted PR ships a logic
bug that leaves no cheat-shaped tell, so a diff-reading auditor does not catch
it (`benchmarks/real-prs/REDUNDANCY-FINDING.md`). This release adds an opt-in,
advisory-only layer that provisions a sandboxed checkout of a PR and runs it.
Three checks, each scoped to the lines the PR changed: diff-scoped mutation
testing (a surviving mutation on a changed line is a line the tests run past
without constraining), issue-linked repro execution (a repro from a closed
issue that still fails after the fix did not deliver), and a coverage delta (a
changed line no test executes). The layer is off by default
(`executionGrounded.enabled: true` to turn it on), needs no LLM, and costs
nothing external. Verified end to end on `trpc/trpc#6098`: 69 mutants on the
changed lines, 53 killed, 10 surviving on covered lines and 6 on uncovered
lines, fifteen advisory findings (after de-duplication by file and line) no
diff-only tool in this repo can emit; 8 of the covered survivors fall on the
lines the hotfix `trpc/trpc#6140` later changed. Full evaluation, the per-repo
viability, and the headline corpus numbers (M=1, R=0, U=1, F_clean=3.357) are
in `benchmarks/real-prs/v11-EXECUTION-GROUNDED-REPORT.md`; reproduce with `npm
run execution-grounded:full` under a Node 22 toolchain.

#### Added

- **Execution-grounded layer** (`src/audit/execution-grounded/`): `sandbox.ts`
  (clone-by-sha, package-manager and test-runner detection, install, optional
  build), `mutation-check.ts` (diff-scoped Stryker), `issue-repro.ts`
  (issue-linked repro execution), `coverage-delta.ts` (Istanbul coverage on
  changed lines), `monorepo.ts` (per-package scoping), and `index.ts` (the
  orchestrator). Wired into `swarm audit --pr` when enabled.
- **Five advisory finding categories**:
  `mutation-survives-on-changed-line`,
  `mutation-survives-on-uncovered-changed-line`, `issue-repro-still-fails`,
  `pr-breaks-issue-repro`, and `uncovered-changed-line`. Recorded under the
  ledger kinds `pr-audit-mutation-finding`, `pr-audit-issue-repro-finding`,
  and `pr-audit-coverage-finding`.
- **`executionGrounded` config block** in `.swarm/audit-config.yaml` (enabled,
  per-check flags, per-PR wall-clock cap), default off. `swarm doctor` checks
  it. Dev dependencies: `@stryker-mutator/core` and the jest/vitest/mocha
  runner adapters; no new runtime dependencies.
- **Evidence harness**: `npm run execution-grounded:run`,
  `execution-grounded:viability`, `execution-grounded:correlate`, and
  `execution-grounded:full`, over the existing regression and clean corpora.

#### Notes

- Advisory-only by default, like judge-primary: a run-grounded finding is a
  prompt for a reviewer, never a merge gate.
- Mutation testing requires a green baseline suite in the checkout. Large OSS
  monorepos often do not meet that in a generic sandbox (live databases,
  browsers, native runtimes, self-host builds); the report documents which
  corpus repos are viable and why.

## [11.0.0] - 2026-06-01

### Defect-injection oracle and a judge-primary path for semantic cheats

Cheat detection now has measurable recall against constructively-labeled
injected defects, the judge can run as a primary detector for cheats that
have no structural tell, and large diffs are chunked instead of truncated.
On the 300-defect oracle the post-upgrade pipeline catches 253/300
injected cheats vs 210/300 before (+20.5%), driven by the judge-primary
path on the two semantic categories (0 to 20/50) and a test-relaxation
reshape (1/25 to 24/25). The judge-primary path adds about 10 points of
false positives on presumed-clean reals, so its findings ship advisory
(severity `warn`, never blocking) by default; it is on by default and
opt-out per `judgePrimary.enabled: false`, and a consumer flips it to
blocking with `judgePrimary.block: true` only after measuring the
false-positive rate on their own merged-PR window (see
`docs/audit/methodology.md`). Full A/B in
`benchmarks/results/AB-REPORT.md`; reproduce with `npm run benchmarks:full`.

#### Added

- **Defect-injection oracle** (`src/audit/oracle/inject/`,
  `benchmarks/oracle-corpus/`). Thirteen injectors (eleven structural, two
  semantic) splice one labeled defect into a presumed-clean real PR and
  stamp a sha256-pinned label. `npm run oracle:build` regenerates the
  corpus byte-identical.
- **Judge-primary path** (`src/audit/cheat-detector/judge-primary.ts`).
  Runs the judge directly against the diff and the PR's stated claim for
  `goal-not-fixed` and `cheat-mock-mutation`, raising a finding when the
  claim is not delivered. Gated by `judgePrimary` in
  `.swarm/audit-config.yaml` (default on, requires the judge enabled).
  Roughly two extra judge calls per PR, about $0.009 at Haiku list price.
  Findings are advisory by default (severity `warn`); a consumer opts in
  to gating with `judgePrimary.block: true`, which the promotion policy
  only honors once a qualifying per-repo false-positive measurement is on
  file (`benchmarks/real-corpus/judge-primary-measurements.json`).
- **Versioned judge prompts** (`src/audit/cheat-detector/judge-prompts/`)
  and a calibration harness (`npm run calibrate:judge`) that picks the
  prompt with the best held-out recall whose clean-PR false-positive rate
  stays within a point of the most conservative version.
- **Per-hunk judging** (`chunkUnifiedDiffByHunk`) that localizes a verdict
  to a stable (file, hunk-index) id. This is infrastructure with no current
  recall lift: the mechanism test passes, but on the current judge per-hunk
  localization does not improve over whole-diff (a localized confirm prompt
  did not move it). See `benchmarks/oracle-corpus/per-hunk-localization.md`.
- **Evaluation harnesses and reports**: `benchmarks:baseline`,
  `benchmarks:oracle`, `benchmarks:full`, plus per-detector recall,
  judge-primary-vs-structural, judge calibration, tail-defect recovery,
  per-hunk localization, evasion survival, and `COVERAGE.md`.
- **Ledger entry kind** `pr-audit-judge-primary` distinguishing a finding
  the judge raised on its own from one it merely confirmed.
- **`swarm doctor` checks** for judgePrimary readiness (provider present,
  categories valid) with `--fix` paths, and an oracle-corpus hint.
- **`docs/audit/methodology.md`** documenting the oracle, the recall and
  false-positive measurements, and the conventions for adding an injector
  or a judge prompt version.
- **Real-world validation harness** (`scripts/real-prs/`, `npm run
  real-prs:full`). Fetches recent merged PRs from public repos, audits
  each with both the pre-upgrade and post-upgrade pipelines, and classifies
  every finding with an independent Anthropic Opus arbiter gated by a
  sanity check against held-out oracle defects. Report at
  `benchmarks/real-prs/REAL-WORLD-REPORT.md`. An 18-PR pilot drove the
  detector precision fixes below.
- **Regression corpus and the benefit evaluation** (`benchmarks/regression-corpus/`,
  `scripts/real-prs/mine-regressions.ts`, `npm run benefit:full`). Mines
  merged PRs that later proved wrong (a revert or a fix-PR names them) into
  a corpus of 72 retrospectively-bad PRs across twelve repos, each carrying
  its proof link; scales the presumed-clean corpus to 232 PRs; runs a
  differential against Semgrep and the ESLint security rules; computes a
  Venn of what only this auditor catches; and classifies a stratified
  sample with two independent model families (a local GLM judge and a Kimi
  cloud model, both clearing the oracle sanity gate). The honest result is
  a scope narrowing: Semgrep and ESLint raise ~nothing on the bad PRs, so
  the auditor's cheat class is invisible to them, but the auditor over-flags
  real PRs (95.7% of clean ones) and the two arbiters confirm 0 of its
  bad-PR findings as cheats. Reverted PRs are logic bugs, not cheats, so a
  cheat detector does not catch them. The tool's demonstrated value is
  advisory cheat-detection (the two models did confirm four real cheats on
  clean PRs that the linters missed), not regression prevention. See
  `benchmarks/real-prs/v11-BENEFIT-REPORT.md` and `REDUNDANCY-FINDING.md`.
- **Type-suppression detector** (`src/audit/cheat-detector/type-suppression.ts`)
  and its oracle injector. Flags an added `@ts-ignore` / `@ts-expect-error`
  / `eslint-disable` / `# type: ignore` on a non-test source line: silencing
  the checker over a flagged line ships the defect with its warning off, a
  cheat no security analyzer keys on. Advisory (severity `warn`); refutes a
  directive that only moved.

#### Changed

- **Large diffs are chunked, not head-truncated, before the judge.** A
  defect in the tail of an oversized PR used to be invisible to the judge;
  it is now judged in hunk-grouped chunks under the model's budget. This is
  infrastructure: it lets a tail defect reach the judge, but the recall is
  bounded by the judge (1/10 with the shipped conservative confirm prompt; a
  localized prompt reaches 5/10 in measurement but is not yet shipped). No
  current recall win is claimed beyond the mechanism.
- **test-relaxation** recognizes a strict equality rewritten to any
  threshold matcher (`toBe(42)` to `toBeGreaterThan(0)`), a class it
  walked past before.
- **Detector precision raised on real PRs** from the validation pilot,
  with no loss of oracle recall. no-op-fix had an inverted judge polarity
  (it raised the alarm when the judge said the fix was delivered) and now
  raises only when the judge says it is not. coverage-erosion fires only
  when the PR touches no test file at all, not on every added branch.
  error-swallow no longer promotes a comment-only catch to a blocking one,
  refutes a pre-existing catch the PR only re-indented, and stops
  surfacing the logging/metrics/fallback shapes it labels legitimate.
  test-relaxation refutes a removed test block or assertion that the diff
  re-adds elsewhere (relocation or parametrization). On the pilot corpus
  these cut the false-alarm burden from 3.17 to 0.11 per PR.

#### Removed

- No detectors retired. The four that read as zero-signal in the first
  oracle pass (comment-only-fix, coverage-erosion, no-op-fix,
  test-relaxation) were a measurement artifact (block-only counting and
  unfair injection shapes); fixing the measurement showed all ten clear
  the recall floor.

## [10.4.0-advisory] - 2026-05-31

### Two-stage verification: candidate detectors, then refute and confirm

The detectors are now treated as high-recall candidate generators, with
two stages after them deciding what reaches a reviewer. The goal is
precision without silencing detectors or losing recall. On the 205-PR
real corpus, non-informational findings on the 195 clean PRs dropped
from about 1146 to 145 (an 87% cut), and the blocking path no longer
fires on a finding the judge cannot confirm.

#### Added

- **Deterministic verification stage** (`src/audit/cheat-detector/verify-findings.ts`).
  Refutes a candidate finding when the diff itself shows the pattern is
  legitimate: a mock target that resolves to an internal directory named
  in the same diff, a rename paired with several different names, a test
  removed alongside the non-test source it covered. no-op-fix and
  coverage-erosion are demoted to informational when the PR claims no
  fix, since that is the only context their own message describes.
  Suppressions carry a rule id and reason.
- **LLM-judge confirmation gate** (`src/audit/cheat-detector/confirm-findings.ts`).
  When the judge is enabled, a block-severity finding must be confirmed
  before it blocks; a refuted finding drops to advisory. Off by default,
  so the no-credentials path is unchanged. Uses a clear-polarity
  `confirm:<category>` cache and ledger namespace, separate from the
  no-op-fix detector's own judge usage.
- **Per-finding confidence** (high/medium/low), assigned from judge
  confirmation, PR-intent corroboration, and severity, rendered on every
  PR-comment finding next to the precision badge.
- **Per-category cascade cap** in the renderer: a same-category cascade
  is capped at 10 findings with a summary line for the remainder, so one
  noisy PR cannot bury the signal.
- **Precision-based promotion gate** (`scripts/promotions/compute-promotions.ts`).
  A detector may block only when precision is at least 0.90 with at
  least 5 true positives and a Wilson 95% lower bound of at least 0.50.
  Detectors below the gate stay advisory; nothing is silenced.
- **CI policy-freshness guard** (`scripts/promotions/check-policy.ts`,
  `npm run promotions:check`). Fails when the committed promotion policy
  drifts from a fresh recompute, so a detector cannot be hand-promoted
  into the gate without the measured precision to support it.
- **Detector evasion-cost harness** (`benchmarks/evasion/`,
  `npm run evasion`). Measures how many semantics-preserving edits it
  takes to make a detector go silent. error-swallow,
  mock-of-hallucination, and assertion-strip survive the full cosmetic
  battery on the seeded cases.

#### Changed

- **`mock-of-hallucination` resolves internal roots from the diff.** A
  dotted mock target like `routers.servers.os.makedirs` is treated as
  internal when the diff touches a `routers/` directory, which works in
  the scorer and bare `--diff-file` runs where the filesystem is not the
  PR's repo. The GitHub Actions version-ceiling finding drops from block
  to advisory: offline, a version past a hardcoded allowlist cannot be
  told apart from a real newer release, and `actions/checkout@v5` /
  `setup-python@v6` were being reported as blocking hallucinations.
- **The judge caps the diff it sends to Haiku** to 120k chars, so large
  PRs (lockfile regenerations, vendored trees) no longer fail the call.
- **Published numbers repinned** to the v10.4 deterministic scores
  snapshot in `detector-precision.ts` and the README, replacing the
  stale v10.1 figures.

## [10.3.0-advisory] - 2026-05-24

### Finishes the v10.2 solo-doable backlog

The four items left after `10.2.0-advisory` that didn't need external
humans (paid raters, OSS maintainers running shadow audits on their
own repos) land here: `no-op-fix` v2.0 with a gated LLM judge, a
real-corpus rebaseline against the v2.0 detectors, a public
dashboard, and a single-file shadow-output flag.

#### Added

- **`no-op-fix` 2.0.0 with a gated Anthropic Haiku judge.** The judge
  fires only when `--enable-llm-judge` is set or
  `SWARM_AUDIT_LLM_JUDGE=1` is in the environment, both of which
  require `ANTHROPIC_API_KEY`. Default audits still run with no
  credentials. Content-addressed cache at `.swarm/llm-judge-cache/`
  makes the judge's verdict replayable: the same diff + title +
  pinned model id always returns the cached answer. Model id pinned
  to `claude-haiku-4-5-20251001`.
- **`llm-judge-result` ledger entry kind.** One entry per judge call
  (cache hit or live), carrying detector, modelId, cacheHit, diffSha,
  titleSha, answer, and optional reason. Feeds the
  `--shadow-output` `judgeInvocations` counter and the renderer's
  per-finding judge reasoning line.
- **`--shadow-output <path>` on `swarm audit`.** Single-file shadow
  schema (`schemaVersion: 2`): `prRef`, `auditedAt`, `durationMs`,
  `detectorVerdicts` per loaded detector, the `judgeInvocations`
  count, and the `renderedComment` body. Existing `--shadow
  <repo-label>` per-repo rollup mode is unchanged.
- **Public dashboard at `docs/leaderboard/`.** New `index.html` +
  `score.js` (no build step, no CDN) fetches
  `benchmarks/real-corpus/scores/latest.json` directly and renders
  the overall precision / recall / F1, a sortable per-detector F1
  table, and the score-file timestamp. Synthetic regression sidebar
  preserved so the weekly cron still has somewhere to land.
- **GitHub Pages workflow** (`.github/workflows/pages.yml`) publishes
  `docs/` plus the score snapshot to
  [moonrunnerkc.github.io/swarm-orchestrator/docs/leaderboard/](https://moonrunnerkc.github.io/swarm-orchestrator/docs/leaderboard/).
- **`docs/shadow-mode.md`.** Operator guide for both shadow shapes
  with a runnable `jq` rollup recipe.

#### Changed

- **Real-corpus headline rescored against v2.0 detectors.** The prior
  `latest.json` snapshot predated the v2.0 commits to
  `error-swallow`, `fake-refactor`, `mock-of-hallucination`, and
  `no-op-fix`. Rescoring against the live registry (judge off) moves
  the overall numbers from F1 0.109 (P 0.067, R 0.300) to F1 0.167
  (P 0.100, R 0.500). The single per-detector mover is
  `mock-of-hallucination`, which goes from 0 TP / 13 FP to
  2 TP / 16 FP. `promotions.json` keeps every detector at
  `advisory-only`; no detector clears the F1 0.5 gate.
- **README evidence table now carries detector versions** so a reader
  can see which shape produced each row, and an "LLM judge" row makes
  the default-off scoring posture explicit.

#### Internal

- LOC budget raised from 26000 to 27000 to absorb the judge module.

## [10.2.0-advisory] - 2026-05-24

### Honest reset and repositioning

The synthetic 1.000 is demoted to a regression-only number with the
literal framing "self-consistency check, not detection power". The
real-corpus F1 (0.109 on 205 hand-labeled PRs) is the only published
headline. The cheat-detector engine repositions around the suspicion
score the measured precision can credibly support; the merge-gate
ambition becomes opt-in rather than the default.

#### Added

- `--mode <advise|gate>` on `swarm audit`. `advise` (the default)
  reports findings without ever exiting 1 on a blocking finding;
  `gate` preserves the v10.1 merge-blocking exit-code contract. The
  rendered PR comment makes the distinction explicit with a top-of-
  comment banner and a reframed blocking-section header.
- `--detectors <default|experimental|all>` on `swarm audit`.
  `default` loads the four advisory-grade detectors targeted for v2.0
  (error-swallow, mock-of-hallucination, no-op-fix, fake-refactor);
  `experimental` adds back the six retired detectors; `all` is an
  alias for `experimental` retained for v10.1-pinned callers.
- `src/audit/cheat-detector/detector-sets.ts` defines the split.
  `runCheatDetectors` accepts a new optional `detectorSet` field on
  `AuditInput`; `AuditResult.detectorSet` carries the resolved set
  through to the rendered comment, the ledger, and downstream
  AIBOM artifacts.
- Per-detector measured-precision badge in the rendered PR comment.
  Every finding header is followed by a `Detector precision badge:`
  line citing the precision, firing count, and corpus identifier.
  Numbers come from
  `src/audit/report-comment/detector-precision.ts` and are pinned at
  the v10.1 real-corpus snapshot.
- `--shadow <repo-label>` shadow-mode infrastructure: writes the
  audit verdict to `.swarm/shadow/<repo>/<run-id>.json` and
  suppresses both the comment and the gating exit code. Provides the
  on-disk shape downstream analyzers join against the upstream PR's
  merge / revert / review history.
- `docs/labeling-methodology.md`, the rubric and inter-rater policy
  the labels-v2 corpus is being built against.
- `benchmarks/real-corpus/labels-v2/` scaffold with `agreement.json`
  layout, rater-id anonymization, and the kappa-threshold gate.
- `scripts/labeling/compute-kappa.ts` computes Cohen's kappa pairwise
  across the labels-v2 rater files and emits `agreement.json`.
- `scripts/promotions/compute-promotions.ts` emits
  `benchmarks/real-corpus/promotions.json`. F1 ≥ 0.50 promotes a
  detector from advisory to gate-eligible; the table is the
  auditable artifact that justifies the gate-eligible list in the
  next major release.

#### Changed

- Six detectors retire from the default set in v10.2-advisory.
  Three are zero-TP / zero-FP on the real corpus
  (`comment-only-fix`, `exception-rethrow-lost-context`,
  `dead-branch-insertion`); three are FP-only on the real corpus
  (`assertion-strip`, `coverage-erosion`, `test-relaxation`). All
  six remain available behind `--detectors experimental`.
- README "What This Does" repositions around the suspicion-score
  verdict. A "Real-corpus headline F1" section replaces the v10.1
  Evidence section; the synthetic 1.000 is presented as a self-
  consistency check next to the real-corpus 0.109.
- `scripts/corpus/score-real.ts` and the leaderboard scorer both
  request `detectorSet: 'experimental'` so the retired six are
  still scored.

#### Renamed / repositioned (no breaking API change)

- `Finding` shape and `AuditResult` JSON shape unchanged (a new
  optional `detectorSet` field is additive). The `--mode` and
  `--detectors` flags default to behavior matching the v10.1
  rendered shape when omitted by an older caller (gate, all).
- The CLI's `--output json` adds a top-level `mode` field next to
  the existing AuditResult shape.

## [10.1.0] - 2026-05-24

### Detector accuracy on real PRs

CLI, ledger, and AIBOM shape unchanged. The real-corpus baseline
replaces the synthetic 500-case number as the published headline:
precision 0.067, recall 0.300, F1 0.109 across 195 clean + 10 broken
hand-labeled entries. Synthetic regression suite still passes 520 of
520 with 0 failed expectations. Test count 1061 to 1127.

#### Added

- `benchmarks/real-corpus/` with 949 collected agent-authored PRs plus 60
  closed-without-merge negatives and 205 hand-labeled entries (10 broken,
  195 clean). Snapshot at `benchmarks/real-corpus/scores/latest.json`.
- `scripts/corpus/{collect-real,collect-negatives,sample-unlabeled,sample-for-labeling,score-real,verify-pr-intent,agent-signatures}.ts`
  for collection, labeling sampling, scoring, and intent-layer behavior
  checks.
- `src/audit/cheat-detector/manifests/` directory: five new ecosystem
  readers (`pom-xml.ts`, `gradle.ts`, `gemfile.ts`, `composer-json.ts`,
  `csproj.ts`) on top of the five existing (`package.json`,
  `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`).
- `src/audit/cheat-detector/matcher-grader.ts` AST matcher comparator using
  the TypeScript compiler API. Catches tolerance widening like
  `toBeCloseTo(5, 2)` to `toBeCloseTo(5, 100)` that the regex layer cannot
  see.
- `src/audit/cheat-detector/test-import-closure.ts` and
  `src/audit/cheat-detector/import-resolver.ts` for import-graph
  reachability. Honors `tsconfig#paths` and workspace mappings; Python
  dotted and relative imports resolved against `__init__.py`.
- `src/audit/cheat-detector/pr-intent.ts` parses PR title and body for
  three fix-claim vocabularies (GitHub close-keyword with `#N`,
  imperative title prefix with colon, body-lead "this PR fixes/closes"
  sentence in the first 500 bytes).
- `AuditConfig.intentSeverityPolicy: strict | lenient | off` field in
  `.swarm/audit-config.yaml`. Documented in [`docs/audit-config.md`](docs/audit-config.md).
- `Finding.intentUpgraded?: boolean` and `DetectorContext.pr?` on the
  shared types (both additive).
- 20 synthetic fixtures under
  `benchmarks/falsification-corpus/v10-synthetic-corpus/test-relaxation/{broken,clean}/test-relaxation-{050..069}.diff`
  exercising the AST grader rules. `index.json` totalCases 500 to 520.
- `docs/audit-config.md` documents both `excludePaths` and
  `intentSeverityPolicy` with the full fix-claim vocabulary catalog.

#### Changed

- `runCheatDetectors` is now async. Detector return type widens to
  `Finding[] | Promise<Finding[]>` to support the import-graph path.
- `error-swallow` 1.0.0 to 1.1.0 splits bare empty catches (still
  `block`) from comment-only catches (now `info`).
- `mock-of-hallucination` 1.0.0 to 1.1.0 picks up the five new manifest
  readers.
- `test-relaxation` 1.0.0 to 1.1.0 escalates regex-undecidable cases to
  the AST grader. Hunk cap at 50 per PR with regex-only fallback above
  the cap.
- `no-op-fix` 1.0.0 to 1.1.0 uses `reachableSourceFiles` (BFS over the
  import graph, 5000-node cap) instead of the basename `text.includes`
  heuristic.
- `scripts/corpus/score-real.ts` threads PR metadata into the audit so
  the PR-intent layer fires during scoring.
- `benchmarks/falsification-corpus/v10-corpus/` renamed
  `v10-synthetic-corpus/` so the leaderboard UI can show the real-corpus
  number as the headline and the synthetic numbers as a regression
  sidebar.
- README "Evidence" section replaces the synthetic 1.000 headline with
  the real-corpus 0.109 F1 plus a per-detector TP/FP/TN/FN table.
- LOC budget raised 23500 to 24500 to accommodate the new detector
  infrastructure (matcher-grader 251 LOC, test-import-closure 137 LOC,
  import-resolver 284 LOC).

#### Removed

- `testFilesReferencingSource`, `walkDir`, `readSafe`, and the
  `text.includes(stem)` heuristic from `no-op-fix.ts`.

#### Known limitations

- Real-corpus recall is 0.300; only 3 of 10 broken-labeled PRs are
  caught by at least one detector. The 7 misses are PRs labeled
  `goal-not-fixed` (empty file added, half the stated change missing,
  hardcoded answers) that neither `no-op-fix` nor `comment-only-fix`
  fire on. Candidate for the next release.
- The PR-intent layer's headline-precision impact on this baseline is
  negative (0.083 to 0.067) because none of the 10 broken-labeled
  entries in this sample carry fix-claim language while 22 of the 195
  clean-labeled entries do. The layer escalates as designed; the
  corpus does not exercise its upside on the broken side. Disable per
  repo via `intentSeverityPolicy: off`.
- `mock-of-hallucination` cannot resolve Python stdlib (`shlex`,
  `graphviz`) against project manifests, producing 13 of its 13 FPs
  from this class. Candidate for the next release.
- Labels are AI-judged (`labeledBy: claude-opus-4-7-baseline-judge`)
  pending human ground-truth review and marked as such in every label
  file. Human review is the next credibility step.

## [10.0.0] - 2026-05-23

### v10 — Auditor repositioning

Refocuses the project from "AI coding swarm" to *the merge gate for AI-generated
PRs.* Internal API names (`Obligation`, `Contract`, `verifier`) are stable; only
docs vocabulary, the headline action, and the top-level CLI surface change.

#### Added

- `swarm audit <pr-ref | --diff-file | --diff-stdin>` CLI subcommand.
- `src/audit/cheat-detector/` with four Phase-1 detectors: `test-relaxation`,
  `mock-of-hallucination`, `assertion-strip`, `no-op-fix`. Pluggable detector
  registry; adding a category is one import + one array entry.
- `src/audit/pr-source/` AI-agent fingerprinter covering Claude Code, Cursor,
  Devin, Aider, Codex CLI, Copilot Workspace, Replit Agent, OpenHands.
- `src/audit/report-comment/` deterministic PR-comment renderer.
- `src/audit/aibom/` emitters for CycloneDX 1.6 ML-BOM and SPDX 3.0 AI-Profile,
  both hand-rolled, no new runtime deps. Triggered by `--emit-aibom`.
- Optional `aiAgent: { vendor, version?, confidence?, source? }` on every
  ledger entry; three new audit entry kinds (`pr-audit-started`,
  `pr-audit-finding`, `pr-audit-completed`).
- `audit-mode: true` input on the root GitHub Action plus a composite
  sub-action at `.github/actions/swarm-audit/`. The action emits
  `audit-pass`, `audit-findings`, `audit-ledger` outputs and posts the
  rendered Markdown finding back to the PR via `GITHUB_TOKEN`.
- Dogfood workflow `.github/workflows/pr-audit.yml` that audits every PR
  against the repository itself.
- 500/500 broken/clean fixture corpus under
  `benchmarks/falsification-corpus/v10-corpus/` driven by the v10 generator
  scripts in `scripts/corpus/`.
- `benchmarks/leaderboard/` reproducible scorer + `docs/leaderboard/` static
  site rendering the agent leaderboard.
- `docs/check-types.md`, `docs/eu-ai-act-mapping.md`, and
  `docs/cisa-sbom-ai-mapping.md`.
- New `swarm-audit` bin alias (same dispatcher) so consumer scripts can name
  the audit verb directly.

#### Changed

- README leads with the audit positioning and the merge-gate tagline.
- Action.yml description, branding, and headline reflect the audit-first
  positioning; legacy v8 orchestrator inputs continue to work unchanged.
- `package.json` description, keywords retuned around `pr-audit`,
  `cheat-detector`, `aibom`, `merge-gate`, `eu-ai-act`, `cisa-sbom`.

### Added

- GitHub Action inputs for the full provider, contract-source, and
  run-knob surface: `contract-path`, `contract-file`, `contract-module`,
  `extractor`, `session`, `model`, `local-backend`, `local-base-url`,
  `local-model-extractor`, `local-model-session`, `local-grammar`,
  `external-patches-queue`, `external-patches-dir`, `falsifiers`,
  `mode`, `candidates`, `max-obligations`, `cost-cap`, `repo-root`,
  `working-directory`, `result-path`, and `extra-args`. The action now
  supports all three run modes (compile-then-run from a `goal`,
  `contract-only` compile, and direct run of a pre-compiled
  `contract-path`) and emits the run-result JSON via the existing
  `result` step output. API keys remain off-limits as inputs and must
  be set through the workflow `env:` block.

### Fixed

- `swarm run --goal "..."` now forwards every `--local-*` flag to both
  the compile (extractor) and run (session) passes. Prior to this fix
  the wrapper kept local-provider flags in the run-pass passthrough
  only, so a flag-driven local configuration crashed the compile pass
  unless `LOCAL_LLM_*` env vars were also set.

## [9.0.0] - 2026-05-14

Removal of the legacy v6 verified-branch pipeline. v8 (contract-first,
falsification-gated) is now the only supported execution path.

### Removed

- The v6 verified-branch pipeline in full. Every entry point that
  previously dispatched to `src/swarm-orchestrator.ts`, `plan-generator.ts`,
  `session-executor.ts`, `share-parser.ts`, `repair-agent.ts`,
  `verifier-engine.ts`, `pr-manager.ts`, `pm-agent.ts`, and
  `branch-merger.ts` is gone. The supporting subsystems are gone with it:
  `src/orchestrator/`, `src/verifier/`, `src/adapters/`,
  `src/quality-gates/`, the battery layer of `src/verification/`
  (battery-runner, differential-gate, mutation-gate, cheat-detector,
  composite-score, attestation, test-synthesizer, property-gate,
  ast-imports/signature, semgrep-normalizer, post-merge, command-runner,
  and their immediate helpers), and the 40+ v6 support modules
  (agents-exporter, baseline-scanner, bootstrap-*, commit-*, context-broker,
  copilot-cli-wrapper, copilot-transient-retry, cost-estimator,
  deployment-*, external-tool-manager, gate-*, github-*, hook-generator,
  knowledge-base, meta-analyzer, metrics-*, multi-repo-coordinator,
  owasp-*, post-run-reporter, pr-automation, prompt-builder,
  quick-fix-mode, recipe-loader, report-*, requirement-filter,
  sarif-formatter, secret-redactor, step-runner, task-classifier,
  test-command-discovery, text-similarity, tier-maps, url-shortener,
  wave-*, worktree-*, presenter/, share/, scheduling/, rules/).
- The nine v6 CLI handlers in `src/cli/` (swarm-handlers,
  status-handlers, plan-handlers, demo-handlers, live-status,
  misc-handlers, share-handlers, usage, attest-handlers) and the
  `--v6` dispatch branch in `src/cli.ts`.
- The v6 test corpus (one test file per deleted module).

### Migration

Users who still depend on `swarm run --v6` must pin to the latest
`8.0.x` release. v8 is the only supported path going forward. The
`--v6` flag was deprecation-warned starting `8.0.4` and is removed
entirely in this release; the same goal can typically be expressed as
an obligation under `v8 compile` / `v8 run`.

### Rationale

The v6 pipeline has been opt-in since `8.0.0` and deprecation-warned
since `8.0.4`. Carrying both pipelines duplicated the adapter surface,
the quality-gate engine, and the verification layer, at a cost the
`coding-optimization-report.md` enumeration measured at ~30,800 LOC and
58 test files. The Phase 0 grep gate has held the v6↔v8 import boundary
clean since `8.0.4`, making deletion mechanical rather than architectural.

## [8.0.4] - 2026-05-14

Deprecation signal for the legacy v6 pipeline. Phase 0 of the v8-only
cleanup; no behavioral changes to the v6 or v8 code paths.

### Deprecated

- `swarm run --v6` now prints `--v6 is deprecated and will be removed in
  v9.0.0.` to stderr before dispatch. The legacy verified-branch pipeline
  remains fully functional in 8.0.x; it will be removed in v9.0.0.

### Added

- `evidence/baseline-v8.0.3/` — captured baselines (build log, test log,
  end-to-end smoke against `fixtures/v8-empty`, LOC count, file count) so
  later cleanup phases can gate against a comparable reference point.
- `evidence/loc-budget.txt` — per-phase LOC ceiling consumed by the
  cleanup CI gate.
- CI gate (`cleanup-boundary` job in `.github/workflows/ci.yml`) that
  enforces three invariants on every PR: total `src/` LOC stays at or
  below `evidence/loc-budget.txt`, the v6 entry surface contains no v8
  imports, and v8 directories contain no v6 imports.

## [8.0.3] - 2026-05-13

Provider boundary: the orchestrator no longer requires an Anthropic API
key by default. Three interchangeable providers (`deterministic`,
`local`, `anthropic`) sit behind the same `Extractor` / `Session`
interfaces and pass the same parameterized contract test. See the
sections below for the full inventory.

### Breaking

- Default provider changed from `anthropic` to `deterministic`. Users who
  relied on the previous default must explicitly opt in to a model provider
  via `--extractor anthropic --session anthropic`, the `EXTRACTOR_PROVIDER` /
  `SESSION_PROVIDER` env vars, or the equivalent project-config keys. See
  [docs/migration.md](docs/migration.md).

### Added

- Deterministic provider for both extractor and session. The tool now runs
  end-to-end with no network access, no model, and no API key. Three
  contract input forms (`--contract-file`, `--contract-module`, inline
  config block) and three patch input channels (`--external-patches-dir`,
  `--external-patches-queue`, `--external-patches-stdin`).
- Local provider supporting `openai-compatible`, `ollama`, `llama-cpp`, and
  `vllm` backends. Backend-agnostic; no model is hardcoded. Configuration
  through `LOCAL_LLM_*` env vars (see
  [docs/configuration.md](docs/configuration.md)).
- Grammar-constrained decoding for backends that support it (`json-schema`
  on `openai-compatible` / `ollama` / `vllm`, `gbnf` on `llama-cpp`). The
  unified-diff GBNF grammar ships at
  `src/inference/local/grammars/unified-diff.gbnf`.
- Ledger entries written by candidate-generation sites now carry optional
  provider-attribution fields: `provider`, `modelId`, `backend`, `grammar`,
  `seed`, `source`, `usageEstimated`. Existing consumers are unaffected.
- End-to-end test (`test/e2e/deterministic-full-cycle.test.ts`) proving the
  full compile + run + verify cycle works with `ANTHROPIC_API_KEY` unset
  and no network access.
- [docs/providers.md](docs/providers.md),
  [docs/configuration.md](docs/configuration.md),
  [docs/migration.md](docs/migration.md). Architecture overview gains a
  "Provider boundary" section.
- CLI flags for local-provider configuration on `swarm compile`,
  `swarm run`, and `swarm resume`: `--local-backend`, `--local-base-url`,
  `--local-model-extractor`, `--local-model-session`,
  `--local-persona-model-map`, `--local-grammar`,
  `--local-request-timeout-ms`, `--local-max-concurrency`,
  `--local-api-key`, `--local-seed`.
- Config-file `provider:` block parser at `.swarm/config.yaml`
  (`src/config/provider-config.ts`). The block sits below env vars in the
  precedence chain (flag > env > config > default); unknown keys, wrong
  types, and out-of-set enum values fail loud with the offending key
  path.
- Parameterized Session interface contract test running against
  `DeterministicSession`, `AnthropicSession`, and `LocalSession` with each
  of the four shipped local backends. Any new provider must pass the
  same battery to claim Session conformance.
- Provider-comparison benchmark harness at `benchmarks/provider-bench/`.
  Supports `--extractor`, `--session`, every `--local-*` flag, and a
  `--compare-providers` mode that runs all three providers sequentially
  and emits a Markdown report.

### Changed

- Contract JSON Schema extracted to
  `src/contract/extractor/contract-schema.ts`. The Anthropic extractor and
  the deterministic / local extractors all import from it; the LLM tool
  call binds the same bytes the deterministic validator uses.
- Anthropic provider records `provider: 'anthropic'` in ledger entries.
- README Quick Start no longer requires Anthropic credentials. The first
  runnable example produces a working result with zero external
  dependencies.
- `buildExtractor` and `buildSession` consolidated into
  `src/contract/extractor/factory.ts` and `src/session/factory.ts`. The
  duplicated session-building logic across `run-handler.ts` and
  `resume-handler.ts` is gone.
- The legacy `stub` and `stub-heuristic` provider names are no longer
  accepted by the CLI factories. `StubExtractor` and `StubSession` remain
  as library exports for the project's own integration tests and the
  synthetic benchmark; no flag, env var, or config key can reach them.
  The four-chars-per-token estimator moved from `stub-session.ts` to
  `src/session/token-estimator.ts` so production code does not import
  from an `@internal` module.

### Fixed

- README GitHub Action section incorrectly described the Action as
  defaulting to the Anthropic provider; `entrypoint.sh` does not set a
  provider, so the Action inherits the CLI's `deterministic` default.
- `docs/configuration.md` listed `stub` / `stub-heuristic` among the
  accepted `--extractor` / `--session` values; the row was removed after
  the CLI factories stopped accepting those names.
- `--local-grammar gbnf` (or any value the extractor cannot honor) used
  to be silently coerced to null with no user-facing signal. The
  compile, run, and resume handlers now resolve the requested value per
  consumer through `src/cli/v8/grammar-resolve.ts` and emit a single
  stderr warning naming the flag, the value, the consumer, and the
  effective value. The warning fires only when the affected consumer is
  the local one; the deterministic and anthropic branches ignore
  `localGrammar` and a coercion message there would be misleading. The
  grammar-capability matrix is documented in
  [docs/configuration.md](docs/configuration.md) and
  [docs/providers.md](docs/providers.md).

### Added (benchmark provider switching)

- `benchmarks/swe-bench/evaluation-scripts/run_swebench.py` and
  `benchmarks/harness/run_fresh.sh` now accept and forward
  `--extractor`, `--session`, and the ten `--local-*` flags (plus the
  matching env-var fallbacks) to every orchestrator subprocess. Default
  behavior (no provider flags supplied) is unchanged.
- `run_swebench.py --compare-providers` runs the SWE-bench sweep three
  times (once per provider) and writes a side-by-side comparison JSON
  to `RESULTS_DIR/<run-id>-compare-providers.json` next to the
  per-sweep summaries. Per-instance pivot lets a diff tool compare
  provider behavior on the same task.
- [benchmarks/README.md](benchmarks/README.md) documents which
  harnesses accept provider flags, which have a comparison mode, and
  which are out of scope (the `swarm demo` subcommand on `run-n.sh`
  uses a fixed-scenario pipeline that does not accept extractor /
  session flags; the `ladder` harness invokes `claude` directly and
  never the orchestrator).

## [8.0.2] - 2026-05-11

Tag commit: set at release time. Previously-documented architectural
limitations closed out in this release; workspace rollback (landed on `main`
since `8.0.1` via [`584bca2`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/584bca2))
is the headline feature shipped under the `8.0.2` tag.

### Added (workspace rollback)

- **ARIES-style workspace rollback for falsified obligations.** A confirmed
  falsifier counter-example now flips the obligation back to failed *and*
  unwinds the patch: pre-apply bytes are restored from a content-addressed
  sidecar under `.swarm/snapshots/<run-id>/`, the restore is verified by
  re-hashing on-disk bytes against the logged pre-apply blob SHA, and
  out-of-band mutations between apply and rollback surface as a failed
  rollback ledger entry rather than being silently overwritten.
  The post-merge integration check reuses the same primitive to unwind
  every applied obligation in reverse order when cross-obligation regression
  is detected. Source: `src/population/rollback.ts`, snapshot manager wiring
  in `src/population/manager.ts`. Land commits
  [`584bca2`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/584bca2)
  and [`2c8effa`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/2c8effa);
  README narrative landed in [`2986159`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/2986159).
- **`swarm v8 stats` subcommand.** Reports per-adapter falsifier counters
  (success, regression-discovered, false-positive, latency-ms) from the
  same `.swarm/falsifier-stats.json` file used by the UCB1 dispatcher.
  Source: `src/cli/v8/index.ts`, README CLI reference landed in
  [`2986159`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/2986159).



- **Tournament streaming verification.** `--mode tournament` now routes
  every candidate through the same `runStreamingCompletion` pipeline used
  by `--mode single`. Streaming verifiers (forbid-import, regex, cost-cap)
  abort only the offending candidate; survivors continue and the
  deterministic tie-break still selects a winner. Aborted candidates are
  pre-populated in `verdictByHash` with a synthetic
  `{ score: -1, model: 'stream-aborted' }` verdict so a same-hash collision
  cannot promote them. Source: `src/population/tournament.ts`,
  `src/verification/streaming-verifier.ts`.
- **Snapshot cleanup.** `.swarm/snapshots/<run-id>/` is pruned once after
  the `run-finished` ledger entry via the new `--snapshot-cleanup <policy>`
  flag. Policies: `retain-on-failure` (default), `always`, `never`,
  `retain-last:N`, `max-age:<dur>`, `max-disk:<sz>`. Idempotent and
  crash-safe (tolerates concurrently-removed directories between scan and
  rm). Source: `src/population/snapshot-cleanup.ts`,
  `src/population/manager.ts`.
- **Live `--cost-cap`.** A single `LiveCostTracker` observes every
  concurrent stream, projects cumulative USD in real time, and triggers a
  cooperative abort once the projection crosses the cap. Aborts are
  recorded as `candidate-stream-aborted` with
  `reason='cost-cap exceeded'`; final per-stream usage is reconciled via
  `commitUsage` after each adapter response settles. Live by default;
  `--no-cost-cap-live` falls back to the old post-obligation enforcement.
  Source: `src/verification/live-cost-tracker.ts`.
- **UCB1 falsifier dispatch.** Opt in with `--falsifier-scheduler ucb1`.
  The dispatcher orders adapters by a UCB1 score over persisted (success,
  regression-discovered, false-positive, latency-ms) counters at
  `.swarm/falsifier-stats.json` (override with `--falsifier-stats-path`).
  Every decision is appended to the ledger as
  `falsifier-dispatch-decision`, so replay reproduces the same ordering.
  Default `none` preserves registration order. Source:
  `src/falsification/scheduler.ts`, `src/falsification/dispatcher.ts`,
  `src/ledger/types.ts`.

### Tests

- 38 new tests across `test/population/snapshot-cleanup.test.ts`,
  `test/verification/live-cost-tracker.test.ts`,
  `test/falsification/scheduler.test.ts`,
  `test/population/tournament-streaming.test.ts`, and extensions to
  `test/falsification/dispatcher.test.ts`. Suite total: **2196 passing**.

---

Adapter reintegration: the falsification dispatcher is wired into the v8 run path
behind the new `--falsifiers <on|off>` flag (default `on`). After the producer's
verifier accepts a patch, every registered adapter that handles the obligation
type runs sequentially against the patch SHA. A confirmed counter-example flips
the obligation back to failed and appends a `falsification-call` ledger entry
with cost and yield. Source: `src/falsification/dispatcher.ts`,
`src/cli/v8/run-handler.ts:163-167`, merge commit
[`d0a46f3`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/d0a46f3).

### Added

- `FalsifierAdapter` contract, in-process `AdapterRegistry`, and per-call
  `AdapterCostRecord` schema with dual-column cost reporting (`dollarsBilled`
  for real charges, `dollarsApiEquivalent` for like-for-like rate-card cost).
  `cost-attribution.json` carries optional `adapters[]` and `adapterDollarsTotal`
  fields. Source: `src/falsification/adapters/{types,registry,cost-aggregator}.ts`,
  `src/metrics-types.ts:103-176`. Pre-registration commit
  [`d813ce7`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/d813ce7).
- `CodexFalsifier`: `codex exec --sandbox workspace-write --ask-for-approval never`,
  three candidates per call. Strategy: adversarial test input generation against
  `property-must-hold`. Default on. Source:
  `src/falsification/adapters/codex/codex-falsifier.ts`. Land commit
  [`c62e8c1`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/c62e8c1).
- `CopilotFalsifier`: `copilot -p` with constrained per-tool permissions
  (`--allow-tool view`, no `--allow-all-tools`). Strategy: import-graph
  perturbation and function-signature drift against `import-graph-must-satisfy`
  and `function-must-have-signature`. Default on. Source:
  `src/falsification/adapters/copilot/copilot-falsifier.ts`. Pre-registration
  commit
  [`8536bc0`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/8536bc0).
- `ClaudeCodeFalsifier`: `claude -p --output-format json --max-budget-usd 1.00`.
  Strategy mirrored from Codex (`property-must-hold`); same family as the
  producer for the cross-family-diversity ablation arm. Default off; opt in
  via `defaultAdapterRegistry({ includeClaudeCode: true })`. Source:
  `src/falsification/adapters/claude-code/claude-code-falsifier.ts`.
- Methodology-fix invariants: pre-apply baseline predicate check (returns
  `no-falsification-found` with reason `baseline-predicate-failed` before any
  LLM spawn if the predicate already fails); workspace fixture isolation under
  `evidence/fixtures/` with hash validation; dual-column cost reporting at the
  `AdapterCostRecord` and `AdapterCostAggregate` layers. See
  [`docs/falsification-adapters.md`](docs/falsification-adapters.md).
- `docs/falsification-adapters.md` documenting the adapter contract, sandbox
  posture, and dual-column cost reporting.

### Not built or deferred

- **Phase 5 bandit dispatcher (not built).** Codex and Copilot have disjoint
  obligation types, so there is nothing for a bandit to arbitrate.
- **Phase 6 cross-vendor producer race (deferred).** Phase 2's predicate set
  lacked the high-stakes obligations the gate is meant to catch.

## [8.0.1] - 2026-05-08

Tag commit: [`c4efe20`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/c4efe20).

### Fixed

- v8 extractor and AST verifiers root-fix (the "big caveat"): the
  `import-graph-must-satisfy` extractor and the `function-must-have-signature`
  AST verifier now use the TypeScript compiler API for `.ts`/`.js` and the
  Python `ast` module for `.py`. Substring matches inside comments and string
  literals no longer produce false positives. Source: commit
  [`1211e11`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/1211e11),
  files `src/verification/ast-imports.ts`, `src/verification/ast-signature.ts`.

### Removed

- `.github/workflows/v8-ci.yml` (the `v8-dev`-branch shadow CI). Source:
  commit
  [`2f6c05e`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/2f6c05e).

## [8.0.0] - 2026-05-06

Tag commit: [`db820f5`](https://github.com/moonrunnerkc/swarm-orchestrator/commit/db820f5)
("v8.0.0: contract-first AI coding swarm (#40)").

The v8 architectural rewrite. Contract compiler, single cached Anthropic
session, eight default personas, eight obligation types in the v1 schema,
hash-chained JSONL ledger with resume, WASM deterministic floor, streaming
verifier with mid-generation abort, post-merge integration check, and the
top-level `swarm run` defaulting to v8 with `--v6` opt-out for the legacy
verified-branch pipeline.

## Earlier releases

Per-release notes for v4.1.0 through v7.0.0 live under
[`docs/releases/`](docs/releases/). Those entries pre-date this changelog and
were not retroactively rewritten; the source-of-truth for those versions is
the git tag and the matching `RELEASE-vX.Y.Z.md` file.
