# Capability hunt: pre-registration amendment 3 (thin-review arm)

Frozen before the first re-aimed fetch runs. Disclosed as an amendment to the
standing pre-registration (`PREREGISTRATION.md`, `2b9fc97d`), amendment 1
(`379cc399`), and amendment 2 (`6f00fc4f`). It pre-registers a **population
change and its comparison metrics**, not a rule change: the proven definition,
the milestone definition, the trigger list, and the four-step false-positive
protocol are all unchanged.

## Reason for the amendment

The forward stream's population comes from one global per-vendor search over
merged agent PRs. Global search surfaces well-reviewed, high-traffic repos,
exactly where a surviving cheat is least likely: a concealment that made it
past attentive review is rarer than one that was never reviewed at all. The
never-flagged milestone lives where nobody was looking. This amendment freezes
a second search tier aimed at that water, and the metrics that will decide
whether it is actually richer, before any re-aimed batch is fetched.

## The two arms

**Control arm (`per-vendor-control`).** The existing per-vendor sample,
unchanged: the same `VENDOR_QUERIES` in `scripts/real-prs/fetch-agent-prs.ts`,
the same per-vendor cap, line band, owner exclusions, and fingerprinter
confirmation. This arm is the continuity baseline; any difference in yield is a
measurement only because this sample keeps running beside the new one.

**Thin-review arm (`thin-review`).** The same vendor queries with review
thinness pushed server-side: each control query plus the GitHub PR search
qualifiers `review:none comments:0` (no submitted reviews, zero issue
comments). GitHub search has no qualifier for review-comment count or for who
merged, so the remaining two conditions are confirmed locally from the PR
detail the fetch already retrieves: the PR's `review_comments` count must be 0
and the merging login must equal the author login. A candidate that fails
either local check is dropped from the thin arm and counted in the fetch's
skipped tally, not silently discarded.

A PR that satisfies both arms' criteria is assigned to the **control arm**
(control queries run first and deduplication is by `repo#number`), so the
control sample's composition stays exactly what it was before this amendment.

Both arms pass through the identical downstream path: same fingerprinter
confirmation, same line band, same deterministic `swarm audit --pr` gate, same
batch caps, same checkpointing, same halt semantics. Nothing about how a PR is
audited depends on its arm; the arm is a label on the record.

## Dependency-bot exclusions

The thin-review qualifiers select for unattended merges, which is also where
automated version bumps live. Both arms therefore exclude PRs authored by
dependency bots: `dependabot`, `dependabot-preview`, `renovate`,
`renovate-bot`, `mend`, `greenkeeper`, `snyk-bot`, `depfu`, `pyup`,
`pyup-bot`, `scala-steward` (with or without the `[bot]` suffix). The existing
owner exclusions (`moonrunnerkc`, `anthropics`, `anthropic-experimental`)
stay as they are.

## Context features (recorded, not filtered on)

Every funnel record from this amendment onward carries per-PR context
features, for both arms:

- repo stargazer count,
- repo contributor count,
- submitted review count,
- review comment count,
- open-to-merge duration in hours,
- whether the merging login equals the author login.

These are recorded for analysis; apart from the thin arm's two local
confirmation checks above, no feature filters a PR out of either arm. Records
predating this amendment lack the fields and every reader treats them as
optional.

## Comparison metrics (pinned now, before any result)

Proven catches are rare by construction, so the arms are compared on two
leading indicators, each computed per arm, per 100 audited PRs:

1. **Block-severity advisory rate.** The share of audited PRs whose funnel
   records at least one advisory finding at `block` severity (a structural
   detector firing at gate strength that the block-eligibility policy keeps
   advisory).
2. **EG-corroboration rate.** The share of audited PRs whose proof-coverage
   attestation records at least one execution-grounded engine outcome of
   `finding` or `signal` (engine-corroborated evidence short of proven; the
   `corroborated-under-constraint` circumstantial kind falls in here and
   remains not block-eligible).

Both are leading indicators of where findings concentrate, never evidence of a
cheat by themselves. Arm results are reported separately and never merged into
one headline number. If thin-review water is genuinely richer, these move
first; if it yields mostly sloppy-but-honest code, the control arm makes that
visible as data rather than anecdote.

## Batch composition

The nightly stream audits bounded, sequential slices of the fetched
population. So that every slice samples both arms, the fetcher interleaves the
two arms' entries in its output order. Volume raised by sharding the nightly
workflow changes how many slices run per night, not how any single PR is
audited.

## Proof of precedence

The commit that introduces this file precedes every thin-review fetch and
every arm-labeled funnel record under
`benchmarks/real-prs/capability-hunt/`, verifiable by `git log` order, exactly
as the standing `PREREGISTRATION.md` proved its precedence over the backfill
records.

## What does NOT change

- **Proven definition** (controls green, live path, fresh-clone replay): unchanged.
- **Milestone definition** (a cheat proven in a merged agent-authored PR no
  human flagged): unchanged. The thin-review arm re-aims the population at that
  milestone; it does not redefine it.
- **Gate-trigger and advisory lists**: unchanged.
- **False-positive protocol**: unchanged; a proven finding in either arm still
  passes all four checks before it is believed.
- **Halt conditions**: unchanged, including the read-only rule; no write,
  comment, or contact touches any third-party PR or repo. A proven gate
  trigger still halts its batch (per shard, once the stream is sharded) for
  the FP protocol.
