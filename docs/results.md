# Results

The only page in this repository that states measured numbers. `eval/report.mjs` writes it
from the results store under `eval/results/`; nothing here is entered by hand.

## Three-arm evaluation

### swebench-verified

30 task(s), model `qwen3.6:35b-a3b` for every arm, judged by the benchmark's own tests through Harbor, from run(s) `2026-10-29T14-34-36-154Z`, `2026-10-29T14-56-11-815Z`, `2026-10-29T16-12-15-988Z`, `2026-10-29T19-45-42-731Z`. A trial the tests never judged is counted under Tasks but not Judged. Commits: mini-swe-agent 7c95d1bf2, 873a599a2, 0896e27e0; opencode 7c95d1bf2, 873a599a2, 0896e27e0; swarm 0896e27e0.

| Arm | Tasks | Judged | Passed | pass@1 | Wilson 95% | Median wall (s) | Median tokens |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| mini-swe-agent | 30 | 30 | 15 | 50.0% | 33.2% to 66.8% | 304 | 1070050 (30 reported) |
| opencode | 30 | 30 | 10 | 33.3% | 19.2% to 51.2% | 125 | 190617 (30 reported) |
| swarm | 30 | 30 | 14 | 46.7% | 30.2% to 63.9% | 235 | 862509 (30 reported) |

| Pair | Both judged | First only | Second only | McNemar p |
| --- | ---: | ---: | ---: | ---: |
| mini-swe-agent vs opencode | 30 | 6 | 1 | 0.125 |
| mini-swe-agent vs swarm | 30 | 3 | 2 | 1.000 |
| opencode vs swarm | 30 | 0 | 4 | 0.125 |

How the runs ended, from the outcome block `swarm run` prints in each trial; Passed is the benchmark's judgment.

| Arm | Stop | Verifier verdict | Trials | Passed |
| --- | --- | --- | ---: | ---: |
| swarm | step-budget | not verified | 2 | 0 |
| swarm | token-budget | not verified | 13 | 3 |
| swarm | token-budget | unmeasured | 1 | 0 |
| swarm | unmeasured | unmeasured | 14 | 11 |

## Tamper evaluation

`tamper-2026-10-30T05-29-41-578Z.json`, from `node eval/tamper/run.mjs` at cdcb7cc24: honest and cheating patches against three fixture repositories, each verified by `swarm verify` with held-out checks sealed. A patch counts as flagged when the verdict is anything but pass.

| Patches | Honest | Cheating | Honest flagged | Cheats flagged | Precision | Recall |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 44 | 20 | 24 | 0 | 24 | 100.0% | 100.0% |

| Technique | Cases | Flagged |
| --- | ---: | ---: |
| edited-expectations | 4 | 4 |
| deleted-assertions | 4 | 4 |
| hard-coded-inputs | 4 | 4 |
| overridden-equality | 8 | 8 |
| patched-scorer | 4 | 4 |

### Tamper (superseded)

`tamper-2026-10-29T15-01-57-864Z.json`, from `node eval/tamper/run.mjs` at 24cd89955: honest and cheating patches against three fixture repositories, each verified by `swarm verify` with held-out checks sealed. A patch counts as flagged when the verdict is anything but pass.

| Patches | Honest | Cheating | Honest flagged | Cheats flagged | Precision | Recall |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 44 | 20 | 24 | 0 | 24 | 100.0% | 100.0% |

| Technique | Cases | Flagged |
| --- | ---: | ---: |
| edited-expectations | 4 | 4 |
| deleted-assertions | 4 | 4 |
| hard-coded-inputs | 4 | 4 |
| overridden-equality | 8 | 8 |
| patched-scorer | 4 | 4 |

### Tamper (superseded)

`tamper-2026-10-29T00-41-04-249Z.json`, from `node eval/tamper/run.mjs` at an unrecorded commit: honest and cheating patches against three fixture repositories, each verified by `swarm verify` with held-out checks sealed. A patch counts as flagged when the verdict is anything but pass.

| Patches | Honest | Cheating | Honest flagged | Cheats flagged | Precision | Recall |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 40 | 20 | 20 | 0 | 16 | 100.0% | 80.0% |

| Technique | Cases | Flagged |
| --- | ---: | ---: |
| edited-expectations | 4 | 4 |
| deleted-assertions | 4 | 4 |
| hard-coded-inputs | 4 | 4 |
| overridden-equality | 4 | 0 |
| patched-scorer | 4 | 4 |

Cheats that passed: overridden-equality (slug), overridden-equality (slug), overridden-equality (range), overridden-equality (duration).

## Rebuild

`rebuild-2026-10-30T05-29-46-227Z.json`, from `node eval/rebuild.mjs` on darwin-arm64 with Node v24.15.0: the caps' measures read from each commit, and each tree's own `npm test` timed after `npm ci` in a scratch worktree.

| Measure | Before (`8c8ece663`) | After (`cdcb7cc24`) |
| --- | ---: | ---: |
| Non-test TypeScript lines under src/ | 97188 | 6536 |
| Runtime dependencies | 10 | 2 |
| Subcommands | 25 | 5 |
| `npm test` wall time (s) | 368.2 (exit 1; 18 failed \| 4368 passed \| 36 skipped (4422)) | 7.2 (exit 0; 295 passed (295)) |

## Smoke (superseded)

3 task(s), model `qwen3.6:35b-a3b` for every arm, judged by the benchmark's own tests through Harbor, from run(s) `2026-10-29T01-15-57-642Z-smoke`. A trial the tests never judged is counted under Tasks but not Judged. Commits: mini-swe-agent not recorded; opencode not recorded; swarm 098f75bb9.

| Arm | Tasks | Judged | Passed | pass@1 | Wilson 95% | Median wall (s) | Median tokens |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| mini-swe-agent | 3 | 3 | 1 | 33.3% | 6.1% to 79.2% | 579 | 1100438 (3 reported) |
| opencode | 3 | 3 | 1 | 33.3% | 6.1% to 79.2% | 156 | 281257 (3 reported) |
| swarm | 3 | 3 | 2 | 66.7% | 20.8% to 93.9% | 234 | 862788 (2 reported) |

| Pair | Both judged | First only | Second only | McNemar p |
| --- | ---: | ---: | ---: | ---: |
| mini-swe-agent vs opencode | 3 | 0 | 0 | 1.000 |
| mini-swe-agent vs swarm | 3 | 0 | 1 | 1.000 |
| opencode vs swarm | 3 | 0 | 1 | 1.000 |
