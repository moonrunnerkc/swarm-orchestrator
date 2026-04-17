# Completeness Rubric

Primary measurement instrument for the swarm-orchestrator benchmark.
Every attribute is binary, machine-verifiable from artifacts in the
produced directory, and applicable only to tasks whose metadata
declares it.

## How It Works

1. A task declares `applicable_attributes` — a subset of the
   attribute IDs below.
2. The rubric runner evaluates only those attributes.
3. `rubric_score = count(present AND applicable) / count(applicable)`.
4. The same rubric runs against ANY artifact directory regardless of
   which producer created it (orchestrator, single-shot, or ladder).

## Canonical Attribute Order

This fixed order drives the iterative-ladder baseline. When the
ladder needs the "next missing attribute," it walks this list
top-to-bottom and picks the first applicable attribute that is not
present.

---

## Attribute Groups

### Security

| ID | Attribute | Check | Governing Standard |
|----|-----------|-------|--------------------|
| `SEC-INPUT` | Input validation on all user-facing endpoints | Grep for validation middleware/decorators; verify no raw `req.body` pass-through | OWASP ASVS V5 |
| `SEC-NOSECRETS` | No secrets/credentials in source | Regex scan for API keys, passwords, tokens in non-`.env` files | OWASP ASVS V2.10 |
| `SEC-SARIF` | SARIF security scan clean | Run quality gate `runtime-checks` with `runAudit: true`; zero error-level findings | OWASP ASVS V14 |
| `SEC-DEPS` | Dependency audit clean | `npm audit --audit-level=moderate` or `pip-audit` exits 0 | OWASP ASVS V14.2 |
| `SEC-AUTHN` | Authentication present (if user-facing) | Auth middleware/decorators on protected routes | OWASP ASVS V3 |
| `SEC-AUTHZ` | Authorization/RBAC present (if user-facing) | Role checks on restricted endpoints | OWASP ASVS V4 |

### Wiring

| ID | Attribute | Check | Governing Standard |
|----|-----------|-------|--------------------|
| `WIRE-START` | Clean start (process boots without error) | `npm start` / `python -m app` exits cleanly or binds port | 12-Factor III |
| `WIRE-ROUTES` | All declared routes reachable | Parse route definitions, hit each with curl or supertest | 12-Factor VII |
| `WIRE-ENV` | Environment variable contract documented and enforced | `.env.example` or similar exists; code reads from `process.env`/`os.environ` | 12-Factor III |
| `WIRE-DB` | Database migrations (if DB used) | Migration files present and runnable | 12-Factor IV |

### Testing

| ID | Attribute | Check | Governing Standard |
|----|-----------|-------|--------------------|
| `TEST-EXIST` | Tests exist | At least one test file matching `*.test.*`, `test_*.py`, etc. | — |
| `TEST-COV` | Coverage meets threshold | Existing `test-coverage` quality gate; threshold from config | — |
| `TEST-PASS` | All tests pass (CI-equivalent) | Existing `runtime-checks` gate with `runTests: true` | — |
| `TEST-NOMOD` | No test-file modifications beyond additions | `git diff` shows no modified (only added) test files vs base | — |

### Error Handling

| ID | Attribute | Check | Governing Standard |
|----|-----------|-------|--------------------|
| `ERR-NOBARE` | No bare catch/except | AST or regex scan for `catch {}`, `except:`, `catch(e) {}` with empty body | — |
| `ERR-STRUCT` | Structured error responses | Error middleware returns JSON with `error`/`message` fields; no raw stack traces | — |
| `ERR-UNHANDLED` | Unhandled-rejection/exception handlers | `process.on('unhandledRejection')` or framework equivalent present | — |

### Accessibility (UI tasks only)

| ID | Attribute | Check | Governing Standard |
|----|-----------|-------|--------------------|
| `A11Y-AXE` | axe-core scan clean | Existing `accessibility` quality gate (11 sub-checks) | WCAG 2.2 AA |
| `A11Y-SEMANTIC` | Semantic HTML | `<nav>`, `<main>`, `<header>`, `<footer>` present; no `<div>` soup | WCAG 2.2 AA 1.3.1 |

### Production Readiness

| ID | Attribute | Check | Governing Standard |
|----|-----------|-------|--------------------|
| `PROD-DEPLOY` | Deploy artifact present | `Dockerfile`, `docker-compose.yml`, or equivalent build config | 12-Factor V |
| `PROD-LOG` | Structured logging | JSON log output or structured logger dependency (winston, pino, structlog) | 12-Factor XI |
| `PROD-README` | README documents the change | README updated with new endpoints/features/usage | — |

---

## Check Function Contract

Each attribute has a check function at
`benchmarks/harness/scoring/checks/<attribute_id>.sh` (or `.py`/.ts).

**Signature (shell):**
```bash
# Arguments: $1 = artifact directory, $2 = task metadata JSON path
# Exit code: 0 = present, 1 = not present, 2 = not applicable
# Stdout: JSON { "attribute_id": "...", "applicable": bool, "present": bool, "evidence_path": "..." }
```

**Gate reuse rule:** Where an existing quality gate already measures
the attribute, the check function invokes that gate runner.
Specifically:

| Attribute | Existing Gate Consumed |
|-----------|----------------------|
| `SEC-SARIF` | `runtime-checks` (runAudit) |
| `SEC-DEPS` | `runtime-checks` (runAudit) |
| `TEST-COV` | `test-coverage` gate |
| `TEST-PASS` | `runtime-checks` (runTests) |
| `A11Y-AXE` | `accessibility` gate |
| `TEST-NOMOD` | (New — uses git diff) |
| `SEC-NOSECRETS` | `hardcoded-config` gate |

New checks required only for: `SEC-INPUT`, `SEC-AUTHN`, `SEC-AUTHZ`,
`WIRE-START`, `WIRE-ROUTES`, `WIRE-ENV`, `WIRE-DB`, `ERR-NOBARE`,
`ERR-STRUCT`, `ERR-UNHANDLED`, `A11Y-SEMANTIC`, `PROD-DEPLOY`,
`PROD-LOG`, `PROD-README`.
