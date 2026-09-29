# Comparisons and ablations: registered protocol

Registered 2026-09-27, before any comparison row was produced. The assignment names three
pieces: Comparison A (identical-patch verifier decisions), Comparison B (complete coding
workflows) and the ablations S0, S1 and S2, under a frozen decision rule. This document fixes
what each measures, over which population, with which denominators, and what may be claimed
from it. Amendments are appended below with their date and reason; nothing above the amendment
line changes after registration. No frontier model is used anywhere here, by decision: every
model call is a local model, named per row.

## Frozen decision rule

For every comparison the outcome of interest is a decision about one change, compared with
task truth established apart from every arm:

- **Truth** comes from the AI-authored pull request study's adjudication arm
  ([ai-pr-study-protocol.md](ai-pr-study-protocol.md)): `requirement-met`,
  `requirement-violated`, or `unjudged`. A row whose truth is `unjudged` is excluded from
  agreement rates and reported in the denominator of coverage only.
- **A decision** is one of `accept`, `refuse`, `unmeasured`. Plain CI decides `accept` when the
  suite exits 0 and `refuse` otherwise; swarm-verify decides `accept` on a verified or
  regression-only pass, `refuse` on a failed check or a refused requirement, and `unmeasured`
  on an incomplete or refused-for-identity run.
- **Agreement**: `accept` on `requirement-met`, or `refuse` on `requirement-violated`. **False
  green**: `accept` on `requirement-violated`. **False red**: `refuse` on `requirement-met`.
  `unmeasured` is neither and is reported as its own share.
- **Reporting**: counts, shares and Wilson 95% intervals, per arm; the paired difference in
  false-green count between two arms with the count of discordant rows; no rate is reported
  without its denominator, and no difference is called meaningful below ten discordant rows.
- **What may be claimed**: an arm with fewer false greens on this population, at this
  denominator, under this rule; never a general rate for AI-written code and never superiority
  over a tool that was not run.

## Comparison A: identical-patch verifier decisions

Population: the fifty selected pull requests of the study, at their recorded base and head.
Arms, each run over the identical patch in a fresh container from the same lockfile:

- **A0, plain CI**: the repository's declared test command, exit code only.
- **A1, swarm-verify regression-only**: `ci --branch <head> --base <base> --install` with
  docker isolation, no contract: the same suite, plus the base control, the changed-line
  coverage arm, and the refusal paths (identity, isolation, malformed output).
- **A2, swarm-verify with the held-back check as an oracle**: `--oracle <the adjudication
  check's command>` over the same run, so the requirement-level decision is measured; the
  oracle is the reviewer's check, held back from the patch's author and from A0 and A1.

A0 and A1 are decided from the verifier arm's rows (`scripts/ai-pr-study/run.mjs`, the check
observations give A0 and the verdict gives A1). A2 is a separate pass over rows whose truth is
not `unjudged`. Frozen verifier version: the stable `1.0.0`, recorded per row.

## Comparison B: complete coding workflows

Population: the frozen cohort `mined-pr-viable-79` of mined pull-request tasks with held-back
oracles, already used by the reach-pressure run (`docs/evidence/2026-09-18`). Arms, one local
model, one shared prefix per task, forked at visible acceptance:

- **B0**: the agent's workflow with the repository's own checks only.
- **B1**: the same workflow with swarm-verify's regression-only verdict fed back as attributed
  tool output after each attempt.
- **B2**: B1 plus requirement challenges where the task carries a contract.

Outcome: held-back pass rate per arm on the same tasks, paired, with help and harm counts as the
reach-pressure report defines them. The feedback-intervention study of 2026-09-19 collected 19
rows and no report; its rows are not reused, because its arms are not these. B runs only after
Comparison A has a report, and only at the local model's pace.

## Ablations S0, S1, S2

Over the Comparison A population, the verifier with parts removed, so what each part
contributes is measured rather than asserted:

- **S0**: the suite alone, no base control, no coverage arm, no refusal paths (this is A0).
- **S1**: S0 plus the base control and the identity, isolation and output refusals (this is A1
  without the coverage arm, obtained by reading the rows with the coverage dimension masked).
- **S2**: S1 plus changed-line coverage and mutation witnesses (A1 in full), and, where a
  contract or held-back oracle exists, requirement challenges (A2).

Each ablation reports the same decision counts under the frozen rule. The ladder is read as
what each addition changed in false greens and in unmeasured rows, never as a ranking of
products.

## What is preserved

Per row and arm: the verifier version and image, the argv, the report and bundle digest, the
decision and the truth it is compared with, and the wall time. The analysis script and its
digest are recorded beside the report.

## Amendments

- **2026-09-28, how A2 carries the check.** The verifier clones the workspace into its own
  checkout, and a clone carries no untracked file, so A2's first pass ran an oracle whose
  file was absent and read every row as rejected; that pass is void. A2 now commits the
  held-back check on top of the pull request's head on a throwaway branch and gives the
  verifier that commit: the patch A2 judges is the pull request's patch plus the one file it
  is judged by, which the row records (`patchIncludesCheck`). A0 and A1 judge the patch
  alone. The verifier version A2 ran with is recorded per row; a rerun on a later version is
  a replay and is labelled one.
- **2026-09-28, S1 read as registered.** The first ablation script did not read S1 as the
  verdict with coverage masked, as registered above. It re-derived the inherited-failure rule
  from per-check statuses and dropped the verifier's rule that a required check which stood
  down leaves regression unmeasured. On felixrieseberg/claude-coach#18, judged a violated
  requirement, the build ran and then hit a missing command; the verifier left regression
  unmeasured, while the script accepted the row. That false green belonged to the script, not
  to any arm, and the S1 agreement it reported on 1.0.2 was overstated by the same rule. S1 is
  now the verifier's recorded regression-only decision, which is A1 when no contract exists.
  Both ablation pages were re-rendered from unchanged rows.
- **2026-09-28, infrastructure reruns in a replay.** Three consecutive rows of the 1.0.3
  replay (11, 12 and 13) were blocked because docker killed their containers and the verifier
  refused when it could not confirm cleanup. Each was rerun once with docker otherwise idle.
  The failed attempt stays on its row under `infrastructureAttempts`, and the report names every
  such row. None of the three carries adjudicated truth.
- **2026-09-28, Comparison B's shared prefix, fork and B1 rule, registered before any B run.**
  The shared prefix of every task is the prefix the reach-pressure experiment's generation 3
  already recorded over `mined-pr-viable-79` with this protocol's model and limits (Qwen3.8-27B
  MLX 8-bit, greedy, thinking off, two prefix invocations), in
  `docs/evidence/2026-09-17/reach-pressure-experiment/results.jsonl`. A prefix is shared by
  definition, so reusing one recorded under the same model, cohort and limits changes no arm. The
  fork is the first step whose visible oracle accepted the task, whatever its regression reading.
  A task with no such step has no fork: every arm ends on the prefix's final patch, so its pair
  is concordant by construction. B0 stops at the fork. B1 runs the released swarm-verify 1.0.4
  regression-only verdict (`ci --patch --install`, no oracle, on the host as the prefix's judge
  ran) on the fork patch. On `pass` or `unmeasured` it stops, because an unmeasured verdict names
  no defect a repair could address. On `fail` it feeds the verdict's failed-check ids and
  details back as attributed tool output and repairs, at most two invocations, as the reach
  repairs were capped. It stops when regression passes and the visible oracle still accepts. Each
  arm's final patch is scored on the held-back half with the prefix's scorer. No mined task
  carries a requirement contract, so B2 has nothing to add and is reported as not applicable,
  not as equal to B1. With 14 fork tasks of 79, the ten discordant pairs the frozen rule needs
  require ten of those fourteen to change held-back outcome under B1; the result states that
  ceiling beside the observed pairs.
- **2026-09-28, the same rule for the 1.0.4 replay.** Rows 39 to 50 of the 1.0.4 replay, and
  eight of its A2 runs, were refused while the host also ran Comparison B's verdicts: the
  container runtime finished removals, or answered a containment probe, after the verifier's
  15-second client deadline. Each was rerun once with the host otherwise idle and keeps its
  failed attempt under `infrastructureAttempts`. A2 on row 14 (glincker/thesvg#1159) is refused
  on 1.0.3 and 1.0.4 alike, and not for load: its held-back check is a text inspection whose
  recorded path is the three files it greps joined by spaces, so A2 committed it under one file
  name with spaces, and the verifier refuses a patch path git has to quote. The row stays refused
  as recorded; the adjudication record is the instrument defect, and the refusal of quoted paths
  is a verifier limitation, both named. The verifier source now retries removal and its confirmation three times
  before refusing, which the next patch carries.
- **2026-09-28, A2 judges the pull request's patch alone, registered before its next run.** The
  1.0.4 replay showed the committed check (the 2026-09-28 amendment above) failing the
  repository's own lint and format checks on the reviewer's style, which read as a regression of
  the patch, and showed the verifier running the oracle outside the project environment, so a
  `python -m pytest` check reached the image's interpreter and read as a rejection. From the
  next A2 run the check is carried inside the oracle command and decoded into place when the
  oracle runs (`patchIncludesCheck: false`), so A2 judges the same patch as A0 and A1. The
  verifier fix (the oracle runs with the prepared `.venv/bin` and `node_modules/.bin` first on
  PATH, and every oracle run is kept in the verdict) ships in the next patch; A2 rows measured
  before it are superseded by a labelled replay on that patch and stay in their archives.
- **2026-09-28, A1 read as the verifier decides, amended after the data it changes.** The rule
  above says swarm-verify decides `refuse` on a failed check and `unmeasured` on an incomplete run.
  The analysis coded "failed check" as any check whose status is failed. Until 1.0.6 that matched
  the verdict. Since 1.0.6 a check can fail both with and without the patch in a way the verdict
  cannot attribute, and the verdict then reports its regression unmeasured and the Action reports
  the run incomplete, not refused. On the 1.0.7 replay the first coding counted twelve such rows
  as refusals of correct pull requests. A1 (and S1, and the study report's decision) now read the
  verifier's own decision: a verified run or a regression pass accepts, a regression charged to the
  patch refuses, anything else is unmeasured, including a run the verifier refused before
  measuring, as the rule's text says. This amendment is written after seeing the 1.0.7 numbers it
  changes, so both readings are published side by side on the Comparison A page, and every
  earlier replay is re-rendered under both.
- **2026-09-28, which infrastructure reruns are allowed.** A Docker Desktop hang on a large-tree
  checkout stalls every container after it for about half an hour. A row whose own run hangs the
  runtime twice stays blocked as recorded (A2 on row 14, glincker/thesvg#1159, on 1.0.7). A row
  refused only because an earlier row had hung the runtime has not yet been measured, and it is
  rerun once the runtime is measured healthy, however many times that has happened; every
  attempt stays on the row under `infrastructureAttempts`.
