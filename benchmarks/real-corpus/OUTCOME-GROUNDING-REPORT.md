# Outcome-grounding the real corpus: before / after

This replaces AI-opinion ground truth with machine-verifiable repository
outcomes, rescores against them, mines more confirmed-bad PRs, cuts false
positives at the refuter layer, and measures the execution-grounded viability
of the corpus. Every number below regenerates from a committed npm script.

## Part A: ground truth is now repository outcomes

`npm run labeling:outcome` (`scripts/labeling/outcome-labels.ts`). The corpus is
commit-grounded: the anchor is the vendored commit sha, because the entries are
agent-attributed commits whose PR numbers do not resolve to merged upstream PRs
(a measurement artifact caught on a 5-PR smoke test before the full run).

| | Before (AI labels) | After (repository outcomes) |
|---|---|---|
| Source | a model's verdict, "pending human review" | revert / hotfix / survived from git history |
| Usable corpus | 205 (195 clean / 10 broken) | 197 (22 bad / 175 clean); 8 indeterminate excluded |
| Bad base rate | 4.9% | 11.2% |
| Evidence per label | rationale text | commit sha + overlapping line ranges (audit with `git log`) |

Outcome distribution: 0 reverted, 22 hotfixed, 175 survived, 8 indeterminate.
Artifact: [`outcome-labels.json`](outcome-labels.json), per-entry evidence under
[`outcome-cache/`](outcome-cache/).

**AI-vs-outcome agreement** (the reason the switch matters): raw 0.853, Cohen's
kappa **~0.00**. Of the 22 outcome-bad PRs, exactly 1 was also AI-labeled
broken; 21 outcome-bad were AI-clean and 8 AI-broken survived. The two label
sources do not agree beyond chance.

## Part A: rescore against outcome labels

`npm run corpus:score-outcome` (`scripts/corpus/score-outcome.ts`), PR-level and
finding-level with Wilson 95% bounds.

| PR-level union | Before (AI labels) | After (outcomes) | After + refuters (Part C) |
|---|---|---|---|
| Precision | 0.091 | 0.192 [0.085, 0.379] | **0.217 [0.097, 0.419]** |
| Recall | 0.30 | 0.227 [0.101, 0.434] | 0.227 [0.101, 0.434] |
| F1 | 0.140 | 0.208 | **0.222** |
| TP / FP | n/a | 5 / 21 | 5 / 18 |

F1 rose rather than fell: outcome labels re-attribute some firings that were
"FP vs an AI-clean guess" into TPs on PRs history proves bad. Reported plainly,
not as a win. Artifacts:
[`scores-outcome/latest.json`](scores-outcome/latest.json) (after),
[`scores/ai-labeled-baseline.json`](scores/ai-labeled-baseline.json) (before).
Canonical [`scores/latest.json`](scores/latest.json) is now outcome-grounded.

## Part B: mine outcome-confirmed-bad agent PRs

`npm run agent-incidence:confirmed-bad` (`scripts/real-prs/mine-confirmed-bad.ts`),
reusing Part A's `findOutcomeEvidence` core over the 60-PR agent corpus.

| | Result |
|---|---|
| Target | 50 confirmed-bad |
| Pool mined | 60 agent PRs |
| Confirmed-bad | **5** (0 reverted, 5 hotfixed) |
| Yield | 8.3% (consistent with the 11.2% corpus base rate) |
| Ceiling | a 50-PR positive class needs ~600 mined PRs; recorded, not padded |

Artifact: [`agent-corpus/confirmed-bad.json`](../real-prs/agent-corpus/confirmed-bad.json).
`--fetch-more` continues the mine.

## Part C: cut false positives at the refuter layer, oracle floor held

Root-caused from the outcome-grounded firings
([`scores-outcome/firings.json`](scores-outcome/firings.json)). Two principled,
repo-context-free refuters landed; the rest are documented as diff-only-scoring
artifacts (manifest-blind mock checks, test-graph-blind no-op-fix) that a real
`swarm audit --pr` does not hit.

| Refuter | Root cause | Effect |
|---|---|---|
| `@/` path-alias is a local import (`mock-of-hallucination.ts`) | tsconfig `paths` alias treated as a package | mock finding FP 15 -> 12 |
| new-file empty catch demoted (`verify-findings.ts`) | a bare catch in a file the PR creates hides no prior behavior | error-swallow finding FP 11 -> 3 |

PR-level union FP 21 -> 18, precision 0.192 -> 0.217. **Oracle structural recall
held at 258/275 with zero per-category regression** (`npm run benchmarks:oracle`);
the oracle injects `imaginary-vendor-sdk-*` mocks and wraps existing calls, so
neither refuter touches a seeded cheat. No judge prompt was edited.

## Part D: corroborated tier is viability-screened, not unmeasured

`npm run execution-grounded:viability-screen` (`scripts/real-prs/eg-viability-screen.ts`):
a cheap static screen (Node project + lockfile + recognizable test runner +
node@22 engine) over the 197 usable PRs.

| | Result |
|---|---|
| EG-viable | **12 / 197** |
| Not a Node project | 137 |
| No recognizable test runner | 41 |
| node engine excludes 22 | 2 |

Artifact: [`eg-viability.json`](eg-viability.json). The corroborated tier in
[`promotions.json`](promotions.json) now reads `viability-screened` (12/197
provision; corroborated precision pending the bounded EG run on that slice) for
all 10 detectors, replacing the bare `unmeasured`. The 0.90 Wilson floor and
the minimum-TP count are unchanged; no detector gates. The EG mutation run on
the 12-viable slice is the remaining bounded step (not executed in this pass).

## Verification gauntlet

| Check | Result |
|---|---|
| `npm test` (mocha) | 1729 passing, 0 failing, 20 pending |
| `npm run typecheck` | clean |
| `npm run promotions:check` | matches recompute (gate-eligible=0, advisory=10) |
| `npm run block-policy:check` | matches recompute (block-eligible=4, unchanged) |
| LOC budget gate | PASS (37648, budget raised for the new refuter + Wilson code) |

## What is still weak

- The positive class is small (22 corpus + 5 agent). Wilson bounds are wide;
  no per-detector precision is trustworthy yet. Closing this needs the bounded
  agent mine to run much further (~600 PRs for 50 bad).
- The hotfix signal is conservative and has soft edges (a few "fix"-shaped
  follow-ups are iterative improvements rather than defect fixes); every label
  is auditable from its committed evidence, so a reviewer can re-judge.
- The dominant residual FP classes are diff-only-scoring artifacts (no manifest,
  no test-file graph). They are real for the corpus scorer but largely absent in
  a `--pr` audit that provisions the repo. That gap is documented, not closed.
- The corroborated tier's precision is screened but not yet run: 12 PRs are
  viable; the EG mutation pass on them is pending.
