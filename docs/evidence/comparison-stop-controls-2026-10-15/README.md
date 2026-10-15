# Stop controls for the comparison launcher: proof of 2026-10-15

A second proof, produced after the launcher was changed for the real-task pilot's correction
([../2026-10-14/real-task-pilot/correction-2026-10-15.md](../2026-10-14/real-task-pilot/correction-2026-10-15.md)).
The original proof of 2026-10-14 ([../comparison-stop-controls/](../comparison-stop-controls/README.md))
is untouched and stands for the bytes it fingerprints; this one is bound to the repaired bytes,
by the same script, and verifies with
`node scripts/prove-comparison-stop-controls.mjs --verify docs/evidence/comparison-stop-controls-2026-10-15`.

## Result

**35 of 35 cases passed**, every measured detection and termination within its declared bound,
and the three new cases fail against the launcher as it was before the change (retained output,
`blobs/`): a Swarm launch whose effective tests gate is not the task's is dispatched there, a
gate failing on the prepared base is dispatched there, and four launches there share one home
(the fixture's sentinel written by one launch is found by the next).

## What is new since the 2026-10-14 proof

| control | class | case |
| --- | --- | --- |
| the swarm.toml written for an arm carries the task's test argv as the `tests` gate | configuration | the pinned product's `check` is run over a fresh checkout of the prepared base, under the launch's home, before dispatch; a report naming another command halts |
| the effective tests gate must pass on the prepared base in the launch's environment | configuration | a report whose tests gate fails (the fixture reports a missing browser) halts, with the output kept on the attempt record |
| every launch gets a fresh home of its own; what an arm installs there is recorded and removed with the launch | preparation | four launches, four homes, no sentinel carried across; a declared prerequisite this launcher cannot provision is refused before freezing |

## What this proof does not include

No live smoke on the real arms is part of this proof (`smoke: null` in the manifest); the live
exercise of the repaired launcher is the development validation under
[../2026-10-14/real-task-pilot/development/](../2026-10-14/real-task-pilot/development/README.md),
which is reported there with its own records.

## Reproduction

```
npx vitest run scripts/comparison/run.test.mjs scripts/comparison/control.test.mjs scripts/comparison/endpoint.test.mjs
node scripts/prove-comparison-stop-controls.mjs --verify docs/evidence/comparison-stop-controls-2026-10-15
```
