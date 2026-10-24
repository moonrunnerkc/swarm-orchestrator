# Confirmation launches

Under the [registered protocol](confirmation-protocol.md), on the fresh block's exposed tasks,
`qwen3.6:35b-a3b` through local Ollama, one sequence at a time, the block's budgets.

## Round 1: build `fa9b90055`

Manifest `~/.cache/swarm-study-2026-10-23c/confirm/manifest.json`, sha256
`4cd02dc92a41dcfdf7e97e6d9c649c2c061ac40c23eaf7638b2f28223d6d3fc1`. Preflight: 6 of 6. All six
launches scored.

**The correction did not fire.** Every run whose reading the change left unmeasured still read
`setup unavailable`, and repair stopped as `setup` with its attempts unused. The rule required no
check to carry an `unavailable` text. A check that stands down because the project declares no
such script (no typecheck script, no check-only format script) carries its absence there, so on
any real project the rule was false. The unit tests had not used that shape.

| Launch | Hidden | Product | Stop | Attempts used |
| --- | --- | --- | --- | --- |
| ufo feature `swarm` | fail | refused | `repair-unavailable` (setup) | 0 |
| ufo feature `swarm-control` | pass | refused | `repair-unavailable` (setup) | 0 |
| nanoid `swarm-control` | fail | **accepted** | completed | 2 |
| nanoid `swarm` | fail | refused | `repair-unavailable` (setup) | 1 |
| ufo bug fix `swarm` | pass | refused | `repair-unavailable` (setup) | 0 |
| ufo bug fix `swarm-control` | pass | refused | `repair-unavailable` (setup) | 0 |

The nanoid `swarm-control` launch is a false accept: the product accepted a change the hidden
evaluator fails. The review was withheld in all three `swarm` launches (gates never green).

Corrected in [amendment 10](intended-files.md). Applied to every recorded verification of the fresh
block and of this round, the corrected rule reads all 15 mislabelled cases as unmeasured by the
change, and the 3 that were not unmeasured as before.
