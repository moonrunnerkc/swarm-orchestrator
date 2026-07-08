# Wild cheat corpus v3

v3 is v2's 29 entries carried forward byte-identical, plus a `complaint_bar`
stratification. **No entry was added, removed, or reclassified.** The only change
from v2 is four new per-entry fields (`complaintBar`, `complaintBarNote`, `solo`,
`humanComplainants`) recording who authored the complaint, reconstructed from a live
thread re-fetch because fold-time capture never stored it.

Built by `scripts/real-prs/mining-verification/complaint-bar-audit.ts`. Full
methodology, the per-entry table, and the decision material for the published
"27 maintainer-flagged" claim are in
`benchmarks/real-prs/wild-cheat-corpus/COMPLAINT-BAR-AUDIT.md`.

## Strata

- **strict** (9) — a human other than the PR author currently carries a cheat phrase.
  The independent-maintainer bar. One of the 9 (pwncollege/ctf-archive#133) hinges on a
  `-bot`-suffixed User account posting automated verdicts; a content-aware bar reads it as
  8. See the audit's edge-case note.
- **legacy** (19) — only the PR author (self) or a bot carries a cheat phrase. Present
  under the original loose miner, fails the strict bar. `solo: true` marks the 6 whose
  only complaint is a repo-owner self-flag (a maintainer critiquing their own agent PR):
  a real signal of a different kind, not the strict bar and not noise.
- **uncertain** (1) — the live thread cannot settle it. flipflowglobal/D.L#47 is deleted.

## Counts

- entries: 29 (v1: 27, folded at v2: 2)
- strict: 9 | legacy: 19 | uncertain: 1
- solo-maintainer self-flag (subset of legacy): 6

## Reporting rule (binding from now on)

Every downstream report and every hunt keys results to these strata **separately**. A
headline count over the corpus states which bar it uses. "27 maintainer-flagged" is the
loose bar; the strict-bar figure is 7 of the 27 (6 content-aware). The published claim
and its correction are the maintainer's decision; the corpus records both.

## Held-out status

Unchanged from v2. This corpus is held out; no detector, prompt, or calibration reads the
folded entries before a hunt pre-registration freezes them by SHA. Stratification is a
label on complaint authorship, not a tuning signal, and reads no cheat-detection output.

## Temporal-drift caveat

The `complaintBar` values are a live reconstruction (2026-07-08), not frozen capture
evidence: the fold-time schema never recorded comment authorship. A comment deleted or
edited between original capture and the re-fetch is invisible to the reconstruction. The
`uncertain` stratum holds only entries the live thread cannot settle at all.
