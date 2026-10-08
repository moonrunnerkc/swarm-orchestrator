# 0013. Swarm Orchestrator is the product of this repository; Swarm Verify is the standalone verifier it is built on

**Status:** approved 2026-10-08, supersedes [0012](0012-verifier-first-product.md)

## Context

ADR 0012 made the verifier this repository's front door and documented the coding agent as an
advanced beta mode. The README of 14.3.0 opened with "Swarm Verify" and explained that a
repository called `swarm-orchestrator` was the main source repository for another product;
the GitHub description said the same; the published `swarm-verify` package described the
agent as optional and beta. That inverted the identity of a repository, a package and a
product line that have been a coding agent since 13.0.0, and it left the verifier without a
home of its own: `moonrunnerkc/swarm-verify` held an Action manifest and a lockfile, and
pointed back here for everything else.

The implementation underneath was not inverted. One code base holds the gates, the ledger,
the executors and the verifier; the agent composes them; the `swarm-verify` package is built
from the closure of one entry behind a boundary that refuses any provider, worker or screen
module. That boundary is tested and enforced at build time.

## Decision

Two products, one implementation, and a stated direction between them.

1. **Swarm Orchestrator is this repository's product**: a coding agent whose work is
   controlled by sealed gates, a ratchet, challenges and evidence rather than by its own
   claims. The README, the package description and the repository description say so first.
2. **Swarm Verify is the standalone verifier**, useful without the agent, for a change from
   any source. Its product home is `moonrunnerkc/swarm-verify`: the GitHub Action, the Action
   reference, the examples, the verifier's changelog and its releases. Every file there is
   generated from this repository by `scripts/build-action-distribution.mjs` and never
   hand-edited, so the Action stays a thin client of the published package.
3. **The implementation stays shared.** The verifier's 177 modules are the agent's own gates,
   evidence and executors; moving them into another repository would make the agent depend on
   a published package for its own gates and would not be the smallest clean architecture the
   dependency boundary supports. The `swarm-verify` package is built from
   `packages/swarm-verify` in this tree, declares `zod` and `smol-toml` only, and its provenance
   names this repository, which is accurate. The direction is `swarm-orchestrator -> swarm-verify`:
   the agent uses the verifier; the verifier needs nothing of the agent.
4. **Releases are independent.** The agent releases as `swarm-orchestrator` from `v*` tags,
   with GitHub Releases in this repository. The verifier publishes as `swarm-verify` from
   `swarm-verify-v*` tags here, with its GitHub Releases in `moonrunnerkc/swarm-verify`, where
   the Action's `v1` and `v1.x.y` tags already live. Each changelog is its own file.
5. **The Action manifest lives beside the package** it ships, under `packages/swarm-verify`,
   not at the repository root, so this repository no longer presents itself as a GitHub Action
   and the historical Marketplace listing bound to it can be delisted.

What ADR 0012 decided about scope stays decided: one engine, scope stated in every report,
model-driven work opt-in and off by default. What it decided about the front door is reversed.

## What it does not buy

A restored identity does not make the agent production-ready; the open gates are in
[docs/beta-gates.md](../beta-gates.md). It does not make the verifier more capable than it is;
[docs/claims.md](../claims.md) still governs what may be said about either product. And a
shared implementation is a maintenance choice, not a guarantee: the build and the boundary
test are what keep model SDKs and the agent's modules out of the verifier package.
