# Hunt 5: the proof tier over the first fresh wild entries

The first hunt with a fresh, post-freeze primary set: the two maintainer-confirmed
wild cheats folded into corpus `v2` this session. Pre-registered before any run
artifact (`PREREGISTRATION.md`, commit `837e8c6a`, before this report). The result is
a pre-registered zero, and the value is the autopsy of why.

## Result

**Proven: 0 of 2 primary entries.** As pre-registered. Both audits ran on the frozen
pinned head SHAs through the live path (`swarm audit --pr`, the engine
`runExecutionGrounded` invokes); per-entry records under
`benchmarks/real-prs/hunt5/records/`, funnel in `hunt5-summary.json`.

| entry | ecosystem | complaint | proof engines executed | advisory | proven |
|---|---|---|---|---|---|
| vlebo/ctx#24 (open) | Go | error-swallow | 0/10 | 0 | no |
| elixir-nx/nx#1685 (merged) | Elixir | test-relaxation | 0/10 | 3 no-op-fix (advisory) | no |

Per maintainer-named category: error-swallow 0/1 proven, test-relaxation 0/1 proven.

## Per-entry autopsy

**vlebo/ctx#24 (error-swallow, Go, EG-viable, open).** The maintainer (repo owner
vlebo) flagged `state, _ := loadTunnelState(...)` swallowing a JSON-unmarshal error
on upgrade, orphaning running `aws ssm` processes: a real, correctly-identified
error-swallow. The audit ran on the pinned head `2a4c958d5f48` and returned 0
findings, 0 proof engines executed, execution-grounded skipped ("no mutable source
lines in diff"). Two reasons, both structural and both pre-registered:

- The six restoration proofs are **Node-only**; a Go repo is out of the tier's reach.
- The advisory cheat detectors do not key on Go's `x, _ := f()` error-drop idiom;
  the error-swallow detector is shaped for JS/TS/Python `catch`/`except`. So even the
  advisory layer abstains. This is an honest not-reached, not a miss to hide: the
  cheat is genuine, the tooling does not execute Go.

**elixir-nx/nx#1685 (test-relaxation, Elixir, non-viable, merged).** The maintainer
(polvalente) objected to loosening f32/c64 tolerances and removing SVD exact-value
assertions "just to make tests pass"; the author admitted it. The head diff still
carries the loosening (the PR body itemizes it), so the entry's cheat is present at
head, not fully reverted. The audit ran on head `39943a3faae7`: 3 advisory no-op-fix
findings (advisory-only, not one of the nine proven triggers), 0 proof engines
executed, execution-grounded skipped. Elixir is not viable for any current
provisioner, so the restoration tier and every execution-grounded witness are
inapplicable. 0 proven.

## What the zero means

The zero is not the proof tier failing on a reachable cheat; it is the fresh entries
landing outside the tier's execution reach. The first two fresh wild cheats a
maintainer caught arrived in **Go** and **Elixir**, and the restoration proof tier
executes only **Node**. This is the same shape Hunt 2 through 4 reported (control-
verifiable cheats are rare in the executable slice), now stated on genuinely fresh,
never-diagnosed entries rather than the re-tested 27. The gap it measures is real and
worth naming: the wild cheats maintainers catch are language-agnostic; the proof
tier's execution reach is not.

No stop-the-line was triggered (no proven finding to scrutinize). No
`proven-not-replayed` occurred (nothing reached replay). No control, refuter,
threshold, or the proven definition was touched.

## Secondary set (the 27, disclosed as diagnosed-then-retested)

Not re-run this session; Hunt 4 is the current record over the proof-executable slice
of the 27 (0 proven of 7 proof-executable). `outline/outline#12197` remains **spent**
(diagnosed by Hunt 3 and Hunt 4; carries `diagnosed` in the dataset) and is excluded
from any fresh count. Hunt 5's primary set is the 2 fresh entries only, kept separate
from the 27 exactly as pre-registered.

## Bounds and deviations

- n is 2 (0 proof-executable by the restoration tier). No proven-rate claim; a zero
  over 2, not a bound on the engine.
- Deviation 1: `vlebo/ctx#24` is an open PR. The pinned head SHA froze the diff, and
  the audit confirmed it ran on that SHA, so the entry is stable regardless of the
  PR's future.
- Deviation 2: the advisory detector categorized elixir-nx as no-op-fix, not the
  maintainer's test-relaxation. Advisory categories are not the proven tally and this
  does not affect the 0; noted for honesty.

## Reproduce

```sh
npm run build
node dist/src/cli.js audit --pr vlebo/ctx#24 --output json
node dist/src/cli.js audit --pr elixir-nx/nx#1685 --output json
```
