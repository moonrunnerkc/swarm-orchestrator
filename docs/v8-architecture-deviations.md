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
