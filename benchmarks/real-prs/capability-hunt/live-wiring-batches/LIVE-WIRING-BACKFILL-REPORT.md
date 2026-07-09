# Live-wiring backfill: the complete engine set over 120 merged agent PRs

The backward arm of the capability hunt, re-run with the **complete wired engine
set** (`restoration + error-swallow + claim-binding`, live) after the live-wiring
run wired error-swallow and the Tier C binder into `swarm audit --pr` (Phase 1) and
proved them end-to-end (Phase 2, 6/6). Governed by the standing pre-registration
(`PREREGISTRATION.md`) plus amendment 1 (`PREREGISTRATION-AMENDMENT-1.md`, committed
before the first batch). Deterministic gate, no `--enable-llm-judge`, **Anthropic
spend USD 0.00**; GitHub core API + clones only.

## Population and batches

- **Population:** `live-wiring-population.json`, a fresh 120-PR agent-attributed
  fetch (per-vendor 20, 12-month window), kept separate from the frozen 60-PR
  `agent-corpus/sources.json`. Merged, agent-authored, not complaint-filtered.
- **Batches:** 8 checkpointed batches of 15 (`BACKFILL-lw-1.json` .. `-lw-8.json`),
  each recording its `engineSet` provenance. Per-audit wall-clock cap 150s.
- Every per-PR funnel is committed under `records/`.

## Result

**0 proven gate triggers across 120 PRs. No milestone candidate. No HALT.**

| metric | value |
|---|---|
| audited | 120 |
| viability (provisioned / attempted) | 46 / 115 (40%) |
| verdicts | pass 103, block 12, timeout 5, error 0 |
| proven gate triggers | **0** |
| proven milestone candidates | **0** |

`block` here means a structural block-severity advisory finding set `pass=false`;
none was a self-certifying gate trigger (`gateTriggers: {}`), so none gates and none
counts as a proven milestone catch.

## The new engines in the funnel (advisory)

- **error-swallow restoration.** 6 PRs carried a structural `error-swallow` finding
  (4 block, 4 info across re-audits; some PRs carry both). On the 4 that provisioned,
  every error-swallow finding stayed `structural-only`: the restoration engine
  proved **none** load-bearing (it abstained `not-proven:no-swallow-located` on the
  one block candidate and had no block candidate on the others). **0 proven,
  0 runtime-corroborated.** The milestone protocol is satisfied without a catch:
  re-audit of all 4 provisioned error-swallow PRs found no runtime corroboration and
  no gate trigger.
- **Tier C claim-binding.** Reached the binding stage on the provisioned slice and
  abstained (`abstain:setup-error` on the one that got that far; no
  `claim-falsified-bound`), consistent with the production limit: a `--pr` audit
  carries no green-history checkout, so the binder cannot certify a bound test as an
  oracle (deviation 8). **0 findings.**

Aggregate advisory findings (by category:severity) and abstain reasons are the sum
of the eight batch funnels; the new engines contribute the `error-swallow` findings,
the error-swallow restoration abstains, and the claim-binding `abstain:setup-error`.

## Provenance and comparability

Every batch funnel is labelled `engineSet: "restoration+error-swallow+claim-binding
(live)"`. The 30 pre-wiring PRs from capability batches 1-2
(`BACKFILL-batch-1.json`, `-2.json`) were audited **without** the two new engines and
are labelled pre-wiring; they are not blended with this run's 120.

## Interpretation

Consistent with hunts 2 through 8: the gate proves 0 genuine wild cheats, now with
the complete engine set live. The two newly wired engines run at volume and feed the
funnel (structural error-swallow flags, restoration abstains, binder abstains), but
neither produced a proven finding on legitimate merged work. A proven catch still
needs either a genuine concealment inside a provisionable PR or a wider sweep; the
nightly stream (`agent-stream.yml`) now runs the same complete set continuously,
read-only, and any proven finding halts for a maintainer before any claim is written.
