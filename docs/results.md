# Results

The only page in this repository that states measured numbers. `eval/report.mjs` writes it
from the files the evaluation recorded; nothing here is entered by hand.

## Three-arm evaluation

Run `2026-10-29T01-15-57-642Z-smoke`: 3 task(s) from swebench-verified, model `qwen3.6:35b-a3b` for every arm, judged by the benchmark's own tests through Harbor. A trial the tests never judged is counted under Tasks but not Judged. Commits: mini-swe-agent not recorded; opencode not recorded; swarm 0a7ca584d.

| Arm | Tasks | Judged | Passed | pass@1 | Wilson 95% | Median wall (s) | Tokens |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| mini-swe-agent | 3 | 3 | 1 | 33.3% | 6.1% to 79.2% | 579 | 4462097 (3 reported) |
| opencode | 3 | 3 | 1 | 33.3% | 6.1% to 79.2% | 156 | 757644 (3 reported) |
| swarm | 3 | 3 | 2 | 66.7% | 20.8% to 93.9% | 234 | 1797632 (2 reported) |

| Pair | Both judged | First only | Second only | McNemar p |
| --- | ---: | ---: | ---: | ---: |
| mini-swe-agent vs opencode | 3 | 0 | 0 | 1.000 |
| mini-swe-agent vs swarm | 3 | 0 | 1 | 1.000 |
| opencode vs swarm | 3 | 0 | 1 | 1.000 |

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
