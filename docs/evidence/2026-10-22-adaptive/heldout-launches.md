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
