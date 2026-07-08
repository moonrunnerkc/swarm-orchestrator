# Documentation truth sweep: inventory (soundness run Phase 2)

Two classes of stale claim were swept. The sweep covered `src/`, `docs/`, `scripts/`,
`README`, `CHANGELOG`, and the benchmark/report tree; committed historical reports
were read to locate overstatements but corrected only by dated appends, never by
rewrite.

## Class A: witness compilation described as pinned / deterministic / temperature-0

**Result: zero current-state corrections needed.** Every current-state description
of the claim-differential witness compile already states the truth: the witness
model (`claude-sonnet-5`) rejects an explicit temperature, so the compile is
`temperature-unset` / recorded-not-pinned, and the sampling policy is written into
the ledger. The prior (lift) run fixed this; this run verified it.

Verified-clean current-state sites (left unchanged):

- `src/audit/execution-grounded/claim-witness.ts` (samplingPolicy JSDoc)
- `src/audit/execution-grounded/claim-llm.ts` (`WITNESS_SAMPLING_POLICY`, the
  temperature-omitted comment)
- `src/audit/execution-grounded/claim-witness-compile.ts` (provenance plumbing)

New current-state statement of the truth (added this run):

- `benchmarks/oracle-corpus/proof-protocols.md`: a "Witness compilation is recorded,
  not pinned" paragraph in the new claim-differential section, stating the
  model-rejection reason and that it is permanent on this model.

Historical reports mentioning witness determinism were checked and are **already
self-correcting** (they say nondeterministic / temperature-unset), so no dated
correction note was required for Class A: `benchmarks/real-prs/hunt4/HUNT-4-REPORT.md`,
`benchmarks/real-prs/hunt3/HUNT-3-REPORT.md`,
`benchmarks/twins/CLAIM-DIFFERENTIAL-HARDENING-REPORT.md`,
`evidence/lift/EVIDENCE-REPORT.md`, `evidence/frontier/EVIDENCE-REPORT.md`.

## Class B: `claim-falsified-synthesized` described as self-certifying / gate-eligible / proven

**The live gate machinery was already correct** and is unchanged: the verdict is not
in `ALL_BLOCK_TRIGGER_KINDS` (`block-trigger-types.ts`) or `SELF_CERTIFYING_TRIGGERS`
(`self-certifying.ts`), and `computeClaimDifferentialPolicy` keeps it advisory-only
until a folded measurement clears Wilson-95 lower >= 0.9 with >= 5 true positives.
`npm run promotions:check` passes (`gate-eligible=0, advisory=10`).

Corrected current-state code (the one overstatement in live scripts):

| file | before | after |
| --- | --- | --- |
| `scripts/real-prs/hunt3.ts` (`deriveStatus` + JSDoc) | a controlled `claim-falsified-synthesized` returned `status: 'proven-block'` | returns `status: 'claim-differential-advisory'` with an ADVISORY-pending-measurement note; only a restoration proof is `proven-block`. (After the discrimination control this path is also unreachable in production.) |
| `test/real-prs/hunt3.test.ts` | asserted the synthesized finding maps to `proven-block` | asserts it maps to `claim-differential-advisory`, NOT proven |
| `scripts/real-prs/hunt3.ts` (summary `provisioned` count) | counted only `ran-no-proof`/`proven-block` | counts any status except `not-provisioned`/`error` (so the new advisory status counts) |

New pin test added (the invariant this run protects):

- `test/audit/gate/claim-falsified-synthesized-not-gating.test.ts`: asserts the
  synthesized verdict is neither a block-trigger kind nor a self-certifying trigger,
  and is distinct from the issue-repro `claim-falsified` (which does gate).

Left as-is, with reason:

- `scripts/real-prs/hunt4-diagnose-outline.ts` header uses "proven-block" as the
  label it **refutes** (the whole script diagnoses the outline fire as a false
  positive); self-correcting, not an assertion of proven.
- Committed hunt run artifacts (`hunt4-summary.json`, `records/*.json` with
  `status: proven-block` for outline) are dated history and are not rewritten; the
  `HUNT-4-REPORT.md` already documents the outline fire as a diagnosed false
  positive (0 truly-proven), and the dataset entry is now annotated `diagnosed`.

Dated appends to historical reports (append, never rewrite):

- `benchmarks/real-prs/hunt4/HUNT-4-REPORT.md` and
  `benchmarks/twins/CLAIM-DIFFERENTIAL-HARDENING-REPORT.md`: an "UPDATE 2026-07-08"
  note that the disclosed discrimination control is now landed and measured, with
  the outline replay outcome.

## Regeneration

Nothing auto-generated embeds the corrected language except the hunt summaries,
which are regenerated only by re-running the (token/credit-gated) hunt scripts;
re-running is out of scope and would rewrite committed run history, so the scripts
now state present truth for future runs while the dated artifacts stand as history.
