# v8 Architecture Deviations

This document logs intentional deviations from the v8 implementation
and overhaul guides. Each deviation lists the section it diverges
from, the rationale, and whether it is locked in or revisitable.

## Phase 0

### Deviation 1: src/verification/ not added to skeleton

**Section:** v8-implementation-guide.md §3 (Phase 0 skeleton list)

**What §3 specifies:** src/verification/ is listed among the
directories the skeleton stands up.

**What was done:** src/verification/ was left untouched. v8 work in
that directory is a Phase 6 deliverable (streaming verification per
§9). The directory already holds v6/v7 code (battery, attestation,
worktree manager); adding scaffolding now would conflict with
existing files.

**Status:** revisitable at Phase 6.

### Deviation 2: CI uses three jobs to cover four checks

**Section:** v8-implementation-guide.md §3 (Phase 0 CI scope)

**What §3 specifies:** "lint, typecheck, unit tests, integration
tests against a small fixture repo."

**What was done:** .github/workflows/v8-ci.yml has three jobs (lint,
typecheck, test). The test job runs the existing mocha invocation,
which covers both unit and integration tests in one suite. The
fixture-exercising integration test lives at
test/integration/v8-empty-fixture.test.ts and is picked up by the
existing dist/test/**/*.test.js glob.

**Rationale:** a separate integration job would require a
test:integration npm script and a mocha glob split, both
package.json edits with no Phase 0 benefit. Three jobs cover all
four checks.

**Status:** revisitable when integration tests grow large enough
to warrant parallel execution or selective gating.

## Phase 1

### Deviation 1: contract serialization split into contract.jsonl + manifest.json

**Section:** v8-implementation-guide.md §4 (contract serialization
format).

**What §4 specifies:** "JSONL, append-only, hash-referenced from the
ledger." §4 is silent on where goal text, extractor provenance, and
the contract hash live.

**What was done:** finalized contracts persist as a directory with
two files. `contract.jsonl` holds one schema-validated obligation per
line (the bytes a verifier consumes). `manifest.json` carries the
goal, repo context, extractor provenance, contract hash, contract id,
and createdAt. The contract hash is computed only over the canonical
bytes of `contract.jsonl`.

**Rationale:** keeps the JSONL pure (every line passes the v1 ajv
schema), keeps the contract hash a function only of verifier-
consumed bytes, and keeps provenance reproducible without polluting
obligation lines. Manifest sits beside the JSONL in the same
contract-id directory; the ledger (Phase 4) can hash-reference
either file.

**Status:** revisitable at Phase 4 if the ledger's hash-reference
shape requires manifest fields to live on a JSONL line.

### Deviation 2: stub extractor shipped as a first-class CLI option

**Section:** v8-implementation-guide.md §4 (goal parser).

**What §4 specifies:** "a single LLM call (Sonnet tier) to extract
obligations."

**What was done:** the production extractor is `AnthropicExtractor`
(claude-sonnet-4-6, single call, tool-use enforced output). A
`StubExtractor` ships alongside it and is reachable via
`--extractor stub`. The stub is the test fixture for the 22
goal-to-contract transformations (impl guide §11 explicitly accepts
mocking outbound API calls); making it CLI-reachable means tests run
exactly the code path users hit when they pass the flag.

**Rationale:** offline reproducibility, deterministic tests, and a
dependency-free escape hatch for local debugging.

**Status:** revisitable at Phase 7 if `--extractor stub` becomes
unused or its surface drifts from the production extractor's
contract.

### Deviation 3: validator enforces ≥1 build-must-pass and ≥1 test-must-pass

**Section:** v8-implementation-guide.md §4 (Phase 1 exit criterion).

**What §4 specifies:** the Phase 1 example ("add a health check
endpoint") must produce a draft contract containing "at minimum a
`file-must-exist` for the new endpoint, a `build-must-pass`, and a
`test-must-pass`."

**What was done:** the validator enforces ≥1 build-must-pass and
≥1 test-must-pass as a hard rule on every contract. The
file-must-exist requirement is relaxed for behavioral goals (e.g.
"fix the off-by-one bug"), aligning with §4's "creation directive"
carve-out which permits omitting file-must-exist when the goal is
purely behavioral. The system prompt and the test fixtures both
exercise the relaxed shape.

**Rationale:** build/test gates universal; file gates conditional.
Logged as a deviation only because the implementation guide states
the example shape, not the universal-vs-conditional rule, in prose.

**Status:** locked in for v1 obligation set.

## Phase 2

### Deviation 1: cost benchmark runs in synthetic mode by default

**Section:** v8-implementation-guide.md §5 (Phase 2 cost
benchmark).

**What §5 specifies:** "Run each goal under v6 and v8
(single-persona mode). Capture token counts (input, output, cached
input separately), wall time, and pass rate."

**What was done:** the benchmark harness ships in two modes. The
default mode is synthetic: the v8 path runs the real population
manager (`src/population/manager.ts`) against a fresh tmpdir
fixture using `StubSession`, which reports usage estimated via the
4-chars-per-token heuristic; the v6 path is a deterministic cost
model from `scripts/v8-bench/v6-model.ts` parameterized on
overhaul guide §6's published numbers (40K bootstrap per CLI
invocation, 0.9 retry-cycles-per-obligation in expectation).
Effective input tokens normalize cache pricing using Anthropic's
published 0.1× cache-read and 1.25× cache-write multipliers.
A real-API mode (`AnthropicSession` against the same suite,
provider-reported tokens, measured v6 runs) is the natural follow-
up; it is in scope for the impl guide §11 weekly cost benchmark
schedule, not for the §5 ship-gate.

**Rationale:** the §5 ship-gate is a structural claim — that the
substrate-level cost ratio favors v8 by ≥30%. That ratio is
deterministic given the published cache multipliers and the §6
v6 model; it does not require live API calls to verify. The
benchmark ships gating logic that refuses Phase 2 when the floor
is missed (`--no-refuse` opts out for diagnostics), and CI runs
the same gate via `dist/test/benchmarks/v8-bench.test.js`. A
real-API replication run is logged as a Phase 2 follow-up under
"Notes for next phase" in the completion report.

**Status:** revisitable when the weekly cost-benchmark schedule
(impl guide §11) lands; the synthetic floor remains the floor for
shipping any phase that touches substrate economics.

### Deviation 2: Phase 2 implementer/verifier personas synthesize, but do not yet patch

**Section:** v8-implementation-guide.md §5 (Phase 2 personas).

**What §5 specifies:** "Phase 2 ships 3 personas: architect,
implementer, verifier."

**What was done:** all three personas are registered and dispatch
correctly through the trigger predicate evaluator. The architect's
synthesis path (file-emit → verifier) is wired end-to-end. The
implementer and verifier personas dispatch their session call but
do not yet apply diffs to the working tree; their obligations
(build-must-pass, test-must-pass) are verified directly against
the post-architect repo state. This is the natural shape for
Phase 2's "one persona at a time" sequential mode — the tournament
mechanics that make non-trivial implementer/verifier patches load-
bearing land in Phase 3 (`src/population/tournament.ts`).

**Rationale:** Phase 2's stated sequencing is "one persona at a
time, single-session, prompt-caching enabled" with the goal of
"validate cost economics on the new substrate before adding
tournament parallelism." Diff-apply for build/test obligations
needs the tournament loop to be useful (a single
implementer-persona patch with no verifier scoring is just a
session call and a hope); deferring it to Phase 3 keeps the
architecture-correct work in the architecture-correct phase.

**Status:** revisitable at Phase 3 when the tournament arrives.

### Deviation 3: minimal evidence ledger here, hash chain in Phase 4

**Section:** v8-implementation-guide.md §7 (evidence ledger).

**What §7 specifies:** the ledger has been "present in primitive
form since Phase 1 (contract storage). This phase [Phase 4] adds
the full hash-chain semantics, integrates with IRONROOT primitives,
and adds memoization."

**What was done:** Phase 2 adds an append-only JSONL ledger
(`src/ledger/jsonl-ledger.ts`) with discriminated entry types
(run-started, obligation-attempted, candidate-recorded,
obligation-satisfied, obligation-failed, run-finished), monotonic
sequence numbers, and resume-aware sequence inheritance, but no
hash chain. The hash-chain layer is Phase 4 per §7.

**Rationale:** the population manager needs a place to record
evidence per obligation; the ledger entry shapes the manager
already writes are the union Phase 4 will continue to consume. The
on-disk format is identical between Phase 2 and Phase 4; Phase 4
adds verification, not migration.

**Status:** locked in for the entry shape; revisitable at Phase 4
when hash-chain framing wraps each entry.
