# Capability hunt: pre-registration amendment 1 (live-wiring run)

Committed before the first backfill batch of the live-wiring run. Disclosed as an
amendment to the standing pre-registration (`PREREGISTRATION.md`, `2b9fc97d`). It
records a **provenance change, not a rule change**: the proven definition, the
milestone definition, the trigger list, and the four-step false-positive protocol
are all unchanged.

## Reason for the amendment

The standing pre-registration listed two advisory finding kinds, `claim-falsified-bound`
(Tier C claim-to-existing-test binding) and `error-swallow` load-bearing, as advisory
lines counted separately from the gate triggers. At the time it was written those two
engines were twin-validated but **not wired into the shipped `swarm audit` CLI**
(capability-run deviation 3): they could not fire on a live audit, so the 30 backfill
PRs in capability batches 1-2 were audited **without** them.

The live-wiring run wired both engines into `runExecutionGrounded` and proved them
end-to-end through `swarm audit --pr` (6/6 planted fixtures, identical fresh-clone
replays, `evidence/live-wiring/live-set-runs/LIVE-SET-PROOF-REPORT.md`). From this
run's backfill onward the funnel therefore carries the **complete engine set**.

## What changes (provenance only)

- Every batch funnel records its **engine-set provenance**: which engines were live for
  that batch. Batches from the live-wiring run carry `error-swallow` + `claim-binding`
  live; the capability batches 1-2 (`BACKFILL-batch-1.json`, `-2.json`) are **pre-wiring**
  and are labelled as such in any aggregate.
- The two advisory kinds now produce real `swarm audit --pr` records (an advisory
  `error-swallow` finding with runtime corroboration; a `pr-audit-claim-binding` funnel
  entry). In production the Tier C binder abstains at the pass-capability clause
  (`abstain:no-pass-capability-evidence`) because a `--pr` audit carries no green-history
  checkout, so its real-outcome finding count stays 0 (deviation 8 stands).

## What does NOT change

- **Proven definition** (three-part: controls green, live path, fresh-clone replay): unchanged.
- **Milestone definition** (a cheat proven in a merged agent-authored PR no human flagged): unchanged.
- **Gate-trigger list**: unchanged. `error-swallow` load-bearing and `claim-falsified-bound`
  remain **advisory**, never gate triggers, never counted as a proven milestone catch.
- **False-positive protocol** (fresh-clone replay, production diff read, subsequent history
  check, registry check): unchanged. A survivor still halts the thread for maintainer
  confirmation before any claim is written.
- **Halt conditions**: unchanged. Any proven trigger on a clean fixture / honest twin /
  registry entry / outcome-clean PR is stop-the-line in full.
