# Held-out block 1 launches

Frozen before the first launch, October 22, 2026.

- Manifest `~/.cache/swarm-study-2026-10-22/heldout/manifest.json`, sha256
  `5188b78a294e6b4813310008b838c72b002c642eb9da8326ff3b8970b6595d87`; product `git archive` of
  `299dac547`; protocol [heldout-protocol.md](heldout-protocol.md).
- Smoke `smoke-7` on that build: all four arms pass every registered criterion.
- Preflight with no inference: all 16 launch configurations prepared and validated (pinned
  executables and build digest, built PATH, fresh homes, in-profile access probe, Swarm's gate plan
  passing on each base, no `--install` where the base has no lockfile).
- Order: p-queue (swarm, swarm-control, swarm-direct, opencode), fastify refactor (swarm-control,
  swarm-direct, opencode, swarm), p-limit bug fix (swarm-direct, opencode, swarm, swarm-control),
  p-limit feature (opencode, swarm, swarm-control, swarm-direct).

Outcomes are read only after the sixteenth launch is scored.

## Setup correction 1, before any task inference

Launch 0 (p-queue, `swarm`) stopped before its first model request: with no lockfile at the base,
Swarm ran without `--install`, its goal setup checked the base in a fresh checkout with no installed
dependencies, every gate stood down, and the product refused to measure (exit 1 after 0.9 s; record
`heldout/runs/p-queue-compat-remove-throw-on-timeout.swarm.setup-1.json`). The preflight had passed
because the harness's gate-plan check runs in a prepared tree; it does not exercise the product's
own fresh-checkout setup.

Correction: one lockfile per task, resolved by the harness from each base with
`npm install --package-lock-only --package-lock=true --before=2026-10-22T00:00:00.000Z` (the
evaluator author's registered install date), frozen by digest under the study root, and committed
by the runner beside the visible check, so every arm sees the same file and versions, Swarm arms
install from it with `--install --lockfile package-lock.json`, and it is never part of a patch.
`npm ci` installs from such a lockfile despite the projects' `package-lock=false`. A patch that
edits `package-lock.json` would not apply over the scorer's tree, which is prepared without it; any
such case is reported. Same tasks, arms, order and budgets, refrozen as `heldout-2`; this counts as
the first of the cell's two permitted setup retries.

Refrozen manifest `~/.cache/swarm-study-2026-10-22/heldout-2/manifest.json`, sha256
`ff861dcf5bfca97a1c882882d7327d325d6b2c5594d7b47f40cd281c15d0c91b`; preflight passes all 16 configurations,
with the harness lockfile committed and Swarm arms installing from it.

## Setup correction 2, before the fastify launches' inference

Launch 4 (fastify, `swarm-control`) stopped before its first model request: Swarm's goal setup
found `test/listen.3.test.js` ("listen on socket") failing at the base for a different reason than
in a candidate and refused to measure. Cause, reproduced outside the study: the runner gave every
arm a TMPDIR inside the launch directory (97 characters for this task), the test listens on a socket
file under TMPDIR, and macOS refuses socket paths past 104 bytes (`listen EINVAL`); with a short
TMPDIR the same base passes 4/4. The evaluator's validation used the system temporary directory.
Correction: each launch gets a short temporary directory (`/private/tmp/sws-*`), admitted in the
shared profile and removed after the launch, for every arm. The four p-queue launches had already
run with the long path, all four alike; p-queue's tests open no socket. Recorded through the
runner's correction record with both harness digests; the manifest is unchanged.
