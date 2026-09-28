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
