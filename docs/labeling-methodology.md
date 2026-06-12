# Real-corpus labeling methodology (outcome-grounded)

This document is the rubric the real-corpus ground truth is built against.
Ground truth comes from repository history alone: not from a model's opinion,
not from a paid human rater. A label is a fact about what happened to the
merged change, and it carries the git evidence that proves it.

This replaces the earlier human-adjudication plan (a paid OSS-maintainer rater
pool gated on Cohen's kappa). That plan is retired. The reason is in the
numbers: the prior AI-opinion labels and the repository outcomes are
essentially uncorrelated (Cohen's kappa ~0.00 over 197 PRs; of the 22 PRs that
history proves bad, exactly one was also AI-labeled broken). A label source
that does not track what happened to the code is not worth adjudicating. The
path forward is outcomes, derived deterministically, not human ratings.

## The anchor: commits, not PR numbers

The corpus entries are agent-attributed **commits**. Their `pr.number` does not
resolve to a merged upstream PR (many were collected from direct commits whose
`headRef` is the default branch), so PR-number-based history queries are
meaningless here. The reliable anchor is `pr.headSha`, a real commit in the
repository's history. All outcome detection keys on that sha, which is the form
a `git revert` and a follow-up commit actually reference.

A squash-merge leaves the vendored branch sha "diverged" from the default
branch even though the change landed under a squashed sha. Reachability is
therefore recorded as evidence, never used as a gate: the corpus collector
already filtered to merged work, and outcome detection works off the change's
files and the revert-message search, both squash-agnostic.

## The three outcomes

`scripts/labeling/outcome-labels.ts` (`npm run labeling:outcome`) assigns every
entry exactly one outcome:

- **reverted**: a later commit whose message is `This reverts commit <headSha>`.
  Matched by the shared `messageRevertsSha` helper in the real-prs github lib,
  the same revert detection the block-eligibility calibration uses.
- **hotfixed**: a follow-up commit, within 30 days of the landed commit, that
  modifies the same source lines the change touched. All of the following must
  hold, or the entry stays `survived`:
  - line-range overlap on a shared file (post-image ranges from the diff
    walker's `extractChangedLineRanges`);
  - the file is code, not docs, config, lockfiles, templates, or generated
    output (a language-agnostic exclusion, since the corpus spans
    Python, Go, Rust, TypeScript, and more);
  - the follow-up is surgical (at most 60 changed lines), so a wholesale
    rewrite that overlaps by coordinate coincidence does not count;
  - it is not a merge commit;
  - its message carries a strong fix-intent marker (`fix`, `bug`, `hotfix`,
    `regression`, `revert`, `broke[n]`, `patch`, `defect`, `crash`). Weak
    substring matchers (`error`, `fail`, `wrong`) are excluded because they
    fire on feature commits.
- **survived**: merged, and none of the above was found.

A fourth state, **indeterminate**, is recorded when the commit or repository
history cannot be read (deleted, private, 404). Indeterminate entries are
excluded from scoring and reported, never silently treated as clean.

The rules above are deliberately conservative. Missing a silently-fixed change
lands it in `survived`, which never inflates the broken count. That is the safe
direction for ground truth: precision over recall on the positive class.

## Evidence

Every non-survived label carries its evidence: the reverting or hotfixing
commit sha, and for a hotfix the overlapping `file:line` ranges and the
follow-up's subject line. A reviewer re-derives any label with `git log`
alone. The per-entry evidence is committed under
`benchmarks/real-corpus/outcome-cache/` and aggregated, with the distribution
and the AI-vs-outcome agreement, into
`benchmarks/real-corpus/outcome-labels.json`.

## The current corpus

Of 205 entries, 197 are usable and 8 are indeterminate. The outcome
distribution is 0 reverted, 22 hotfixed, 175 survived: a true bad base rate of
11.2%. This is the ground truth every score from here on runs against.

## Agreement with the retired AI labels

The labeler reports the binary `broken`-vs-`clean` agreement between the
outcomes and the prior AI labels over the PRs both decided: raw agreement
0.853, Cohen's kappa ~0.00, with 1 PR called broken by both sources, 21
outcome-bad that the AI called clean, and 8 AI-broken that survived. The kappa
is the headline: the two label sources do not agree beyond chance.

## Mining more confirmed-bad PRs

The same outcome detector mines a second, agent-attributed corpus
(`npm run agent-incidence:confirmed-bad`, `scripts/real-prs/mine-confirmed-bad.ts`),
reusing the exact `findOutcomeEvidence` core. A bounded mine of 60 merged agent
PRs yields 5 outcome-confirmed-bad (8.3%, consistent with 11.2% above). A 50-PR
positive class needs roughly 600 mined agent PRs; that ceiling is recorded in
`benchmarks/real-prs/agent-corpus/confirmed-bad.json`, and `--fetch-more`
continues the mine.

## Reproducibility

Every number here regenerates from a committed npm script against live GitHub:
`npm run labeling:outcome` rebuilds the labels and the agreement,
`npm run corpus:score-outcome` rescores the detectors against them, and
`npm run agent-incidence:confirmed-bad` re-mines the agent corpus. The
dependency footprint is Node 20+, `@octokit/rest`, and a GitHub token (from
`GITHUB_TOKEN` or the `gh` CLI keyring).
