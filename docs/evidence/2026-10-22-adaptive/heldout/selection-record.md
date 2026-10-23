# Held-out block 1 selection record

Prepared by the evaluator author under [the registered rule](../heldout-selection-rule.md), with no
model inference. The registry with full validation outputs stays sealed until the block is scored.

Accepted (all validated: base fails the visible check and the executed hidden evaluator; the
reference passes both and the allowed-change policy; every faulty control fails; an alternative
correct implementation passes):

| Task | Faulty controls failing | Alternative | Base install + project tests |
| --- | --- | --- | --- |
| p-limit bug fix (`f3e7f9ba3`) | 3/3 | passes | 2.5 s + 5.6 s |
| p-limit feature (`8907801ff`) | 4/4 | passes | 2.4 s + 5.6 s |
| fastify refactor (`5bcee1d7a`) | 4/4 | passes | 3.1 s + 17.3 s |
| p-queue compatibility (`e48716fa1`) | 2/2 | passes | 2.2 s + 34.5 s |

The evaluator author's interpretation: families are taken in the rule's order, and a candidate is
refused when taking it would leave the three-repository span unreachable.

Rejected:

- p-limit compatibility (inventory): span guard; its base `npm test` also cannot run on Node 24.
- fastify compatibility (inventory): span guard; it is a bug fix, not a compatibility change.
- fastify refactor (inventory): removes a public type, so not behavior-preserving.
- p-queue refactor (inventory): a whole-module TypeScript rewrite that also changes `scripts.test`.
- fastify bug fix and feature (inventory): families already filled.
- amended refactor pool: `27f4d6222` one authored file; `5ff2cd024` test-only; `f4a6ac1d0` and
  `a676d7fcd` documentation only; `a38ebb49d` its reference adds an `istanbul ignore` pragma the
  allowed-change policy rejects.
- amended compatibility pool: fastify and p-limit commits hit the span guard; p-queue `fa3c3e0b4`,
  `64311ff68` and `e9074f06f` are other families.

The exposure scan found no match for any considered identity. The refactor's task text lists the
full rename map, and its hidden evaluator overlays no upstream tests (behavior and structure only).
The p-queue hidden check was corrected once before registration, as the protocol states.
