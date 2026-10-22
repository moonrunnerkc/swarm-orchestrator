# Held-out candidate selection, before reading candidate solutions

Select one candidate per family from each repository in portfolio.md. Use public non-merge
commits before September 1, 2026, newest first. Family match uses only the subject:
compatibility (upgrade, bump, compatibility, dependency/dependencies, drop support), refactor
(refactor, simplify, extract, rework, deduplicate), feature (add, support, implement, introduce),
bug fix (fix, correct, regression, handle). Assign in that order, excluding already selected
commits. Prefer commits changing two or more non-documentation files, including a source or
package/dependency file. Record title, full parent and change SHA and changed paths, without
reading the patch. Exclude the six exposed repositories categorically. If a repository lacks a
family candidate, retain a named unfilled slot; never relabel another family to fill the target.

These metadata-selected candidates are not yet sealed tasks. Human/evaluator review must confirm
actual family, meaningful scope, task wording and exposure before worker inference. Generated
subject filters cannot establish those properties. No solution patches or hidden cases are
available to workers through this inventory. No held-out inference is authorized by selection.


## Selection amendment, after metadata-only pass

The initial rule found 19 candidates and no qualifying p-limit refactor. Fill that one slot
from sindresorhus/p-queue using the same cutoff, ordering and refactor rule; inspect no patch.
Retain the original unfilled-slot record. This expands repository coverage to six and changes
no task outcome, since no held-out task has been given to a worker.


## Exposure and metadata review amendment

The tracked-text and 161 expanded-archive scan found click commit `a1d87858` in the earlier
replacement pilot. Exclude that task. Metadata review also found documentation-only subjects,
dev lockfile additions and a version-only release bump. Exclude these subjects and require an
authored source file outside tests, documentation, scripts and configuration. Repeat the same
ordered selection with these exclusions before reading any solution. Retain the rejected first
inventory and scan in the evidence archive. This is feasibility/exposure filtering, not filtering
by an arm's outcome. Semantic-equivalence review and hidden evaluator construction remain owed.

The second scan found attrs feature `5aa76a44` and bug fix `97f8d175` in the September 14
replacement pilot. Exclude both identities and repeat the same metadata rule. The archived
second inventory and scan retain the rejected candidates. No held-out inference has run.
