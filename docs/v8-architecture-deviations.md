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
