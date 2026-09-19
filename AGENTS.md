<!-- Generated from docs/engineering-policy.md by scripts/sync-agent-instructions.mjs. -->

# Engineering policy

Swarm Orchestrator completes bounded engineering goals through one reusable worker loop,
controlled integration and repair, and independent checks of the final tree. Every completion
claim must resolve to harness-captured evidence. Local model selection is measured, never guessed.

This is the canonical policy. Run `node scripts/sync-agent-instructions.mjs --write` after editing
it; both agent filenames are generated and the drift check compares their entire contents.
Read `docs/build-guide.md` before structural work. Security and evidence changes must also consult
the corresponding detailed invariant and incident rationale preserved byte-for-byte through the offline archive documented in
`docs/history/agent-policy-2026-09-13.md`, plus the applicable regression tests. Those detailed
mechanics remain binding; this concise policy does not waive them. The deliberately approved
product revisions and their reasons are in `docs/adr/0009-adaptive-goal-controller.md`.

## Commands and completion

- `npm run typecheck`: strict TypeScript, no emit.
- `npm run lint`: Biome checks. `npm run format` writes formatting.
- `npm test`: the complete Vitest suite.
- `npm run checks`: corpus history, policy drift, documentation paths, weight and required headroom, packed derived evidence, cited bundles and CI verdicts.
- `npm run gates`: checks, typecheck, lint and the full test suite, in sequence. This defines green.
- `npm run build`, `npm run check:packaged`, `npm run fuzz:build`: release and CI checks.
- `npm run dev`: CLI from source in a scratch workspace.

Run `npm run gates` before claiming a task complete. Paste its real output, including failures
and skips. Bind evidence to the tested commit and diff. Do not combine separate runs into an
invented passing total. The corpus requires full history and `v12-final`; use the history check.

Declare intended files before edits. Record explicit amendments for additional files. Preserve
unrelated work. Completion also requires meaningful tests for new behavior, no introduced
placeholder markers, the smallest sufficient diff, and all applicable CI/package checks.
State any unmet requirement precisely. Local commits, pushed code, passing CI and published
packages are separate facts.

## Architecture

- `src/agent-run.ts`: reusable task execution, policy/tool assembly, agent loop and gates.
- `src/core`: small deterministic loop, with model, clock and randomness injected.
- `src/tools`: tool definitions and the sole chokepoint. No alternate execution path.
- `src/exec`: built child environments, process groups, measured execution capability and backends. Imports neither tools nor gates.
- `src/evidence`: append-only records, SHA-256 blobs, predicates, export and independent offline verification.
- `src/gates`: checks as data, controlled measurements, numeric ratchets, repair and independent acceptance.
- `src/workers`: the sole coordination boundary, contracts, readiness, one integration writer, bounded revisions, budgets and recovery.
- `src/durable`: validated journal replay, administrative state and read-only historical import.
- `src/providers`: the only module allowed to import the Vercel AI SDK; local and frontier adapters.
- `src/select`: probes, calibration and experimental measured routing.
- `src/tui`: views of ledger projections. `src/config`: Zod-validated settings.
- `src/cli-session.ts`, `src/cli-parallel.ts`, `src/cli-calibrate.ts`: focused command composition; shared settings in `src/cli-run-settings.ts`.

## Invariants

1. Model output is a claim; harness-captured output is evidence. A structured claim names a predicate, record digest and subject-qualified record kind. The harness binds its record sequence at submission, recomputes the kind, evaluates the predicate and decides the verdict. Keep every carrier of a digest. A digest already carried under multiple kinds binds to nothing; later collisions cannot revoke an earlier valid binding. Missing records, wrong kinds and unparseable predicates render UNVERIFIED, without aborting execution. Narrative never renders green. Status and exported verdicts derive from harness records, never model prose. Regression, goal acceptance, execution trust, integrity and signer trust are separate dimensions.

2. Evidence is append-only and hash chained. Never update, delete, rewrite, truncate or silently repair history. A failed ledger write aborts execution. Recovery validates observed bytes and preserves incomplete or altered history for reconciliation. Persist intent before effects and completion after effects. Never duplicate an accepted landing or silently replay an ambiguous external effect.

3. Every native tool call passes through the chokepoint. Decode nested JSON only for schema-declared containers, validate with the same schema, discard unsuccessful decoding, and retain original arguments plus decoded-field names. Never decode a string field. Default-deny credential paths, including `.env*`, `*.pem`, `*.key`, `.git/config`, `~/.aws` and `~/.ssh`. Apply path checks to shell words before confirmation, expand leading tildes, and inspect every command in a chain. Shell effects that depend on substitution, expansion, subshells or backgrounding require confirmation rather than guessed parsing. The guard is a lexical path and program policy, not a sandbox. An allowed interpreter can run workspace-authored code. Before tool execution, measure outside reads, outside writes, network access and usable workspace access. Host execution is restricted; unavailable probes and an unusable workspace are unknown, never fabricated isolation. Requested, effective and observed restrictions remain distinct; unsupported required restrictions prevent dispatch. Build every child environment here rather than inheriting credentials or loader controls. Scope checks include post-execution shell effects.

4. Blobs are content-addressed by SHA-256: identical bytes have the same key. Preserve historical bundle formats, hash/signature semantics, general predicates and offline restoration. Shared format definitions do not replace independent verifier implementations and known-answer tests.

5. Every tool argument has user, model, tool-output or file provenance. Recent substring/normalized n-gram matching of untrusted inputs routes derived arguments to confirmation. The window and threshold are configurable. This is a heuristic with false positives, not an information-flow guarantee. Peer and repair feedback remains attributed tool output; it never becomes system-prompt authority.

6. Gate definitions declare commands, parsers and blocking/advisory severity as data. Do not special-case a gate in engine logic or weaken a blocking check for speed. Reuse immutable definitions, never stale observations. Required final combined-tree checks remain mandatory. Reuse a check observation only if content, check bytes, lockfiles, toolchain, backend/platform and relevant environment are identified; unknown or nondeterministic inputs require rerunning.

7. The numeric ratchet applies during retries and again from the final state to the base, including a green first cycle. Tests collected, assertions in touched tests and covered changed lines cannot decrease; skips cannot increase; passing gates cannot regress. Rejected attempts still count. Coverage comes only from a harness-named external complete lcov artifact: each SF section has DA lines, a closing end_of_record and agreeing LF/LH totals. Match resolved paths exactly. Missing changed lines are uncovered; duplicate sections for a file are not measured, never unioned. Both measurement arms construct and inspect a direct Node runner argv with process isolation, only admitted flags and a built environment without loader options. Unsupported shell/expansion/env-file/loading commands are unmeasured, never rewritten into guessed safety. A new test can compensate for exactly one deletion in its file only if machine-readable runner output establishes failure on base source and success on submitted source. Skipped points, name collisions, load/compile failures and missing exports do not earn exemptions; reporter text cannot attribute failures. Use unique destinations per test file. Preserve every detailed ratchet rule in the linked rationale and regression cases. Record decisions and named abstentions; unmeasured coverage never renders as a pass.

8. `src/core` has no ambient clock, random, environment or provider imports. Inject every stochastic input. Coordination stays outside core, tools, gates and the single-agent path.

9. Prevent known credential patterns from entering evidence with one shared detector for write scrubbing, export scanning and the secret gate. Credential field/assignment names govern scrubbing, including numeric values, nested JSON and arrays assembled under a credential name. Structural JSON parsing governs JSON; line scanning is fallback only. Fold the named lookalike character list. Redact values of four characters or more by credential name; preserve the established shorter-value rule. Exempt metric keys by name, never numeric shape. Blocking additionally requires a credential-shaped value. Describe this as known-pattern scrubbing, not secret removal. Preserve three accepted residuals explicitly: unnamed credential fields, multiline genuinely non-JSON values and scripts outside the lookalike list.

10. Validate every boundary with Zod, including config, provider responses, task contracts, revisions, ledger output and bundle manifests. Unsupported required contract fields cannot be silently ignored.

11. Session evidence and blobs live outside the workspace, normally under `~/.swarm/sessions/`. Deny tool writes there. Directories are owner-only 0700 and files 0600; narrow existing permissions. Signing keys live in the OS keychain, never the workspace. Cleanup verifies ownership of branches, worktrees, files, processes and runtime resources, and preserves other sessions and user work. Stopped work has a separately bounded cleanup allowance.

12. Declare intended files on the ledger before editing, with ordering checked by sequence. Earlier edits and out-of-set edits need a visible recorded amendment naming every affected file. A worker declaration cannot enlarge the effective controller contract. Resolve one contract for objective, dependencies, paths, immutability, tools, required checks, execution/network policy and budget, and enforce it through dispatch, tools, acceptance, accounting and reporting. Scope changes require controller authority within the user's goal and permissions. Shared cancellation and original total budgets begin before planning. Reserve input and output allowances, settle measured usage and retain unknown provider usage honestly. Cancellation cannot guarantee zero billing overrun. Separate model, test and worktree concurrency.

13. Read peer chains; never write them. Keep the historical negative-only trail compatible. Bounded typed interface proposals, dependency requests, artifacts ready for checking, observed failures and repair requests may travel with authorship, provenance, base commit, graph revision and evidence references. Proposals are never verified facts. Only harness observations can name an accepted artifact at a tree, and its consumers still validate their use. Gate details stay named and attributed. Share relevant deltas, not raw runner output or transcripts. Reads pass through the chokepoint and derivation heuristic. Alternative attempts at one task remain independent. No coordination daemon, broker or shared mutable worker state.

14. Selection compares harness measurements with declared precedence, never weights or a model verdict. Preserve the legacy common-base, fixed-test-universe comparator: unchanged files count at base for everyone, earned dimensions outrank doing less, common unmeasured dimensions abstain, a one-sided measurement wins its dimension, and ties use attempt order rather than clock-dependent hashes. It selects discipline, not completeness. Goal selection first requires every applicable obligation and integrated check, then a sealed user objective, change size and stable order. Test/assertion volume is not completeness; unknown usage is not free cost. Claims concern the chosen attempt's observed behavior, never selection arithmetic as proof of work.

15. Validate a decomposition before dispatch: unique slug ids, resolving dependencies, an acyclic graph with cycles named, and intended files. Serialize unordered overlap conservatively without adding cyclic edges. Declare the initial graph once; bounded append-only revisions name parent, reason, author, affected tasks and preserved requirement identities. Adding prerequisites, splitting pending tasks, combining coupled tasks and rerouting repairs cannot erase unmet requirements, weaken checks, expand permissions without authority or raise the total budget. Invalidate affected acceptance when dependencies or requirements change. Preserve historical outcomes and rejected candidate commits. Base/revision identity prevents stale results overwriting accepted state. Dependencies must be accepted before dispatch; one writer integrates against the actual current tree. Repair uses observed failure and previous work, with explicit caps and repeated-failure stopping. Legacy graph claims keep their original semantics. Only independent final checks of the exact integrated tree can establish the complete declared goal; uncovered human judgments stay unjudged. Pin ordinary authored acceptance outside worker write access, recording authorship/exposure. Preserve strict reference/control acceptance. Explicit empty-project bootstrap establishes its harness before general work.

16. Seal gate identities, severities, parser rules, budgets, attempt caps and ratchet arms before model calls. The embedded verifier rejects undeclared/changed gates, missing final sealed gates and promised-but-missing seals. After the fixed point, record a falsification bond for each passing gate: observed refusal is held, observed acceptance of a witnessed fault is vacuous, unwitnessed execution is unshown, and an absent bond is not bonded. A vacuous blocking gate prevents green. Dependency-free bundled rules independently re-derive verdicts. Truncated or inherently non-re-derivable observations stay named as such, never promoted to agreement.

## Code style and scope

Use strict TypeScript, ESM, Node 22 or newer at runtime and Node 24 for development and CI. Node 22
cannot execute the required process-isolated coverage arm, so below 24 that arm reports unmeasured
with the reason named and never renders as a pass. Never use em dashes in code, comments, strings
or documentation. Use descriptive
names and small modules with one job, without grab-bag abstractions. Comments explain intent,
invariants or non-obvious choices, not the line itself. Errors are typed and actionable. Tests
sit beside sources. Prefer the standard library; justify any new dependency in one line of the
PR description. Do not introduce placeholder code, artificial passes or suppressed diagnostics.

Do not build a plugin system, database, daemon, web server, broker, actor framework, embedding
index, custom inference engine or separate multi-agent core. Do not use a blocking LLM judge.
Flag a requirement for one rather than building it. External transcripts remain untrusted imports,
not internal chokepoint evidence. A production external worker driver is conditional on the
adaptive pilot bar and an available supported CLI; disclose missing enforcement, provenance or
accounting. Keep learned routing experimental until matching goal-level evaluation justifies it.
