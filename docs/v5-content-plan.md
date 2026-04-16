# v5.0.0 Content Plan: Blog Posts and Social Media

> **Note (April 2026):** The benchmark numbers referenced in this content plan are from the legacy author-conducted evaluations. The project now uses a standardized, reproducible benchmarking system — see [benchmarks/README.md](../benchmarks/README.md). Future content should reference the new system's automated metrics and SWE-bench results instead.

Real data, real results, real narrative angles for the Swarm Orchestrator v5.0.0 release.

---

## Data Assets You Can Reference

These are all documented, verified numbers from the codebase and benchmarks.

### Hard Numbers

| Stat | Value | Source |
|------|-------|--------|
| Codebase size | 84 source files, 23,522 lines TypeScript | README |
| Test suite | 1,386 tests passing, 102 test files | RELEASE-v5.0.0 |
| Quality gates | 8 automated gates, 12 accessibility sub-checks | v4.1.0 notes |
| Agent backends | 4 (Copilot, Claude Code, Codex, Claude Code Teams) | README |
| Benchmark count | 7 head-to-head comparisons across 3 agent CLIs | benchmarks.md |
| E2E validation run | 5/5 steps passed, 0 failures, 17m 46s, clean exit | RELEASE-v5.0.0 |
| Post-validation tests | 168 passing (up from 80 pre-run) on target project | RELEASE-v5.0.0 |
| Premium request efficiency | 7 requests (orchestrated) vs 15 requests (manual) for equivalent output | benchmarks |
| Time savings | 22 min unattended vs 45 min human-supervised for parity | benchmarks |
| Bugs found during E2E | 7 real bugs discovered and fixed through dogfooding | RELEASE-v5.0.0 |

### The Killer Benchmark (PromptVault, FastAPI)

This is your strongest narrative asset. Same goal, same model, Copilot CLI vs Orchestrator:

- Orchestrator: 27 files, 841 net lines, 46 tests, 12 commits, 22 min, 7 premium requests, unattended
- Copilot CLI: 3 files, ~85 lines, 2 tests, 0 commits, 3 min, 1 premium request
- To reach parity manually: 15 premium requests, ~45 min of continuous human supervision
- The orchestrator is 2.1x cheaper in premium requests and eliminates all human review cycles

### Real Bugs Found in Copilot Output (Narrative Gold)

1. XSS in HTML templates (user-controlled satellite names rendered as raw HTML)
2. Exception leakage (raw `str(e)` returned to clients with DB paths, connection strings)
3. HTTP 200 for degraded health (Kubernetes routes traffic to broken instances)
4. `datetime.utcnow()` usage (deprecated since Python 3.12)
5. No input validation (raw dict with no type checking, unhandled KeyError = 500)

### Real Bugs Found During v5.0.0 E2E (Dogfooding Story)

1. SARIF stdout contamination (console.log interleaved with JSON)
2. Run command argument parsing (flag values leaked into goal string)
3. Double-run on plan files (plan execution triggered twice)
4. Vendored dependency test discovery (thousands of venv test files polluted prompts)
5. Verifier test command priority (Makefile before Python configs = failures in worktrees)
6. Git state sanitizer (crashed runs left unmerged files blocking subsequent runs)
7. Binary merge conflicts (.pyc files in venv causing UU/AA conflicts)

---

## Blog Post Concepts

### Post 1: "I Built a Tool That Watches AI Agents Do Their Homework"

**Angle:** The trust problem. AI generates code fast, but how do you know it works? Frame the orchestrator as the answer to "I asked Claude/Copilot to build X and it said it did, but..."

**Hook:** "AI coding agents are great at saying they did the work. They're less great at actually doing it correctly."

**Key data points:**
- Copilot returned HTTP 200 when the database was unreachable. Kubernetes would keep routing traffic to a dead instance.
- Copilot used `datetime.utcnow()`, deprecated since Python 3.12. The orchestrator's SecurityAuditor caught it.
- The XSS finding: user input rendered as raw HTML in 4 separate template blocks. A specialized security agent found all 4. A general-purpose prompt missed one.
- Verification is outcome-based: git diff, build success, test pass. Not "the agent said it was done."

**Structure:**
1. The problem: AI agents confidently produce subtly wrong code
2. Three real examples from PromptVault benchmark (XSS, 200 for unhealthy, exception leakage)
3. How verification works (evidence from transcripts, not agent claims)
4. The 8 quality gates and what they catch
5. The cost: 7 requests unattended vs 15 requests with human babysitting

**Platform:** Dev.to, Hashnode, personal blog. 1,500-2,000 words.

---

### Post 2: "7 Bugs We Found by Eating Our Own Dog Food"

**Angle:** Pure dogfooding story. You built SARIF output, then ran the tool against a real project, and the tool itself had 7 bugs that only surfaced under real conditions. Honesty and transparency play well.

**Hook:** "We shipped three new features. Then we ran the tool for real. It found 7 bugs in itself."

**Key data points:**
- SARIF stdout contamination: `console.log` mixed with JSON output. Only surfaces when `--sarif -` pipes to another tool.
- Vendored dependency discovery: the baseline scanner picked up thousands of test files from `venv/lib/python3.12/site-packages/`. Agent prompts were filled with irrelevant context.
- Binary merge conflicts: `.pyc` files tracked by git caused `UU` and `AA` conflicts during wave merges. The conflict filter only handled `UD`/`DU` patterns.
- Git state sanitizer: crashed runs left unmerged files in the index, blocking all subsequent runs.
- The double-run bug: `try-catch` block scoping caused plan-file execution to fall through and launch a second swarm.

**Structure:**
1. "We built SARIF, per-project config, and spec-aware planning. Then we tested for real."
2. Bug-by-bug walkthrough with what went wrong and why it was invisible in unit tests
3. The fix for each (one commit hash per bug)
4. Lessons: E2E testing against real projects catches things unit tests never will
5. Final validation: 5/5 steps, 168 tests, clean exit

**Platform:** Dev.to, Hacker News (self-post). 1,200-1,500 words.

---

### Post 3: "The $0.04 Problem: Why AI Agent Output Costs More Than You Think"

**Angle:** Economic argument. Premium requests cost $0.04 each over your allowance. The real cost isn't the first prompt; it's the 14 follow-up prompts to fix what the first one got wrong.

**Hook:** "Your AI agent built the feature in 3 minutes for 1 premium request. Getting it to production quality took 14 more."

**Key data points:**
- Empirically validated: predicted 13-15 follow-up prompts, actual was 14
- Total cost: 15 premium requests (manual) vs 7 (orchestrated)
- Time: 45 min human-supervised vs 22 min unattended
- The reprompting experiment was real: each prompt was executed, each output was verified
- Breakdown of what each follow-up prompt addressed: security, validation, config, tests (5 prompts just for tests), Dockerfile, CI, README
- v5.0.0 adds spec-aware planning that front-loads requirements, reducing repair cycles by an estimated 30%

**Structure:**
1. The visible cost (1 request) vs the real cost (15 requests)
2. Walk through the 14 follow-up prompts with what each one fixed
3. Why test generation is the biggest cost center (5 separate prompts)
4. How the orchestrator eliminates the human review loop
5. v5.0.0: spec-aware planning reduces even the orchestrator's repair cycles

**Platform:** LinkedIn (condensed version), Dev.to (full version). LinkedIn: 600 words. Blog: 1,500 words.

---

### Post 4: "SARIF for AI-Generated Code: Making Quality Gate Violations Show Up in Your PR"

**Angle:** Technical/practical. Show how SARIF integration makes AI code quality visible in the same GitHub code scanning flow teams already use for CodeQL.

**Hook:** "Your team already reviews CodeQL findings in PRs. Now AI coding agent violations show up in the same place."

**Key data points:**
- 8 gate types mapped to SARIF rules with `swarm/` prefixed IDs
- Schema: OASIS SARIF 2.1.0, compatible with `github/codeql-action/upload-sarif@v3`
- Gate-to-rule mapping: scaffold-defaults, duplicate-blocks, hardcoded-config, readme-claims, test-isolation, test-coverage, accessibility, runtime-checks
- GitHub Action integration: `sarif: true` in the action config
- Additive output: `--sarif` works alongside `--json` and default text
- Can pipe to stdout: `--sarif -` for CI pipeline composition

**Structure:**
1. The gap: AI code quality feedback lives in a separate world from your existing CI
2. SARIF bridges that gap (brief explainer for those who haven't used it)
3. How each gate maps to a SARIF rule
4. Example GitHub Action config (5 lines)
5. Screenshot placeholder: what a PR annotation looks like

**Platform:** Dev.to, GitHub blog/discussion. 800-1,200 words.

---

### Post 5: "3/30 to 30/30: What Happens When You Front-Load Requirements for AI Agents"

**Angle:** The core insight of the tool. Standalone agents score 3/30 not because they're bad, but because they were never asked for the other 27 things. The orchestrator asks automatically.

**Hook:** "Copilot CLI scored 3 out of 30 quality criteria on a markdown editor. Not because it's bad at coding. Because nobody told it about the other 27."

**Key data points:**
- Markdown Notes benchmark: Copilot 3/30, Orchestrator 30/30
- What Copilot delivered: editor, preview, sidebar. All functional.
- What was missing: accessibility (ARIA, keyboard nav, skip links), responsive layout, dark mode, tests (60+ vs 0), module structure (5 modules vs 1 file), markdown renderer (80-line pure function vs CDN dependency with no integrity hash)
- Calculator benchmark: Codex 6/34, Orchestrator 32/34. Codex won on visual polish and operator precedence. Orchestrator won on everything else.
- Cross-benchmark pattern: orchestrator wins on security (7/7 web benchmarks), tests (2-10x more), config externalization (7/8), infrastructure (7/8), accessibility (4/4 frontend)
- v5.0.0 spec-aware planning: the planner reads gate config and injects requirements into agent prompts before execution. Scaffold-defaults, duplicate-blocks, hardcoded-config, test coverage thresholds, accessibility requirements.

**Structure:**
1. The 3/30 result and why it's not the agent's fault
2. The benchmark table across all 7 comparisons
3. What the orchestrator injects that agents don't know to do
4. v5.0.0: the planner now reads the gate config and tells agents what matters before they start
5. The honest tradeoff: 3 min vs 22 min, 1 request vs 7, but production-ready on first pass

**Platform:** Hacker News, Dev.to, Twitter/X thread. Blog: 1,500 words. Thread: 10-12 tweets.

---

## Social Media Posts (Twitter/X, LinkedIn, Bluesky)

### Thread 1: The Benchmark Story (Twitter/X, 8-10 tweets)

1/ I gave Copilot CLI and my orchestrator the same prompt: "Add a health endpoint to this FastAPI app with tests."

Both delivered. One was production-ready. The other had XSS vulnerabilities.

Here's what happened. [thread]

2/ Copilot CLI: 3 min, 1 premium request, 3 files, 2 tests. The endpoint works. Tests pass.

Orchestrator: 22 min, 7 premium requests, 27 files, 46 tests. The endpoint works. Tests pass.

Same goal. Very different output.

3/ Copilot returned HTTP 200 when the database was down.

Kubernetes health probes interpret 200 as "this instance is healthy." Your load balancer keeps routing traffic to an instance that can't reach its database.

The orchestrator returns 503. That's the correct HTTP status for a degraded service.

4/ Copilot rendered user-controlled satellite names as raw HTML:

`html += f"<strong>{t.risk}</strong>: {t.sat1} vs {t.sat2}"`

Four separate blocks. No escaping. Direct XSS vector.

The orchestrator's SecurityAuditor agent found all four and added markupsafe.escape().

5/ Copilot used `datetime.utcnow()` (deprecated since Python 3.12) and `time.time()` (affected by NTP clock adjustments, can report negative uptime).

The orchestrator used `datetime.now(timezone.utc)` and `time.monotonic()`.

Small things. Production things.

6/ To bring Copilot's output to parity, I predicted 13-15 follow-up prompts. Then I actually did it.

Result: 14 follow-up prompts. 15 total premium requests. ~45 minutes of continuous human supervision.

vs 7 requests, 22 minutes, zero human intervention.

7/ The biggest cost: test generation. 5 separate prompts just to get test coverage across all modules. Each test file needs correct imports, fixtures, and assertions for the specific project layout.

The orchestrator's TesterElite agent handles this in one step.

8/ v5.0.0 adds spec-aware planning. The planner reads quality gate config and injects requirements into agent prompts BEFORE execution.

"No hardcoded URLs." "Include ARIA attributes." "Achieve test coverage above threshold."

Fewer repair cycles. Fewer premium requests.

---

### Thread 2: The Dogfooding Story (Twitter/X, 6 tweets)

1/ We shipped 3 features for Swarm Orchestrator v5.0.0. Then we ran it against a real FastAPI project with 5 coordinated agents.

It found 7 bugs in our own tool. [thread]

2/ Bug 1: SARIF stdout mode. `console.log` statements mixed into the JSON output. Invalid SARIF. Only happens when piping to another tool with `--sarif -`.

Unit tests passed. E2E caught it.

3/ Bug 2: The baseline scanner picked up thousands of test files from `venv/lib/python3.12/site-packages/`. Agent prompts were stuffed with irrelevant context from vendored dependencies.

4/ Bug 3: Binary merge conflicts. `.pyc` files tracked by git caused `UU` and `AA` conflict patterns during wave merges. Our conflict filter only handled `UD`/`DU`. Binary files broke the entire merge pipeline.

5/ Bug 4: Plan files triggered execution twice. The `try-catch` around plan detection also wrapped execution, so after a plan-file run completed, it fell through to the goal-based path and launched a second swarm.

6/ All 7 fixed. Final validation: 5/5 steps, 17m 46s, 168 tests passing on the target project (up from 80). Clean git state.

Unit tests catch logic. E2E against real codebases catches everything else.

---

### LinkedIn Posts

**Post 1: The Economics Post**

Your AI coding agent built the feature in 3 minutes for 1 premium request.

Getting it to production quality? 14 more prompts. 45 minutes of your time reviewing each output and writing the next follow-up.

We tested this empirically. Same goal, same model, same codebase.

Orchestrated: 7 premium requests, 22 minutes, zero human review cycles.

Manual iteration: 15 premium requests, 45 minutes, continuous supervision.

The 5 test-generation prompts alone took longer than the entire orchestrated run.

v5.0.0 of Swarm Orchestrator now reads quality gate configuration before generating plans. The planner tells agents about security requirements, test coverage thresholds, and accessibility standards upfront. Fewer repair cycles, fewer wasted requests.

The tool is open source: github.com/moonrunnerkc/swarm-orchestrator

---

**Post 2: The Quality Gate Post**

AI-generated code needs the same review pipeline as human-written code. We just shipped SARIF output for Swarm Orchestrator's quality gates.

8 automated gates (scaffold leftovers, duplicate blocks, hardcoded config, README accuracy, test isolation, test coverage, accessibility, runtime checks) now export SARIF 2.1.0 JSON. Upload to GitHub code scanning. Get inline PR annotations for every violation.

Same workflow your team uses for CodeQL. Same annotations view. Different source.

Works as a CLI flag (`--sarif results.sarif`) or in the GitHub Action (`sarif: true`).

Per-project configuration via `.swarm/gates.yaml`. Override thresholds, disable gates that don't apply. Resolution: defaults, then project config, then CLI flags. Unknown gate names get a clear error.

Details in the v5.0.0 release notes.

---

## Recommended Posting Sequence

| Day | Platform | Content | Goal |
|-----|----------|---------|------|
| 1 | Twitter/X | Thread 1 (Benchmark Story) | Hook with concrete, surprising data |
| 1 | LinkedIn | Post 1 (Economics) | Professional audience, cost angle |
| 2 | Dev.to | Post 1 (Trust Problem) or Post 5 (3/30 to 30/30) | Long-form with full benchmark data |
| 3 | Twitter/X | Thread 2 (Dogfooding Story) | Authenticity, honesty about bugs |
| 4 | Dev.to | Post 2 (Dogfooding) | Technical depth on real E2E findings |
| 5 | LinkedIn | Post 2 (SARIF/Quality Gates) | CI/CD integration angle for teams |
| 7 | Dev.to | Post 4 (SARIF Technical) | How-to for teams already using code scanning |
| 10 | HN | Post 3 or 5 (submit as Show HN) | "Show HN: Tool that verifies AI agent output with evidence-based quality gates" |

---

## Title Options (Ranked by Engagement Potential)

### Blog Titles
1. "3/30 to 30/30: What Happens When You Front-Load Requirements for AI Agents"
2. "7 Bugs We Found by Running Our AI Tool Against a Real Project"
3. "$0.04 Per Request: The Hidden Cost of Iterating with AI Coding Agents"
4. "I Built a Verification Layer for AI Coding Agents. Here's What It Catches."
5. "Copilot Built the Feature in 3 Minutes. It Took 14 More Prompts to Make It Safe."
6. "SARIF for AI Code: Quality Gate Violations as PR Annotations"
7. "22 Minutes Unattended vs 45 Minutes Supervised: The Real Cost of AI Coding"

### Show HN / Hacker News
1. "Show HN: Swarm Orchestrator, verification and quality gates for AI coding agents"
2. "Show HN: I tested how many prompts it takes to fix AI-generated code. It was 14."
3. "Show HN: 8 quality gates that run on every AI coding agent's output"

### Twitter/X Thread Hooks
1. "I gave the same prompt to Copilot CLI and 5 coordinated agents. One output had XSS." 
2. "Your AI agent returned HTTP 200 for a health check when the database was down."
3. "We shipped 3 features, then ran the tool for real. It found 7 bugs in itself."
4. "AI agents score 3/30 on quality criteria. Not because they're bad. Because nobody asked."
5. "14 follow-up prompts. That's what it takes to match automated orchestration."

---

## Key Narrative Principles

1. **Lead with real bugs, not features.** The XSS finding, the 200-for-unhealthy, the exception leakage. These are concrete and surprising.

2. **Always acknowledge the tradeoff.** 3 min vs 22 min. 1 request vs 7. Don't pretend the orchestrator is "free." The value is unattended production-quality output.

3. **Cite the empirical validation.** The 14-prompt reprompting experiment is rare. Most tools claim savings; you measured them.

4. **Dogfooding builds trust.** 7 real bugs found in your own tool during E2E validation. This is an authenticity signal.

5. **The agents aren't bad.** The orchestrator wraps the same models. The difference is front-loaded requirements and post-execution verification. Frame it as "system-level output" not "model comparison."

6. **Benchmark 7 (Logwatch) shows honesty.** Claude Code scored 30/50, orchestrator 35/50. The narrowest gap. Claude Code's async tailer was better engineering. Acknowledge where standalone agents win.
