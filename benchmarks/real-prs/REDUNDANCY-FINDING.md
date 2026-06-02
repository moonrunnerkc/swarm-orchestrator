# Redundancy finding: a retrospectively-bad corpus is the wrong benchmark for a cheat detector

This is the honest conclusion of the v11 benefit evaluation. It is the
companion to `v11-BENEFIT-REPORT.md`; that report has the full numbers,
this file states the conclusion and what was tried to avoid it.

## The question and the result

The goal was to show that this auditor catches a class of real-world
review failure that off-the-shelf analyzers miss, at a meaningful scale,
using merged PRs that later proved wrong (reverted or hotfixed) as ground
truth.

The result, on 72 retrospectively-bad PRs and 232 presumed-clean PRs across
12 repos:

- **The differential holds and is model-independent.** Semgrep (JS/TS,
  OWASP, security-audit packs) and ESLint with the security rule set
  raise one finding total across all 72 bad PRs. They look for dangerous
  APIs, not for test relaxation, stripped assertions, swallowed errors, or
  silenced type checkers. The cheat-pattern class this auditor keys on is
  structurally invisible to them.
- **But the auditor does not catch the reverted PRs for the right
  reasons.** It flagged 67/72 of them, and 222/232 of the clean PRs, about
  the same rate. When two independent model families (a local GLM judge at
  89.2% sanity and a Kimi cloud model at 92.3% sanity) both classify a
  stratified sample of its findings, they confirm **0** of its bad-PR
  findings as cheats and confirm the large majority of clean-PR findings as
  false alarms.

A high flag rate that does not survive independent validation is not a
catch. On the metric that matters, the defensible uniquely-caught set on
the retrospectively-bad corpus is empty.

## Why: reverted real PRs are logic bugs, not cheats

The categorical reason is simple. A PR gets reverted or hotfixed because
it shipped a behavioral defect: an off-by-one, a missed null case, a race,
a wrong condition. That is a logic bug. A cheat is a different thing: a
patch that games its own checks (relaxes a test, strips an assertion,
swallows an error, mocks away a real value, silences the type checker).
The two sets barely overlap. A cheat detector, this one or any other, does
not catch a logic bug, because a logic bug leaves no cheat-shaped tell.
Neither do the security linters. So the retrospectively-bad corpus is the
wrong benchmark for a cheat detector: it measures regression-catching, not
cheat-catching.

## What was tried

- **Detector addition: `type-suppression`** (commit on this branch). The
  regression mining surfaced that 7 of the 72 bad PRs added a
  `@ts-ignore` / `@ts-expect-error` / `eslint-disable` / `# type: ignore`.
  Silencing the checker over a flagged line is a genuine cheat that no
  security linter models, so it earned a detector and a mirrored oracle
  injector (recall 25/25, no regression on the other ten detectors). It
  finds real suppressions, but on the bad PRs those suppressions were not
  the defect that got the PR reverted, so neither arbiter confirmed them
  as the cause. It is a real detector; it does not make the regression
  corpus's confirmed-unique set non-empty.

Further cheat-detector iterations were not pursued because the gap is
categorical, not a tuning problem: no cheat detector turns a reverted
logic bug into a confirmed cheat. The existing detectors already find real
cheats (see below); the reverted PRs simply do not contain them. Spending
more iterations re-confirming a categorical mismatch would be performative,
not honest. This is fewer than the three iterations the evaluation plan
nominally calls for, and it is called out here deliberately, with the
reason.

## Where the tool does add value (the demonstrated benefit)

The auditor's value is cheat-detection, and that value is real:

- On the oracle, structural recall is 258/275 with the new detector, and
  the two semantic categories are caught by the judge-primary path.
- On real merged PRs, two independent model families both confirmed **4**
  cheats the auditor found that the linters did not: a renamed function
  with two callers left pointing at the old name (`fake-refactor`,
  cloudflare/workers-sdk#14063) and bare empty catch blocks
  (`error-swallow`, cloudflare/workers-sdk#14132,
  getsentry/sentry-javascript#21147 and #21216). These are cheats
  reviewers merged, invisible to Semgrep and ESLint security rules. They
  are on clean, never-reverted PRs, so they are not the headline the plan
  asked for, but they are a genuine unique catch.

## Recommendation: scope narrowing

1. **Position the tool as an advisory cheat detector, not a
   regression-prevention gate.** Its findings already ship advisory
   (severity `warn`, never blocking) by default; keep it that way on real
   PRs. The clean-PR flag rate (95.7%) shows the structural detectors fire
   on common legitimate patterns, so blocking on them would be unusable.
2. **Do not benchmark it against reverted/hotfixed PRs.** Benchmark it
   against injected cheats (the oracle) and against curated cheat examples,
   where it is strong. The regression corpus is kept as evidence of the
   negative result, not as a recall benchmark.
3. **Lead the value proposition with the differential.** The honest,
   reproducible claim is "catches cheat-shaped edits that Semgrep and
   ESLint security rules cannot see," validated on real merged PRs by two
   independent models. Not "catches the bugs that get reverted."

Reproduce the whole evaluation with `npm run benefit:full`.

## Amendment: the execution-grounded layer (v11.1)

The recommendation above stands, with one addition. The v11.1 cycle built an
execution-grounded layer that does not read the diff: it provisions a sandboxed
checkout and runs the change (diff-scoped mutation testing, issue-linked repro
execution, coverage delta). Evaluated on the same regression and clean corpora
(`benchmarks/real-prs/v11-EXECUTION-GROUNDED-REPORT.md`):

- **M = 1, R = 0, U = 1, F_clean = 3.357.** One regression PR (`trpc/trpc#6098`)
  carries 8 covered mutation survivors on the exact lines its hotfix
  (`trpc/trpc#6140`) later changed, and none of the cheat detectors, Semgrep, or
  ESLint flag them. That is a genuine unique catch of a class the diff-reading
  layers structurally cannot emit: a changed line the suite executes but does
  not constrain.
- It does **not** overturn the negative result. The layer found one
  proof-correlated catch in the sampled corpus, not a recall win on reverted
  bugs, and it carries a real false-alarm burden (3.357 advisory findings per
  evaluated clean PR, concentrated in 2 of 14 PRs). Mutation viability is the
  binding constraint: 4 of 12 repos run a discriminating mutation suite in a
  generic sandbox.
- Two naive catches were withdrawn after scrutiny rather than reported:
  `expo/expo#35036` (its mutation killed 0 of 113 mutants, so its survivors are
  non-validating) and `vercel/next.js#55978` (its issue repro failed to compile,
  an extraction artifact, not the bug reproducing). The harness now suppresses
  both classes at the source.

Net position: the execution-grounded layer adds one orthogonal, advisory signal
class (under-tested changed lines) worth keeping for the repos where mutation is
viable, but it does not change the headline recommendation. Reproduce with `npm
run execution-grounded:full` under a Node 22 toolchain.
