# Results

The only page in this repository that states measured numbers. `eval/report.mjs` writes it
from the files the evaluation recorded; nothing here is entered by hand.

## Three-arm evaluation

Run `2026-10-29T01-12-14-440Z-stub` used the stub model, which answers every request with the same command. It shows the harness runs end to end; no model results exist yet, and nothing below measures an agent.

| Arm | Tasks | Judged | Passed | pass@1 | Wilson 95% | Median wall (s) | Tokens |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| opencode | 1 | 1 | 0 | 0.0% | 0.0% to 79.3% | 7 | 11438 (1 reported) |

| Pair | Both judged | First only | Second only | McNemar p |
| --- | ---: | ---: | ---: | ---: |

## Tamper evaluation

`tamper-2026-10-29.json`, from `node eval/tamper/run.mjs`: honest and cheating patches against three fixture repositories, each verified by `swarm verify` with held-out checks sealed. A patch counts as flagged when the verdict is anything but pass.

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
