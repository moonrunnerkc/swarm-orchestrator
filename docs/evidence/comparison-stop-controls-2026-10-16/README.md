# Stop controls for the comparison launcher: proof against the 2026-10-16 comparison's harness

A fourth proof, produced after the launcher was changed for the comparison of 2026-10-16
([../2026-10-16/comparison/README.md](../2026-10-16/comparison/README.md)). The changes:

- every invocation is killed at the launch's deadline, the grace only bounding confirmation;
- a kill whose end is not confirmed halts the campaign;
- processes still working in the launch's directory are stopped before scoring;
- corrections need a minute left, and Swarm also its verification reserve;
- each task's commands run with the npm release its base declares;
- a gate the manifest declares advisory is checked in the product's plan.

The earlier proofs ([../comparison-stop-controls-2026-10-15-comparison/](../comparison-stop-controls-2026-10-15-comparison/README.md)
and those before it) are untouched and stand for the bytes they fingerprint. This one is bound to
the harness digest the comparison's frozen manifests carry
(`sha256:59d3763e9d92a23ef3c142b64df4d03e8cb36798556ae555a45eba2547438efa`), was produced from a
clean tree by the same script, and verifies with:

```sh
node scripts/prove-comparison-stop-controls.mjs --verify docs/evidence/comparison-stop-controls-2026-10-16
```

## Result

**43 of 43 cases passed**, every measured detection and termination within its declared bound
(detection about 1.6 s against 10 s; termination confirmed within milliseconds against 10 s). The
eight new cases are:

- the kill landing at the deadline;
- an unconfirmed kill halting with nothing scored;
- a detached process stopped before scoring;
- the correction allowance and Swarm's wall read from the arm's own argv;
- no correction without its minute;
- the declared npm release reaching both arms;
- a missing toolchain halting before dispatch;
- a declared advisory gate the plan does not honour halting.

The retained regression output of the launcher before the pilot's correction is carried again
under `blobs/`, by digest. No live smoke is included (`smoke: null`). The comparison's own eight
launches are the live use of these bytes, published under its `stage-a/` with no halt.
