# P3 Context Broker — Deferred Past 7.0.0

## Decision

P3 (the context broker with bge-small-en-v1.5 embeddings backing
`src/context/embedding-store.ts`) is deferred to a post-7.0.0 release.
The architectural slot for `src/context/embedding-store.ts` is reserved
in the v7 module layout but is not implemented in this release. No
embedding store, no vector index, no context-broker code ships in 7.0.0.

## Rationale

P3 is a performance optimization aimed at reducing cold-start context
loading cost on each agent step. The premise — that context loading is
the dominant component of wall-clock and premium-request budget per
instance — has not been measured. Without P4 sweep data showing context
loading actually dominates the cost mix, building P3 risks shipping an
optimization aimed at the wrong bottleneck.

Two outcomes are possible from the P4 sweep:

1. Per-instance metrics show context loading as the dominant cost. P3
   moves into the next release scope; the existing
   `src/context/embedding-store.ts` slot becomes the integration point.
2. Per-instance metrics show another component dominates (most likely
   adapter wall-clock or verification-battery wall-clock). P3 stays
   deferred indefinitely; effort routes to the actual bottleneck.

Either outcome is fine. The point of deferring is to avoid spending the
implementation cost before the cost-attribution data exists.

## Trigger to revisit

When P4 sweep results are available (artefacts under
`benchmarks/swe-bench/results/` and a release-notes summary), inspect
`cost-attribution.json` per instance. If the median share of "context
loading" wall-clock or premium-request cost is above ~20%, P3 enters
the next release scope. Otherwise it stays deferred.

A single follow-up commit will either land the P3 implementation or
remove the architectural slot, depending on the verdict above. Until
then no half-finished embedding-store code, no stub interfaces, and no
TODOs in `src/context/`.
