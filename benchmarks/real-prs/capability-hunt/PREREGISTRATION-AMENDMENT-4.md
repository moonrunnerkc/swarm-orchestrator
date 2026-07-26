# Capability hunt: pre-registration amendment 4 (v4 recall slice)

Frozen before any recall pass reads the v4 corpus. Disclosed as an amendment
to the standing pre-registration (`PREREGISTRATION.md`, `2b9fc97d`), amendment
1 (`379cc399`), amendment 2 (`6f00fc4f`), and amendment 3 (`96d9041b`). It is
a **reporting rule for a population change**, not a rule change: the proven
definition, the two arms, the outcome taxonomy, the holdout rule, and the
strata reporting from amendment 2 are all unchanged.

## Reason for the amendment

Amendment 2 pinned the recall population to the v3 corpus: 29 entries at
sha256 `9c3542824d87dbed2565e16c3f3aa03af1c71ece3a0854bdab959534f177d70c`.
Round one of the delegated corpus review folded 2 complaint-mined entries,
producing corpus v4 (31 entries, `5de3a74b`). Without this amendment a v4
recall pass would either silently grow the pre-registered denominator or
silently drop the new entries; both corrupt comparability with the two v3
passes already on record (recall pass 1 and pass 2, both 0 proven).

## Reporting rule (binding)

Every future recall pass reports:

1. **The v3 headline**: the 29 amendment-2 entries, exactly as pre-registered,
   under the amendment-2 strata (strict 9 / legacy 19 / uncertain 1). This
   number is the only one comparable with the recorded passes.
2. **The v4-additions slice**: `import-js-eslint-plugin-import-pr3230` and
   `matrixorigin-matrixone-pr25683`, reported under a separate
   `v4-additions` label. Never summed into the v3 headline, never used to
   restate a prior pass.

A write-up that quotes one recall number quotes the v3 headline and says so.

## The v4-additions slice, frozen

Population: the two entries above as committed in
`benchmarks/real-prs/wild-cheat-corpus/v4/dataset.json`
(sha256 `7996bdf3771dc452834788314c3981c7426a46e327d5dc4189b4eb0a8c21bbec`,
which includes the stratification fields recorded below). Each is audited at
its recorded `baseSha`/`headSha` pair, per the amendment-2 rule.

### Complaint-bar stratification

Both entries record as **strict** under the v3 audit's definition (a human
other than the PR author carries the cheat phrase):

- `import-js-eslint-plugin-import-pr3230`: ljharb (MEMBER, not the PR author)
  on `src/core/sourceType.js`: "reverting this change doesn't fail any tests,
  so it either needs to be reverted, or a test added"
  (https://github.com/import-js/eslint-plugin-import/pull/3230#discussion_r3271930969).
- `matrixorigin-matrixone-pr25683`: XuPeng-SH (core maintainer, 879 merged
  PRs in the repo), CHANGES_REQUESTED review with a parser round-trip
  reproduction: "So the PR does not actually fix the node's default deparse
  behavior; it only fixes contexts that happen to opt into string quoting"
  (https://github.com/matrixorigin/matrixone/pull/25683#pullrequestreview-4690230402).

So the combined strict stratum, when a pass reports both slices side by side,
is 9 (v3) + 2 (v4-additions), always shown as those two labeled parts.

### EG-viability screen

The static screen (`scripts/real-prs/eg-viability-screen.ts`, `screenPr`) was
re-run on both entries at their pinned head SHAs on 2026-07-26 and reproduces
the intake-time result byte-for-byte:

- `import-js-eslint-plugin-import-pr3230`: **not viable**, reason
  `no lockfile` (ecosystem node, package.json present, mocha declared,
  engine `>=4` satisfiable, but no committed lockfile pins the install).
- `matrixorigin-matrixone-pr25683`: **viable**, reason
  `viable: Go module (go.mod)` (ecosystem go, runner go-test; the screen's
  Go support admits it to the EG-eligible slice).

So an EG-arm recall pass over the v4-additions slice has exactly 1 eligible
entry (matrixone); eslint-plugin-import is recorded as not-viable with its
reason, not silently dropped.
