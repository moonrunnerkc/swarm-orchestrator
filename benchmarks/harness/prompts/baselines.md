# Baseline Agent Prompts — Benchmark Configuration

> Exact prompts given to standalone agents (Copilot CLI, Claude Code, Codex) during benchmark evaluations. Published for full transparency per ABC compliance (§4.1).

---

## Protocol

Baseline agents receive **only the goal prompt** with no additional requirements. No security headers, no accessibility, no infrastructure files, no test depth requirements. This is by design — it measures what standalone agents produce when given a typical user request.

---

## SWE-bench Tasks

For SWE-bench evaluations, the baseline agent receives the `problem_statement` field verbatim:

```
<problem_statement from SWE-bench dataset>
```

No system prompt wrapping, no requirement injection. The agent CLI is invoked as:

### Copilot CLI
```bash
copilot -p "<problem_statement>"
```

### Claude Code
```bash
claude-code "<problem_statement>"
```

### Codex
```bash
codex "<problem_statement>"
```

---

## Legacy Tasks (Original 8 Benchmarks)

Each legacy benchmark used an identical goal prompt for both orchestrator and baseline. The exact prompts:

### Benchmark 1: PromptVault REST API
```
Add a /api/health endpoint to the FastAPI app that returns JSON with server uptime, database connectivity status, and current UTC timestamp. Include a test file with pytest tests covering the happy path and database-unavailable error case.
```

### Benchmark 2: Markdown Note-Taking App
```
Build a browser-based markdown editor with live preview, note sidebar (CRUD), persistence, word/character count.
```

### Benchmark 3: Tic-Tac-Toe
```
Build a 3x3 tic-tac-toe game with alternating X/O, win detection, and a reset button.
```

### Benchmark 4: Calculator App
```
Build a calculator with digits, operators, chained operations, keyboard input, and a history panel.
```

### Benchmark 5: REST API Backend for Ledger Calculator
```
Build an Express API with health, CRUD for calculations, JSON file storage, input validation, error handling, CORS, and tests.
```

### Benchmark 6: REST API Backend for Markdown Notes
```
Build an Express API with CRUD for notes, JSON file storage, input validation, error handling, CORS, and tests.
```

### Benchmark 7: REST API Backend for Vanilla Calculator
```
Build an Express API with CRUD for calculation history, a stats endpoint, JSON file storage, validation, error handling, CORS, and tests.
```

### Benchmark 8: CLI Tool, Logwatch
```
Build a CLI tool that tails a log file in real time, filters by severity, JSON mode with pretty-printing, stats on exit, error handling, and tests.
```

---

## Important Context

- Baseline agents are **not penalized** for omitting things they were never asked for. The comparison measures system-level output completeness.
- The orchestrator's advantage comes from requirement injection (security, tests, infrastructure, accessibility) and quality gate enforcement — not from superior model capability.
- Standalone agents may produce architecturally superior code (e.g., factory patterns, async I/O, operator precedence) that the orchestrator misses.
