# The csstree refusal, reproduced and repaired through the ordinary run

No model was called. Swarm's own retained stage A patch
([../../comparison/stage-a/patches/csstree-upgrade-esbuild-0-24.swarm.patch](../../comparison/stage-a/patches/csstree-upgrade-esbuild-0-24.swarm.patch))
reaches each run the way a live launch's change does:

1. the run starts at the original base;
2. a scripted model declares `package.json` and `package-lock.json`;
3. it writes both through the product's write tool;
4. the gates, the acceptance check, any justification turn and the final verification follow.

The command line, contract, configuration and lockfile install are the launch's own
(`scripts/pilot/replay-verification.mjs`, `delivery: "written"`, [plan.json](plan.json)).

The earlier preflight replays applied the patch before the session started. The product then
recorded the change as inherited and measured 0 added lines, so they could not meet this defect.

| build | diff-budget | outcome | exit | hidden oracle |
| --- | --- | --- | --- | --- |
| `917312983` (measured in stage A) | failed (advisory): 698 added lines against 600 | not accepted; "work refused: final ratchet and bonds accepted the completed work" | 1 | pass |
| `1f9a9ae56` (this branch) | passed: 1 added line, plus 697 generated lines in package-lock.json counted apart | accepted | 0 | pass |

On the measured build, the diff-budget record digest (`sha256:d1ae44e0…`) is the one stage A's
launch recorded, so the replay reproduces that run's refusal byte for byte. Records, stdout and
the payloads are in [build-917312983/](build-917312983/) and [build-1f9a9ae56/](build-1f9a9ae56/).
