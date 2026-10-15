# Stop controls for the comparison launcher: proof against the 2026-10-15 comparison's harness

A third proof, produced after the launcher was changed for the comparison of 2026-10-15
([../2026-10-15/comparison/README.md](../2026-10-15/comparison/README.md)): one token
allowance per launch shared by the scripted corrections, each arm's spend recorded by kind, and
OpenCode's configuration spelling thinking off the way its provider maps it. The earlier proofs
([../comparison-stop-controls/](../comparison-stop-controls/README.md), [../comparison-stop-controls-2026-10-15/](../comparison-stop-controls-2026-10-15/README.md))
are untouched and stand for the bytes they fingerprint; this one is bound to the comparison's
bytes, by the same script, and verifies with
`node scripts/prove-comparison-stop-controls.mjs --verify docs/evidence/comparison-stop-controls-2026-10-15-comparison`.

## Result

**35 of 35 cases passed**, every measured detection and termination within its declared bound.
The retained regression output of the launcher before the pilot's correction is carried again
under `blobs/`, by digest. No live smoke is included: the readiness canaries of the comparison
ran two of the smoke manifest's four launches by design (the canary allowance), and a proof
carries a smoke check only where every launch of the smoke was recorded, so this manifest
carries none and says so (`smoke: null`); the canaries' records are published under the
comparison's readiness directory instead.

The controls themselves are unchanged from the 2026-10-15 proof; what this proof adds is that
the launcher as it ran the comparison's readiness launches still halts on every fault class the
suite injects.
