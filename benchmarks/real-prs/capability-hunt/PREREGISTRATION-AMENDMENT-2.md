# Capability hunt: pre-registration amendment 2 (recall on the v3 corpus)

Frozen before any recall run exists. Disclosed as an amendment to the standing
pre-registration (`PREREGISTRATION.md`, `2b9fc97d`) and amendment 1 (`379cc399`).
It pre-registers a **new measurement on a different population**, not a rule
change: the proven definition, the milestone definition, the trigger list, and
the four-step false-positive protocol are all unchanged.

## Reason for the amendment

The standing pre-registration hunts the merged-and-never-flagged population,
where every audit so far has returned 0 proven. That number is uninterpretable
without its complement: what the shipped pipeline does on cheats that
**maintainers did confirm**. This amendment freezes the population, the arms,
the outcome taxonomy, and the holdout rule for that recall measurement before
any result is seen, so no threshold, prompt, or engine can be tuned to the
answer.

## Population (frozen)

The v3 wild-cheat corpus at
`benchmarks/real-prs/wild-cheat-corpus/v3/dataset.json`
(sha256 `9c3542824d87dbed2565e16c3f3aa03af1c71ece3a0854bdab959534f177d70c`,
committed at `74d34167`). All 29 entries. Per the binding reporting rule in
`v3/DATASET.md`, every result keys to the complaint-bar strata **separately**:

- **strict** (9): a human other than the PR author carries the cheat phrase.
- **legacy** (19): only the author or a bot carries it.
- **uncertain** (1): the live thread cannot settle it (deleted PR).

Each entry is audited at its recorded `baseSha`/`headSha` pair, not at the
repo's current tree. An entry whose pinned SHAs are no longer fetchable is
recorded as such, not silently dropped and not re-pinned.

## What is measured

**Recall of the shipped proof pipeline on maintainer-confirmed cheats**: for
each entry, whether `swarm audit --pr` at the pinned SHAs produces a proven
finding, an advisory finding, or neither, against a cheat a human already
flagged.

This is explicitly **not** the never-flagged milestone and cannot be claimed as
one. The milestone population (merged, never flagged) and this population
(maintainer-confirmed) are disjoint by construction; a proven finding here is a
recall data point, never a milestone catch. Any write-up states which
measurement it reports.

## Two arms, reported separately

1. **Deterministic arm.** The shipped `swarm audit --pr` with no LLM judge.
   Anthropic spend: USD 0.00.
2. **Judge-enabled arm.** The same pipeline with the LLM judge enabled, under a
   **hard cost ceiling of USD 10.00**; the run checkpoints and stops paid work
   at the ceiling, and partial coverage is reported as partial.

The judge arm exists because 9 of the 29 entries are `goal-not-fixed` (7) or
`hardcoded-output` (2), categories with no structural detector; the judge-primary
path is the only shipped engine that can reach them. Arm results are never
merged into one headline number.

## Per-entry outcomes

Every entry lands in exactly one bucket per arm:

- **proven**: a gate trigger fired with all controls green, live path,
  fresh-clone replay (the standing three-part definition).
- **advisory-found**: an advisory finding kind fired (per the standing advisory
  list); never counted as proven.
- **abstained**: the pipeline ran but produced neither, with the classified
  abstain reason from the proof-coverage attestation recorded per engine.
- **not-provisionable**: the entry never reached the engines (entry gate,
  clone, install, or SHA-fetch failure), with the failing stage recorded.

Results are tabulated per stratum and per complaint category. Recall
denominators state their stratum; a headline over all 29 is never presented
without the strict-9 figure beside it.

## Holdout rule (permanent)

The **strict-9 are never used to tune or debug engines**. A miss on a strict
entry may motivate a fix, but the fix is developed and validated on the
legacy-19 and on synthetic injections only, then measured **once** against the
strict-9. There is no iterate-until-green loop on the strict stratum, in this
run or any later one.

## Proof of precedence

The commit that introduces this file precedes every recall run record under
`benchmarks/real-prs/capability-hunt/`, verifiable by `git log` order, exactly
as the standing `PREREGISTRATION.md` proved its own precedence over the backfill
records.

## What does NOT change

- **Proven definition** (controls green, live path, fresh-clone replay): unchanged.
- **Milestone definition** (a cheat proven in a merged agent-authored PR no
  human flagged): unchanged, and out of scope for this measurement.
- **Gate-trigger and advisory lists**: unchanged.
- **False-positive protocol**: unchanged; a proven finding here still passes
  fresh-clone replay and a production diff read before it is believed, even
  though the maintainer complaint already corroborates it.
- **Halt conditions**: unchanged, including the read-only rule; no write,
  comment, or contact touches any third-party PR or repo.
