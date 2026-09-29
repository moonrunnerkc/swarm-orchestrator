# AI-authored pull request study: registered protocol

Registered 2026-09-27, before any selected pull request was run through the verifier. This
document fixes the population, the selection rule, the denominators and the claims the study
may make. Amendments, if any, are appended below with their date and reason; nothing above
the amendment line changes after registration.

## The earlier finding this study does not inherit

The "four of eighteen" figure in this repository's documents comes from
[the 2026-09-05 measurement](../evidence/2026-09-05/false-green-measurement.md): eighteen
patches produced by this project's own agent and a baseline arm over three public TypeScript
repositories and three tasks, re-scored against hidden acceptance tests written by the same
authors. It is a measurement of that population and of those oracles. It is not a study of
AI-authored public pull requests, it was not independently reproduced, and it is not a rate
this study expects. It is cited with that scope or not at all.

## Population and frame

Public pull requests on GitHub that satisfy all of:

- **explicit AI authorship**: the pull request's author is an identified agent account,
  namely one of `copilot-swe-agent[bot]`, `devin-ai-integration[bot]`,
  `chatgpt-codex-connector[bot]`, `cursor[bot]`, `claude[bot]` or `google-labs-jules[bot]`.
  Writing style, commit trailers alone and unlabelled human accounts are not evidence;
- **merged** between 2026-06-29 and 2026-09-27 inclusive, the 90 days before registration;
- **in a repository with at least 50 stars, not archived, not a fork, not owned by this
  project's owner or organisation**, and not one of the repositories used to tune the
  verifier (`gvergnaud/ts-pattern`, `gigobyte/purify`, `koajs/koa`, `iamkun/dayjs`,
  `tj/commander.js`, `winstonjs/winston`, and every repository in this project's campaign
  corpus);
- **a Node or Python project** whose manifest declares a test command the verifier can
  discover (`package.json` with a `test` script and a lockfile, or `pyproject.toml` with
  pytest and a `uv.lock`), because the verifier's discovery is what is under study;
- **at least one changed source file** (not documentation or configuration only).

Frame: the GitHub search API queried on 2026-09-27 with, per author account,
`is:pr is:merged author:app/<name> merged:2026-06-29..2026-09-27`, the first 1000 results per
account in the API's default order, recorded by
[`scripts/ai-pr-study/frame.mjs`](../../scripts/ai-pr-study/frame.mjs) to
[`window-90/frame.json`](../evidence/2026-09-27/ai-pr-study/window-90/frame.json) with the
query, the time, the count per account and the selection, every repository's eligibility
reading to `repositories.json.br` beside it and every raw result to `results.jsonl.br`. The frame is fixed at that
record; a pull request that changes after it (force-pushed, deleted, repository archived)
keeps its recorded base and head SHAs.

Fallback, predeclared: if fewer than 100 pull requests are eligible, the window widens to
180 days before registration under the same rule, once, and the widening is recorded
(`frame.mjs --widen`, to `window-180/`, which names the first window's eligible count).

## Selection

From the eligible frame: at most five pull requests per repository, chosen by seeded order
(sha256 of the seed `verifier-first-2026-09-27` and the pull request URL); then fifty pull
requests by the same seeded order across repositories, subject to the per-repository cap.
The selected fifty, in order, are the study set. If a selected pull request proves
unjudgeable for a scientific reason (requirements cannot be adjudicated, environment cannot
be reproduced), it stays in the set as a row with that outcome; it is not replaced. If more
adjudicated cases are needed, the next pull requests in the seeded order are appended, the
original fifty are kept and reported first, and the expanded denominator is reported
separately.

## What is preserved per pull request

The pull request URL, repository, base and head SHAs, merge commit, the linked issue or task
text where one exists, the original diff, the test changes it carries, the historical CI
conclusion where visible, the repository's declared test command and lockfile identity, the
verifier version and container image used, and the fresh execution's evidence bundle.
Historical green CI is context; it is never counted as a verifier execution.

## Task truth

Task truth is established independently of the verifier's verdict, by executable acceptance
checks written from the pull request's stated requirement (its title, body and linked issue)
by a reviewer role separate from the run, held back from the verifier, and executed on the
base (must fail) and on the head (judged). A requirement that cannot be stated executably is
recorded as unjudged, never guessed. Weak tests, suspicious code, a surviving mutation without
a witness, or absent evidence never count as a demonstrated incorrect implementation.

## Denominators and definitions

- **Selected**: 50 (plus any registered extension, reported separately).
- **Executed**: the verifier ran to a verdict on the exact head in a fresh container.
- **Blocked**: the verifier could not execute (environment, dependencies, toolchain), with
  the reason; fixable execution problems in the verifier or harness are fixed, recorded as
  amendments, and rerun; problems in the pull request's own repository are recorded as
  blocked.
- **Original-suite green**: the repository's declared checks pass on the head in the fresh
  execution.
- **Adjudicated**: task truth established by an executed held-back check.
- **Observed false green**: original-suite green and the held-back check demonstrates a
  violated requirement.
- **False-green fraction**: observed false greens divided by original-suite-green pull
  requests with adjudicated task truth. Reported with a Wilson 95% interval.
- **Verifier detection**: which observed false greens the verifier refused or identified,
  under which policy (`check` regression-only, `ci` with a contract, `--challenges`), and for
  which recorded reason. A held-back finding is not a verifier catch.
- **Good-work acceptance**: among adjudicated-correct pull requests, how many the verifier
  accepted, refused or left inconclusive.
- **Practical cost**: wall time per pull request, container CPU time where measured, manual
  interventions with their reason, and the verifier's overhead over the plain test command.

## Product version

The measured series uses one frozen verifier version, recorded in the frame. A defect found
during the study is fixed and validated separately; the original observation is kept, a
replay on the exposed pull requests is labelled a replay, and any confirmatory claim uses
pull requests not exposed to the fix.

## Claims this study may and may not make

It may report the numbers above with their denominators and intervals, per repository and
per work type where the frame permits, and the verifier's detection and acceptance on this
population. It may not claim a general false-green rate for AI-written code, comparative
superiority over any other tool, or that a refusal proves a defect. It is an observational
study of a convenience population selected by the rule above.

## Amendments

- **2026-09-27, frame instrument.** The first draw of the frame recorded zero results for
  four of the six author accounts because their searches failed under the search API's
  budget after two accounts had each returned a thousand results, and the script recorded a
  failed search as an empty one. That draw is kept unchanged at
  [`draw-1-incomplete/frame.json.br`](../evidence/2026-09-27/ai-pr-study/draw-1-incomplete/frame.json.br)
  and is not used. The script now waits for the budget between accounts, retries a failed
  search, and stops rather than record a silent zero; the frame was drawn again with it on
  the same day. Nothing above this line changed.
- **2026-09-27, adjudication procedure, fixed before any selected pull request was
  adjudicated.** The reviewer role is a local model (recorded per row with its prompt digest)
  that is handed the title, body, linked issues and changed file names, may list and read the
  repository at the head, and is refused every test file the pull request changed. It writes
  one check and one command, or says the requirement is not executable. The check is written
  once into the clone and executed in a network-disabled container on the head and on the
  base; a check that does not fail on the base, or that could not run on either commit (a
  missing file, a command that could not start), leaves the row unjudged. A failure on the
  head is a violated requirement only when a second, code-blind call quotes, verbatim from the
  requirement text, the sentence each failing assertion comes from; the harness checks that
  every quote is really in the text. A failing assertion the reviewer added beyond the text
  leaves the row unjudged, since the protocol counts only a demonstrated violated requirement.
  Implementation: `scripts/ai-pr-study/adjudicate.mjs`; the verifier arm never reads this
  arm's result and this arm never reads the verifier's verdict.
- **2026-09-28, adjudication order and two more refusals, before any selected pull request's
  adjudication counted.** A first adjudication pass ran over clones whose dependencies had not
  been installed, so a check needing the project's test runner failed identically on both
  commits and the "fails on the base" rule was met by the missing runner rather than by the
  requirement; three rows read as violated that way. That pass is void: its rows were cleared
  and are not reported. Adjudication now runs only after the verifier arm has installed a
  clone's dependencies from its lockfile, in that clone; a check that fails the same way on
  both commits (same exit status and last line), or whose output names a missing runner or
  module, leaves the row unjudged. The traceability audit stays as registered.
- **2026-09-28, the project's environment on the check's path, and text-inspection checks
  reported apart.** A check runs with the clone's own `.venv/bin` and `node_modules/.bin` first
  on its PATH, so `python` and `pytest` in a reviewer's command mean the project's. A check
  whose command and file run no test runner or interpreter, only text tools (`grep`, `test
  -f`, `cat`), executes no behaviour; such rows are counted apart in the report and are not
  task truth, since the protocol's truth is an executed acceptance check.
- **2026-09-28, the adjudication arm installs the dependencies it needs.** The verifier arm
  installs into its own fresh checkout and never into the study's clone, so a check that needs
  the project's test runner found none there. Before each commit's check the arm now installs
  that commit's dependencies from its lockfile in a container with the registry reachable for
  that one command and install scripts off (`npm ci --ignore-scripts`, pnpm through npm,
  `uv sync --locked`), and the check itself still runs with the network off. An install that
  fails leaves the row unjudged with the installer's last line.
- **2026-09-29, the study machinery repaired before any further final scoring.** An audit of
  the scripts found six defects in how rows were measured and counted. None of the text above
  changes; the machinery that applies it does, and the rows already recorded keep their bytes.
  The final study runs on a later released verifier under these rules; development rows made
  while repairing the machinery are labelled development and are not reported.
  - *Original-suite green came from the product under study.* The runner read it off the
    verifier's own report (no refusal and a passing `tests` check), so a refusal forced "not
    green", no suite ran apart from the verifier, and Comparison A's A0 and ablation S0 read the
    verifier's report too. A separate plain-CI arm now runs per row at the head and at the
    base: a fresh checkout, its dependencies installed from its lockfile in a fresh container,
    the project's own declared test command (`scripts.test`, or pytest where the project
    declares it) with the network off. It records collection, command, exit, status (`passed`,
    `failed`, `not-collected`, `setup-failed`), duration and an output tail as
    `originalSuite`. Whether the verifier's exported evidence is valid is a separate dimension,
    decided by running the bundle's own `verify.mjs` (and `rederive.mjs` where present). A
    suite-green row whose verifier evidence is invalid, or whose run the verifier refused,
    stays in every suite-green denominator. A0 and S0 read the independent arm; a row
    without it is unmeasured for A0, never read from the verifier. This supersedes the
    sentence in `comparison-protocol.md` that decided A0 from the verifier's check observations.
    The report's "suite green with adjudicated truth" now divides by suite-green rows rather than
    by executed rows.
  - *Any non-zero exit on the base counted as detection.* A crash, a syntax error in the check,
    a project that did not load, a missing fixture or a broken check all read as the check
    detecting the requirement, and an install failure or timeout on the base read as "does not
    fail on the base". Each side is now classified first: `passed`, `assertion-failure`,
    `missing-feature` (the failure names a symbol, module, file or route the pull request's
    added lines or paths contain), `startup-or-setup-failure`, `check-invalid`, `timeout` or
    `not-run`. Only an assertion failure or a missing feature on the base with a pass on the
    head establishes a met requirement; the same genuine unmet requirement on both sides is a
    violation candidate subject to the trace audit (the earlier rule left it unjudged as "not
    discriminating"); anything else is unjudged with that reason. The task type is recorded:
    a refactor is judged by equivalence checks that must pass on both commits, a dependency
    upgrade by a version or behaviour check, and a check that needs a network or browser is
    unjudged with that reason.
  - *Setup was not recorded as setup.* Each side of each arm now records its dependency
    preparation (command, lockfile and its digest, exit, duration, output tail) and command
    environment (image id and repository digests, PATH with the project's `.venv/bin` and
    `node_modules/.bin` first, network) under `setup`; a setup failure is its own outcome.
  - *One reviewer saw the candidate implementation.* The check author read the head checkout
    and wrote one check; nothing checked it. The author now reads the pull request's text, the
    changed file names and a checkout of the base commit only, and writes checks per stated
    requirement, at least two where the requirement admits it, each recorded with the
    requirement text and the pull request's words it comes from. A second reviewer, a different
    local model, states the requirements blind from the text and then judges each of the
    author's requirements and checks, with `uncertain` for abstention; the trace audit is its
    call too. Each reviewer's model name and server digest, prompt digests and exposure are
    recorded. A requirement is scored only where the second reviewer agrees it is stated and
    the checks both accept executed validly and agree; a disagreement that changes the decision
    rule (refactor or not, executable or not) or a requirement the checks do not cover leaves the
    row unscored with its reason. Both reviewers are AI models, not independent humans; neither
    authored the pull request, but they may share training biases with each other and with the
    model that did. The checks are written only into the adjudication arm's own checkout and
    into the row, never into a checkout the suite or verifier arm reads.
  - *Rows were rewritten in place.* The runner, the adjudication and the A2 pass rewrote one
    `NN.json` per row, and the cache reused unversioned paths (`diffs/NN.diff`, top-level
    `reports/` and `bundles/`). Every attempt of every arm is now its own file, created
    exclusively under `v2/runs/<runId>/`, where the run id names the verifier version, the frame
    digest, the harness commit and the start time (`dev-` in front for a development run). Each
    attempt records its run id, attempt number, verifier version, harness commit, frame digest,
    input digests and start time; its intent is written before any effect. A resumed run keeps
    its id, every earlier attempt and the budgets its manifest fixed, and counts an attempt that
    never finished. Only a failure the harness classifies as infrastructure (the network, the
    container daemon, the model endpoint, an interrupted attempt) is retried, up to the run's
    attempt cap, and every attempt is kept. `inventory.mjs` lists what the working area holds,
    the earlier unversioned files labelled legacy, and deletes nothing.
  - *Behavioural and text-only truth were split by a regex, and the reports used different
    denominators.* The report classified a check as behavioural when its command or file
    matched a list of runner names, so bash scripts that grep `.tsx ` files and node scripts
    that only read a source file counted as behavioural while `python -c` importing the project
    counted as text-only; Comparison A and the ablations scored all judged rows while the report
    scored the behavioural ones. A check's class is now decided from what it executes (the
    command tokenised as a shell splits it, each program looked up, and the interpreter's code
    read for the imports it makes, resolved against the checkout), recorded at adjudication time
    as `behavioural-executed`, `text-inspected` or `unscored` with the reason, and one shared
    function (`truth.mjs`) gives every report its truth classes and denominators; only
    behavioural-executed truth is task truth anywhere.
  - *Reconciliation of the 1.0.2 adjudications under the corrected classifier.* The 22 rows
    judged met or violated were split 13 behavioural (rows 2, 3, 5, 7, 10, 14, 16, 17, 25, 28,
    34, 35, 43) and 9 text-only (rows 1, 15, 18, 20, 21, 26, 39, 45, 50). Recomputed from what
    each check executes, they are 11 behavioural-executed (rows 2, 3, 5, 10, 17, 20, 25, 26,
    28, 34, 35) and 11 text-inspected (rows 1, 7, 14, 15, 16, 18, 21, 39, 43, 45, 50), none
    unscored. Six rows moved: 7 (glincker/thesvg#1153), 14 (glincker/thesvg#1159), 16
    (glincker/thesvg#1138) and 43 (kentcdodds/kody#2597) from behavioural to text-inspected, and
    20 (Francis1998/nexus-llm-router#212) and 26 (Francis1998/nexus-llm-router#218) from
    text-only to behavioural-executed. The 1.0.7 replay's rows carry the same adjudications and
    reconcile identically. Reading those 22 rows' recorded base and head outputs with the
    corrected side classifier changes no decision: each base failure is an assertion failure or
    a missing feature the pull request adds, and none is a crash counted as detection. All 11
    behavioural-executed rows are met by a missing feature (the module the pull request adds),
    not by a behavioural assertion on existing code. Of the unjudged rows with both sides
    executed, row 38 was left unjudged because its check failed the same way on both commits;
    those are assertion failures, so under the corrected rule it is a violation candidate that
    would need the trace audit, which was never run on it. Rows 22, 37 and 47 (pass on both),
    36 (a module missing on both that the pull request does not add) and 46 (an unrecognised
    exit on both) stay unjudged, and rows 19, 30, 32 and 40 stay unjudged by the trace audit
    they already failed. These rows remain single-reviewer truth
    from a reviewer who saw the head; the reports mark them legacy, and they are not
    re-adjudicated under the new procedure here.
