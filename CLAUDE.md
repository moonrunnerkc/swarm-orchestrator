# CLAUDE.md

Swarm Orchestrator v13: an evidence-first coding agent. Every claim of completed work must resolve to machine-captured evidence in a tamper-evident ledger. Quality gates run and auto-resolve under a ratchet. Local model selection is measured, never guessed. Full rationale lives in docs/build-guide.md; read it before structural work.

## Commands

- `npm run typecheck` : tsc, strict, no emit
- `npm run lint` : Biome check
- `npm run format` : Biome format, write
- `npm test` : Vitest, full suite
- `npm run gates` : all of the above in sequence; this is the definition of green
- `npm run dev` : run the CLI from source against a scratch workspace

Run `npm run gates` before claiming any task complete. Paste the real output. Never summarize gate results from memory.

## Architecture Map

- `src/core` : agent loop. Plan, act, verify. All stochastic inputs (clock, random, model) injected via interfaces, never imported directly.
- `src/tools` : read, write, edit, shell, search, list. Every call goes through the chokepoint in `src/tools/chokepoint.ts`: ledger record, provenance tag, sandbox enforcement. No tool may bypass it.
- `src/evidence` : append-only JSONL ledger, hash chain, content-addressed blob store, evidence DAG, bundle export, embedded verifier, HTML review renderer.
- `src/gates` : gate definitions as data, runner, auto-resolve loop with ratchet, escalation.
- `src/providers` : the only module allowed to import the Vercel AI SDK. Frontier plus OpenAI-compatible local (Ollama, rapid-mlx). Local endpoint discovery.
- `src/select` : hardware probe, static shortlist fit, calibration micro-eval, bandit reward log.
- `src/tui` : Ink single-screen UI. Renders exclusively from ledger projections.
- `src/config` : Zod-validated swarm.toml, zero-config defaults.

## Invariants (violating any of these fails review)

1. Model output is a claim. Harness-captured output is evidence. A claim is a structured assertion: a machine-checkable predicate against a named record, evaluated by the harness, which computes the verdict. Free-text narrative always renders as unverified prose and can never render green. Missing records and unparseable predicates render UNVERIFIED; they never abort the run. UI status, gate results, and bundle verdicts derive only from harness-evaluated predicates over ledger records, never from model text.
2. The ledger is append-only. No update, no delete, no rewrite. Each record carries the previous record's hash. A failed ledger write aborts execution.
3. Every tool call passes through the chokepoint. Adding a tool means adding a definition, not a new execution path. The sandbox default-denies reads of credential paths (.env*, *.pem, *.key, .git/config, ~/.aws, ~/.ssh), and every denial is recorded as evidence.
4. Blob store is content-addressed by SHA-256. Same content, same key, no exceptions.
5. Every value entering a tool call carries a provenance tag: user, model, tool-output, or file. Derivation detection is heuristic: tool-call arguments matching untrusted content read within a recent window (substring or normalized n-gram overlap, window and threshold configurable) route through the confirmation path. Treat it as a tunable heuristic with a false-positive rate, never describe it as an information-flow guarantee.
6. Gate results are data. Gate definitions declare command, output parser, and blocking or advisory. Engine logic never special-cases a gate.
7. The ratchet is numeric. During auto-resolve: tests collected non-decreasing; assertions in touched test files non-decreasing; coverage of changed lines non-decreasing; skip markers non-increasing; no previously passing gate regresses. A retry violating any of these is rejected and the attempt still counts. One exception: a submitted test that fails on the base commit is a new specification, not tampering, and does not trip the ratchet. Ratchet measures and decisions are ledger records.
8. `src/core` has zero imports of ambient nondeterminism: no `Date.now`, no `Math.random`, no direct env reads. Inject everything.
9. Secrets never enter the ledger. The chokepoint scrubs known patterns before write. Bundle export runs the scrub gate again.
10. Zod schema at every boundary: config in, provider responses in, ledger records out, bundle manifest out.
11. The session ledger and blob store live outside the workspace (~/.swarm/sessions/\<id\>/). The sandbox denies tool writes to that path. The signing key lives in the OS keychain, never in the workspace.
12. The planner declares its intended file set as a ledger record before editing. The file check is set membership; expanding the set requires an explicit recorded amendment that surfaces in the bundle as a reviewer-visible claim.

## Code Style

- TypeScript strict, ESM, Node 22+.
- Never use em dashes anywhere: code, comments, strings, docs. Use commas, colons, parentheses, or separate sentences.
- No comments that restate the line. Comment only intent, invariants, and non-obvious decisions.
- Descriptive names, no `data`, `result`, `temp`, `helper`, `utils` grab-bags.
- Small modules with one job. If a file needs a section header comment, split it.
- Errors are typed and actionable: what failed, what the user or caller can do.
- Tests accompany every feature in the same change. Test files sit next to sources.
- No new dependencies without a one-line justification in the PR description. Prefer the standard library.

## Non-Goals (do not build these, even if they seem helpful)

No plugin system. No database. No daemon or web server. No multi-agent core (worktree workers are phase 6 only). No blocking LLM-as-judge gates. No custom inference engines. If a task seems to require one of these, stop and flag it instead of building it.

## Definition of Done

A task is done when: `npm run gates` is green with output shown, new behavior has tests, no files outside the declared file set were touched (or the amendment is recorded), no TODO or placeholder markers were introduced, and the diff is the smallest change that satisfies the task. If any of these can't be met, say so explicitly rather than approximating. 
