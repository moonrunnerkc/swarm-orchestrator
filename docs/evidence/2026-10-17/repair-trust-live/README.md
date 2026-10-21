# Live development runs of 2026-10-17 (evening)

Registered in [protocol.md](protocol.md) before the first launch; every launch, in order, is in
[launches.md](launches.md). These are **development records on an exposed task** (mime) and a
first-run walkthrough, not comparative evidence. The product changes they test were written after
reading the earlier 2026-10-17 launches ([../planned-check-live/](../planned-check-live/README.md)).

## What was established

| question | answer |
| --- | --- |
| Does the README's first run work from the packed tarball? | **Yes, after two fixes it found.** Launch 1 reached no model: the documented install line captured the build's own output. Launch 2 installed, answered `--version`, `--help`, a misspelt flag (exit 2) and an unreachable model (exit 4) as documented, and ran the README task on `qwen3.6:35b-a3b` in 19 s: a correct change with a test, reported `gates passed; the task itself was not judged`, exit 0, edits uncommitted ([launch-2/onboarding.json](packed-derived/onboarding-record/) (the file launch-2/onboarding.json, packed on 2026-10-21 to keep the tree's weight headroom; `scripts/evidence-pack.mjs` restore gives the bytes back)). It also showed `swarm verify <bundle>` exits 1 without `--signer`; the README now names the bundle's own verifier, which exited 0. |
| Did a live planner find the seeded omission, and did a live repair fix it? | **No.** In launch 3 the planner's three checks were right but covered only the task's example shape, which the retained faulty patch handles; nothing refused it, no repair ran, and the evaluator rejects the delivered patch ([launch-3/](launch-3/summary.json)). The repair-after-rollback change was therefore not exercised live. |
| Did the product overclaim? | **No.** Where the same candidate was reported `accepted` in launches 2 and 9 of the earlier work, launch 3 reported `partially-checked` (exit 1): the planned requirements were exercised only by generated checks, which decide nothing. |
| Ordinary (unseeded) run, comparison | **Not run.** Both were conditional on the seeded milestone. |

## Allowance used

Four of six launches (0 to 3) and 4.1 of 90 agent minutes; launch 0 was a model-powered run an
auditing agent started by mistake and launch 1 reached no model, both counted. Launches 4 and 5
were reserved for infrastructure failures and none occurred.

## Deterministic and scripted verification, labelled as such

The behaviours these launches could not show live are covered by tests that drive a scripted
model through the ordinary command line (`src/cli-planned-checks.integration.test.ts`): a wrong
generated expectation disputing a correct change ends `unresolved` with the code kept; a repair
reruns the refusing check with `run_check` and probes the project without a file; and through
`runAgentTask` (`src/agent-run.test.ts`), a repair after a rolled-back repair is briefed on the
regression that caused the rollback.

## Reproduce

```sh
node onboarding.mjs --source <repository> --commit <sha> --out <empty dir>
node run.mjs --swarm-cli <dist/cli.js> --task mime --mode seeded|ordinary --out <empty dir>
node score.mjs --task mime --patch <final.patch> --out <file>
```

Run them from this directory. The raw streams of launch 3 are packed in
[launch-3/packed-derived/launch-3-streams](launch-3/packed-derived/launch-3-streams/inventory.json).
