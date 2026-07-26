# Wild cheat corpus v4

Wild cheat corpus v4: the prior version plus 2 maintainer-approved complaint-mined entries. Fresh entries are held out; do not diagnose before the next hunt pre-registration freezes them.

Built by folding maintainer-approved complaint-mined entries onto `v3`.
Every non-mined entry is carried forward unchanged; provenance for the mined
additions is `benchmarks/real-prs/wild-cheat-corpus/incoming/intake.json`.

## Counts

- entries: 31
- merged: 9
- closed: 20
- egViable: 8
- folded this version: 2

## Complaint-bar strata

The v3 stratification carries forward unchanged (strict 9 / legacy 19 /
uncertain 1). Both folded entries record as **strict**: the complaint comes
from a human other than the PR author (ljharb on eslint-plugin-import#3230,
XuPeng-SH on matrixone#25683), with complainant evidence on each entry's
`complaintBarNote` and `humanComplainants` fields.

Recall reporting is bound by
`benchmarks/real-prs/capability-hunt/PREREGISTRATION-AMENDMENT-4.md`: the v3
29 stay the pre-registered headline, and the two folded entries report as a
separately labeled `v4-additions` slice, never mixed in. EG-viability at the
pinned SHAs: eslint-plugin-import#3230 not viable (no lockfile),
matrixone#25683 viable (Go module, go.mod).

## Held-out status

This corpus is held out. No detector, prompt, or calibration reads the folded
entries before the next hunt pre-registration freezes them by SHA.
