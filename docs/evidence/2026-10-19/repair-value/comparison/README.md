# The paired comparison (launches C1 and C2)

Registered by [amendment 1](../protocol.md) before either arm, on `marked-bugfix-www-case`, a task
from a repository not used to develop this work. The manifest ([manifest.json](manifest.json)) was
frozen by [../freeze-comparison.mjs](../freeze-comparison.mjs) and run by the comparison runner
unchanged, one arm at a time, Swarm first by the runner's own order rule. The runner's records are
in [records/](records/), every blob they cite (patches, streams, the oracle's output) is in
`blobs/`, and the Swarm arm's sessions are in `sessions/`; streams, blobs and ledgers are packed
losslessly.

| arm | build | agent minutes | tokens | the product's own reading | hidden oracle on the exact patch |
| --- | --- | --- | --- | --- | --- |
| Swarm | `e2b0fe77c`, `--plan-checks` | 13.5 | 1,734,080 | `not-accepted`, exit 1: the wall was spent and the final build, lint and tests gates were cancelled | **fail**: the `text` rule still stops only before lowercase schemes |
| OpenCode | 1.14.48 | 1.8 | 600,716 | exit 0, success claimed | **pass** |

On this one task OpenCode delivered a correct patch and Swarm did not; Swarm did not claim its wrong
patch. One task cannot show either agent better in general. Swarm's first concrete failure is in
planning: its check of the scheme rule was declared as preserved behaviour, as the task's wording
reads, and refused because the base does not satisfy it; nothing admitted covered the `text` rule.
Both arms had the same model, task text, visible check and 15-minute limit, and no correction.
