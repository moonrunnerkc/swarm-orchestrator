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

## Round 2: build `1fb954b53`

Manifest `~/.cache/swarm-study-2026-10-23c/confirm-2/manifest.json`, sha256
`6a40a7ca7dd3cfa4a72b752129dbb388d0a1c989aa49a31bfab8c1babd303a31`, same harness digest as
round 1. Preflight: 6 of 6. All six launches scored.

**The correction fired, and repair proceeded.** Every run whose reading the change left unmeasured
now reads `unmeasured by the change`, and none stopped as `setup` on it.

| Launch | Attempts kept / used | Lint at attempt 0 | Lint after attempt 1 | Hidden before repair | Hidden delivered | Product |
| --- | --- | --- | --- | --- | --- | --- |
| ufo feature `swarm` | 0 / 3 | base finding + `test/query.test.ts` | base finding only | (no change kept) | fail | refused |
| ufo feature `swarm-control` | 0 / 3 | base finding + `src/utils.ts`, `test/query.test.ts`, 1 eslint problem | base finding only | (no change kept) | fail | refused |
| ufo bug fix `swarm` | 2 / 3 | base finding + `src/utils.ts`, `test/base.test.ts` | base finding only | pass | pass | refused |
| ufo bug fix `swarm-control` | 3 / 3 | base finding + `src/utils.ts`, `test/base.test.ts` | base finding only | fail (kept check) | fail (kept check) | refused |
| nanoid `swarm-control` | 2 / 3 | not applicable | not applicable | fail | fail | refused |
| nanoid `swarm` | 0 / 0 (stopped as setup on a failed preparation of its own check) | not applicable | not applicable | (no snapshot) | fail | refused |

"Base finding" is prettier's report of `src/punycode.ts`, which the unchanged base has.

**What it shows.**
- In every ufo run, the first repair removed every lint finding the change had added.
- **ufo feature.** The ratchet rejected those repairs. Each touched a file outside the declared
  file set without recording an amendment, and the file-set gate failed. So the attempt-0
  candidate was delivered, and this time it failed the hidden behaviour check.
- **ufo bug fix.** The repairs were kept. The final verification reads lint as inherited and
  regression as pass.
- Repair changed no hidden verdict in either direction. The candidates before and after repair
  were scored offline from the runner's own snapshots, with the corrected scorer.
- The ufo bug fix `swarm-control` candidate already failed the hidden kept-behaviour check before
  repair. That preservation regression was in its first candidate, and no check in the run
  measured it.

**What it leaves.** The product still refused the ufo bug fix `swarm` candidate, which the hidden
evaluator passes, whose final verification reads regression pass, and whose lint reports only
what the base reports. The reason given is `blocking gate(s) failed: lint`. The loop's blocking
lint gate fails as it fails on the base, and nothing in the run's settlement reads that failure
as inherited. So on a project whose blocking lint already fails, no change that leaves that
failure alone can be accepted. That is the next defect. It is not corrected here, because it
changes what an acceptable verdict means and how the verifier re-derives it.

The review was withheld in every `swarm` launch: the gates never went green.
