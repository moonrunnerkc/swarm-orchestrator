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

- `src/agent-run.ts` : one task start to finish (sandbox, tools, chokepoint, loop, gates). The CLI and every parallel worker call this same function; a worker differs only in its directory and its chain.
- `src/core` : agent loop. Plan, act, verify. All stochastic inputs (clock, random, model) injected via interfaces, never imported directly.
- `src/tools` : read, write, edit, shell, search, list. Every call goes through the chokepoint in `src/tools/chokepoint.ts`: ledger record, provenance tag, sandbox enforcement. No tool may bypass it.
- `src/evidence` : append-only JSONL ledger, hash chain, content-addressed blob store, evidence DAG, bundle export, embedded verifier, HTML review renderer.
- `src/gates` : gate definitions as data, runner, auto-resolve loop with ratchet, escalation.
- `src/providers` : the only module allowed to import the Vercel AI SDK. Frontier plus OpenAI-compatible local (Ollama, rapid-mlx). Local endpoint discovery.
- `src/select` : hardware probe, static shortlist fit, calibration micro-eval, bandit reward log.
- `src/workers` : phase 6 scale-out. Git worktree per worker, each running the ordinary loop from `src/agent-run.ts`, and a merge queue that lands them sequentially under the ratchet. Nothing here is imported by the single-agent path.
- `src/tui` : Ink single-screen UI. Renders exclusively from ledger projections.
- `src/config` : Zod-validated swarm.toml, zero-config defaults.

## Invariants (violating any of these fails review)

1. Model output is a claim. Harness-captured output is evidence. A claim is a structured assertion: a machine-checkable predicate against a named record, together with the kind of record it asserts against, evaluated by the harness, which computes the verdict. The harness recomputes the cited record's kind and rejects a claim whose declared kind does not match, as UNVERIFIED with the sub-reason predicate-kind-mismatch. A payload digest has to name one record for that to mean anything: identical content is one blob by design, so the resolution keeps every kind a digest is carried under, and a digest carried under more than one names none of them and backs no claim, honest or otherwise. That check is load-bearing because one record type covers many subjects: every gate writes a gate-run and every tool writes a tool-call, so a predicate that holds against the lint run is not evidence about the tests gate, and a lifecycle record can never satisfy a gate-outcome claim. Free-text narrative always renders as unverified prose and can never render green. Missing records, kind mismatches, and unparseable predicates render UNVERIFIED; they never abort the run. UI status, gate results, and bundle verdicts derive only from harness-evaluated predicates over ledger records, never from model text.
2. The ledger is append-only. No update, no delete, no rewrite. Each record carries the previous record's hash. A failed ledger write aborts execution.
3. Every tool call passes through the chokepoint. Adding a tool means adding a definition, not a new execution path. The sandbox default-denies reads of credential paths (.env*, *.pem, *.key, .git/config, ~/.aws, ~/.ssh), and every denial is recorded as evidence.
4. Blob store is content-addressed by SHA-256. Same content, same key, no exceptions.
5. Every value entering a tool call carries a provenance tag: user, model, tool-output, or file. Derivation detection is heuristic: tool-call arguments matching untrusted content read within a recent window (substring or normalized n-gram overlap, window and threshold configurable) route through the confirmation path. Treat it as a tunable heuristic with a false-positive rate, never describe it as an information-flow guarantee.
6. Gate results are data. Gate definitions declare command, output parser, and blocking or advisory. Engine logic never special-cases a gate.
7. The ratchet is numeric. During auto-resolve: tests collected non-decreasing; assertions in touched test files non-decreasing; coverage of changed lines non-decreasing; skip markers non-increasing; no previously passing gate regresses. Coverage of changed lines comes from a report the runner wrote to a path the harness named, outside the workspace, and never from what a gate printed: a number the code under measurement can author is not a measurement of it, and no artifact means not measured. A retry violating any of these is rejected and the attempt still counts. The same comparison runs once more at the end, between the final state and the base commit, whether or not any retry happened: without it a run whose first edit deleted the failing tests reaches a green first cycle and is never compared to anything, and a rejection there escalates instead of reporting green. One exception, granted per test and never per file: a test that is new in the submitted file, failed on the base source, and passes on the submitted source is a new specification, not tampering, and pays for exactly one deleted test in that file. A file-level exemption would drop the file from the comparison and carry every deletion beside it, and a base-source failure that is a load error proves nothing, since a file that never executed did not fail as a specification. A measure nothing measured is abstained on by name, never assumed unchanged, and the abstention is reported wherever the result is: coverage the harness could not obtain renders as "not measured" in the bundle, never as a pass. Ratchet measures and decisions are ledger records.
8. `src/core` has zero imports of ambient nondeterminism: no `Date.now`, no `Math.random`, no direct env reads. Inject everything.
9. Secrets never enter the ledger. One detector serves the write-time scrub, the export-time scan, and the secret-scan gate, so the three cannot drift apart. It keys on the assignment name or the field name rather than on the shape of the value, so a numeric-only credential (a PIN, an OTP, an account number) is redacted like any other, and so is a value carried as a JSON number that a text scan would never see. Structure is shared too: the credential-bearing name reaches nested values and an array directly under one is judged as the one value it is written in pieces of, at every site, so the three cannot disagree on the same input. Known metric names are exempt by key and never by value: a throughput figure is a measurement whatever its digits. The gate additionally requires a credential-shaped value before it blocks, because scrubbing is fail-safe and blocking is not. Name the guarantee honestly wherever it appears: known-pattern scrubbing, not secret removal.
10. Zod schema at every boundary: config in, provider responses in, ledger records out, bundle manifest out.
11. The session ledger and blob store live outside the workspace (~/.swarm/sessions/\<id\>/). The sandbox denies tool writes to that path. The signing key lives in the OS keychain, never in the workspace.
12. The planner declares its intended file set as a ledger record before editing, and "before" is checked against ledger order rather than assumed. The file check is set membership plus that ordering: an edit the chain records earlier than the declaration naming it is treated exactly as an out-of-set edit, since a declaration written afterwards describes what was done rather than what was intended. Both are cleared the same way, by an explicit recorded amendment that surfaces in the bundle as a reviewer-visible claim, and an amendment records every file it names rather than only the ones it widened the set by.

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
