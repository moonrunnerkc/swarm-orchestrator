# Orchestrator System Prompt — Benchmark Configuration

> This is the exact prompt context injected by swarm-orchestrator before any agent executes a benchmark task. Published for full transparency per ABC compliance (§4.1).

---

## Pre-execution Injection (applied to every agent in the swarm)

The orchestrator prepends the following requirement blocks to every agent prompt before execution. These are derived from the agent YAML profiles in `config/default-agents.yaml` and the quality gate configuration in `config/quality-gates.yaml`.

### Security Requirements (SecurityAuditor agent scope)

```
You MUST implement the following security measures:
- Add security headers middleware (CSP, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy)
- Configure CORS from environment variables, not hardcoded origins
- Escape all user-controlled content rendered in HTML (use markupsafe.escape or equivalent)
- Add input validation schemas (Pydantic, Joi, Zod, or equivalent) with field-level constraints
- Set body size limits on all endpoints accepting input
- Sanitize error messages — never return str(e), stack traces, or internal paths to clients
- Validate and sanitize path/ID parameters with regex patterns
```

### Testing Requirements (TesterElite agent scope)

```
You MUST create comprehensive tests:
- Unit tests for every new module/function (not just integration tests)
- Edge case coverage: empty inputs, boundary values, malformed data, error paths
- Test isolation: each test resets mutable state (fixtures, beforeEach, tmp directories)
- Minimum: happy path + error path + boundary for every endpoint/function
- Tests must pass without external service dependencies (mock at boundaries)
```

### Infrastructure Requirements (DevOpsPro agent scope)

```
You MUST add production infrastructure:
- Dockerfile with layer caching, non-root user, tini/dumb-init
- CI pipeline (GitHub Actions) with lint, test, build, and Docker build stages
- .dockerignore excluding secrets, .env, node_modules, .git
- .gitignore appropriate for the language/framework
- .env.example documenting every environment variable
```

### Configuration Requirements (all agents)

```
All environment-dependent values MUST come from environment variables:
- Database URLs, API keys, CORS origins, ports, log levels
- Create a centralized config module that reads and validates env vars
- Never hardcode localhost, port numbers, or credentials
```

### Accessibility Requirements (FrontendExpert agent scope, web projects only)

```
For web projects, you MUST implement:
- ARIA labels on interactive elements
- Keyboard navigation (Tab, Enter, Escape, arrow keys where appropriate)
- focus-visible styles
- Skip link for main content
- prefers-reduced-motion media query
- prefers-color-scheme (dark mode) media query
- Semantic HTML (nav, main, section, article, button vs div)
```

---

## Goal Prompt

The goal prompt is passed identically to both the orchestrator and baseline agents. For SWE-bench tasks, this is the `problem_statement` field from the dataset. For legacy tasks, the exact goal text is recorded in `harness/raw_data/legacy_tasks.json`.

---

## Quality Gate Post-Processing

After agent execution, the orchestrator runs 8 automated quality gates:

1. `scaffold-defaults` — No placeholder/todo/fixme markers left
2. `duplicate-blocks` — No excessive duplicate code blocks
3. `hardcoded-config` — No hardcoded ports, URLs, credentials
4. `readme-claims` — README claims match actual implementation
5. `test-isolation` — Tests reset mutable state properly
6. `test-coverage` — Tests exist and pass
7. `accessibility` — ARIA attributes, keyboard handlers present (web projects)
8. `runtime-correctness` — Build succeeds, tests pass, no crash on startup

Gates that fail trigger the repair loop (up to 3 retries with accumulating context).
