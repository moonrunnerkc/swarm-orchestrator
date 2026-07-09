# Promotion on data (Stage 4)

The hunt's logged verdicts wired into the Wilson promotion machinery so the proof
tiers accumulate promotion evidence automatically, symmetric with the Stage 0
FP-driven auto-demotion. The regeneration cycle is demonstrated end to end.

## The cycle

**logged verdicts -> aggregation -> (maintainer fold) -> promotions output -> attestation**

1. **Logged verdicts.** Every hunt audit writes a per-PR funnel
   (`benchmarks/real-prs/capability-hunt/records/`).
2. **Aggregation.** `npm run hunt:aggregate` (`aggregate-hunt-verdicts.ts`) tallies
   the funnels into `benchmarks/real-corpus/hunt-verdict-evidence.json`: gate-trigger
   firings (the milestone catches), advisory-finding firings (the promotion
   denominator), abstain reasons, viability. Over the 30-PR backfill: **0 gate
   triggers, 0 confirmed milestone catches**, 8 advisory firing kinds.
3. **Maintainer fold.** A confirmed catch (a proven trigger that survives the FP
   protocol) is folded into `benchmarks/real-corpus/promotion-measurements.json` as
   a real-outcome precision. Absent by default (review-then-fold): nothing
   auto-promotes off an unconfirmed firing on a never-flagged PR.
4. **Promotions output.** `compute-promotions` reads the folded measurements and
   moves a tier toward gate-eligible when it clears the Wilson-95 floor with >= 5
   true positives; `check-policy` enforces the same recompute in CI.
5. **Attestation.** The promotions state is what `docs/READINESS.md` and
   `docs/CLAIMS.md` cite for the binder and claim-differential tiers.

## Symmetry, demonstrated

- **Promote on data.** With a synthetic folded measurement
  (`claimBinding: {truePositive: 6, wilsonLower: 0.92}`), `compute-promotions`
  moves `claimBinding` to **gate-eligible**; removing the fold returns it to
  **advisory-only**. So a maintainer-confirmed catch promotes the tier, and nothing
  auto-promotes without one.
- **Demote on data (Stage 0).** A still-live FP-registry firing drops a
  self-certifying trigger's Wilson bound below the bar and auto-demotes it to
  advisory (`benchmarks/results/FP-HARDENING-REPORT.md`).

Both run through the same Wilson 0.90 / 5-TP bar; neither bar was changed.

## Current state (honest)

- `claimBinding`: advisory-only, `measured: null` (no confirmed real-outcome catch).
- `claimDifferential`: advisory-only, `measured: null`.
- Derived witnesses and the binder abstain in production, so their real-outcome
  firing count from the hunt is 0; their promotion evidence is the committed twin
  measurement plus the (empty) real-outcome slot. The MECHANISM to fold a confirmed
  catch is wired and tested; it has 0 confirmed input because the hunt proved 0
  cheats and the engines abstain in production.
- `promotions:check` and `block-policy:check` both pass; gate-eligible detectors 0,
  block-eligible triggers 8, unchanged.

## Reproduce

```sh
npm run hunt:aggregate            # funnels -> hunt-verdict-evidence.json
npm run promotions:compute        # (reads promotion-measurements.json if present)
npm run promotions:check          # advisory-only stands
```

## Spend

USD 0.00. Offline aggregation and recompute over committed funnels.
