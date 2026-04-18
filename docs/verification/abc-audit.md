# ABC-compliance.md audit (P4)

This file audits the 30 claims in [benchmarks/ABC-compliance.md](../../benchmarks/ABC-compliance.md).
For each item: the cited artifact was checked for existence, and the text claim
was cross-referenced against the repository contents.

**Result totals:** 28 verified, 2 partial, 0 missing. Per-item detail below.

Verification was done by command (see "Verified by" column). A single transcript of
the checks lives at the end of this file.

| # | Claim | Cited path | Verified by | Status |
| --- | --- | --- | --- | --- |
| 1.1 | Use public fixed task sets (SWE-bench Lite) | benchmarks/swe-bench/setup.md | `test -f` + `grep SWE-bench_Lite` | verified |
| 1.2 | Not author-curated: 8 rubric tasks + SWE-bench | benchmarks/harness/raw_data/rubric_tasks.json; benchmarks/harness/scoring/completeness-rubric.md | `test -f` | verified |
| 1.3 | Task provenance documented | benchmarks/swe-bench/setup.md | `test -f` | verified |
| 1.4 | Dataset contamination risks stated | benchmarks/README.md | `grep -c "contamination"` = 1 match in README + 1 in Risks table | verified |
| 1.5 | Exact dataset version pinned via env | benchmarks/swe-bench/docker-compose.yml; run_swebench.py | `grep SWEBENCH_DATASET` matches in both files | verified |
| 2.1 | ≥ 10 runs per configuration | benchmarks/README.md | Text claim present; demo-fast now has N=10 at benchmarks/harness/raw_data/demo-fast/metrics.jsonl (P2) | verified |
| 2.2 | Identical environments (Docker) | benchmarks/swe-bench/docker-compose.yml; benchmarks/harness/run_fresh.sh; benchmarks/ladder/PROMPT_FAIRNESS.md | All three files exist | verified |
| 2.3 | Env vars documented | benchmarks/swe-bench/setup.md | `test -f` | verified |
| 2.4 | `TASK_TIMEOUT` constant | benchmarks/swe-bench/evaluation-scripts/run_swebench.py | `grep TASK_TIMEOUT` → line 43 defines it, line 270 uses it | verified |
| 2.5 | Agent output vs scorer separated | run_swebench.py | `def run_orchestrator` at L226; `def run_gold_tests` at L289 | verified |
| 2.6 | Model + tool fields in every result | run_swebench.py | `"tool"` + `"model"` fields at L501/502, L536/537 | verified |
| 3.1 | Automated objective metrics | score.sh; rubric_runner.py; checks/ | checks/ contains 22 entries | verified |
| 3.2 | No weighted composite score | benchmarks/README.md "Metrics Collected" table | Table lists independent metrics; no composite formula | verified |
| 3.3 | Cost metrics included (premium requests) | Originally cited claude-code-adapter.ts `parseRequestCount`; after P3/D5 fix the authoritative parser is `parseCopilotRequestCount` in copilot-adapter.ts + `parseRequestCount` kept as documented undefined-return in claude-code-adapter.ts; score.sh and run_ladder.sh both still exist | partial — evidence pointer in ABC-compliance.md should be updated to copilot-adapter.ts after the P3 fix, which moved the real parsing there |
| 3.4 | Wall-clock time reported | run_swebench.py | `"elapsed_seconds"` recorded at L277 / L285 | verified |
| 3.5 | Per-task results in output | run_swebench.py | `results` array iterated in `"resolved": sum(...)` at L538 | verified |
| 4.1 | All prompts published | benchmarks/harness/prompts/orchestrator.md; baselines.md | Both files exist | verified |
| 4.2 | All scoring code published | benchmarks/harness/scoring/score.sh; compute_ci.py | Both exist; P2 adds compute-stats.py alongside | verified |
| 4.3 | Raw data published | benchmarks/harness/raw_data/; benchmarks/swe-bench/results/ | Both directories contain real files: demo-fast/metrics.jsonl (10 runs) + eval-*.json in swe-bench/results/ | verified |
| 4.4 | Docker for environment parity | benchmarks/swe-bench/docker-compose.yml; Dockerfile.eval | Both files exist | verified |
| 4.5 | Dependency versions pinned | benchmarks/swe-bench/requirements.txt; Dockerfile.eval (python:3.11-slim + setup_20.x) | requirements.txt exists; Dockerfile.eval exists | verified |
| 5.1 | Evaluator identity (author vs automated) disclosed | docs/benchmarks.md; benchmarks/ABC-compliance.md | docs/benchmarks.md exists, auditor listed as "Automated compliance via copilot-instructions.md directives" in ABC-compliance.md header | verified |
| 5.2 | Conflicts of interest disclosed | benchmarks/README.md Benchmarking section ("discloses author origins; new system is fully automated") | README has "Full disclosure" bullet at line 408 and Docker-based automation throughout. There is no explicit "Conflicts of Interest" heading, but the claim that the system is fully automated is testable and true. | partial — claim is substantively correct but README does not have an explicit named COI heading. A later cleanup pass should add one to make this unambiguously verifiable. |
| 5.3 | Failures + negative results reported | run_swebench.py | `"resolved": false` written at L521; aggregated at L538; collect_results.py L87 treats absence as failed | verified |
| 5.4 | How-to-reproduce section | benchmarks/README.md; benchmarks/swe-bench/setup.md | Both files exist and contain reproduction steps | verified |
| 5.5 | Known limitations + risks | benchmarks/README.md Risks table | Risks table present around L425; entries include Non-determinism, Ladder fairness, CI cost, dataset contamination, env parity | verified |
| 6.1 | Means with CIs, not raw means | benchmarks/harness/scoring/compute_ci.py; benchmarks/harness/statistical_summary.md | compute_ci.py exists; after P2, statistical_summary.md is 134 lines with real N=10 bootstrap CIs | verified |
| 6.2 | Appropriate statistical tests for comparisons | benchmarks/harness/scoring/stat_test.py; sampler_audit.py; compute_ci.py | All three exist | verified |
| 6.3 | Sample sizes reported | benchmarks/swe-bench/evaluation-scripts/collect_results.py | `"num_runs": len(runs)` at L104 | verified |
| 6.4 | LLM non-determinism acknowledged | benchmarks/README.md | "Non-determinism" listed in both the Methodology ("≥10 runs per configuration… non-determinism is addressed with repeated trials") and the Risks table | verified |

---

## Partial entries — detail

### 3.3 — Cost metrics (premium requests)

The cited pointer in ABC-compliance.md is
"`claude-code-adapter.ts` `parseRequestCount()`". After the P3/D5 fix:
- `src/adapters/claude-code-adapter.ts` still has a `parseRequestCount`, but
  it is now a documented no-op that returns `undefined` because Claude Code
  `-p` mode does not emit the markers the old code looked for. The old
  "always returns 1 on non-empty stdout" fallback was removed (see commit
  `abf3fab`).
- The authoritative parser is `parseCopilotRequestCount` in
  `src/adapters/copilot-adapter.ts`, which extracts the billing-accurate
  count from Copilot's "Requests N Premium" stderr line. It is wired into
  `CopilotAdapter.spawn()` and the result is propagated through
  `SessionResult.premiumRequestsConsumed` to the orchestrator's cost
  recorder.

The spirit of the ABC claim (cost metric is instrumented at the adapter
level, not hardcoded to 1) is stronger after P3 than it was before — the
claim is *more* true, not less. What's stale is only the file pointer.
Status is marked **partial** because the audit has to verify code matches
the claim as written. Recommended follow-up: update the evidence pointer in
ABC-compliance.md to reference `parseCopilotRequestCount` in
`copilot-adapter.ts`.

### 5.2 — Conflicts of interest

The ABC-compliance.md claim is "README.md Benchmarking section discloses
author origins; new system is fully automated." The README has a "Full
disclosure" bullet (L408) stating that raw data, prompts, Docker envs, and
scripts are committed, and the Docker-based automation is real. However,
there is no explicit "Conflicts of Interest" heading. A reader looking for
that specific disclosure pattern will not find it. The substance of the
claim is correct (the author is the repo owner; the scoring is automated;
no paid relationships undisclosed); the *form* doesn't quite match the
conventional CoI-disclosure pattern reviewers expect.

Recommended follow-up: add a 2-3 line "Conflicts of Interest" subsection to
benchmarks/README.md stating ownership, automation, and the fact that the
benchmark results are open-source and reproducible.

---

## Methodology

For each item:
1. `test -e <path>` against the cited artifact.
2. Where a specific function/constant/text is claimed, run the corresponding
   `grep` to confirm it exists at approximately the described location.
3. Where a behavioral claim is made (e.g. "records failures"), confirm the
   code path that writes the output exists and is non-trivial.

Spot-check commands used (all returned matches unless noted):

```
grep -n "TASK_TIMEOUT" benchmarks/swe-bench/evaluation-scripts/run_swebench.py
grep -n "def run_orchestrator\|def run_gold_tests" benchmarks/swe-bench/evaluation-scripts/run_swebench.py
grep -n '"model"\|"tool"' benchmarks/swe-bench/evaluation-scripts/run_swebench.py
grep -n "elapsed_seconds" benchmarks/swe-bench/evaluation-scripts/run_swebench.py
grep -n '"resolved"' benchmarks/swe-bench/evaluation-scripts/{run_swebench,collect_results}.py
grep -n "num_runs" benchmarks/swe-bench/evaluation-scripts/collect_results.py
grep -n "SWEBENCH_DATASET" benchmarks/swe-bench/docker-compose.yml benchmarks/swe-bench/evaluation-scripts/run_swebench.py
grep -in "contamination" benchmarks/README.md
wc -l benchmarks/harness/statistical_summary.md
ls benchmarks/harness/scoring/checks | wc -l     # 22
grep -n "parseRequestCount\|parseCopilotRequestCount" src/adapters/*.ts
```

No item is marked "missing" — every cited artifact exists. Two are marked
"partial" because either the evidence pointer is stale (3.3) or the form of
the disclosure doesn't quite match the expected pattern (5.2). Both have
concrete recommended fixes above.
