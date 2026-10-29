# Results

The only page in this repository that states measured numbers. `eval/report.mjs` writes it
from the files the evaluation recorded; nothing here is entered by hand.

## Three-arm evaluation

No three-arm results exist yet.

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
