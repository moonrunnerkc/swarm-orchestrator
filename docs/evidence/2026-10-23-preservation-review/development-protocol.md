# Development study, registered before its first launch

October 23, 2026. A small repeated study of the experimental candidate review on exposed tasks.
It is development material, used to decide whether the mechanism earns a fresh block. It is not a
superiority result. The design note says what would count against the hypothesis
([design-note.md](design-note.md)).

## Tasks

Three exposed tasks whose evaluators earlier stages validated against the base, a reference, an
alternative correct patch and faulty controls. All of them were released after their blocks.

| Task | Family | What earlier launches got wrong |
| --- | --- | --- |
| `svgo-bugfix-remove-scripts-anchor-bypass` | bug fix with a stated edge case | all six fresh-block launches missed the anchor whose prefix is declared on the element itself |
| `markdown-it-feature-reference-definition-token` | feature with preservation | four of six missed the stated line-break requirement; two broke the linkify override |
| `p-limit-bugfix-limit-function-clear-queue` | bug fix where the incumbent is often right | earlier Swarm launches completed it; a review that damages a correct change would show here |

The task definitions are the published modules'
([block 2](../2026-10-23-controller/fresh/sealed/heldout-tasks.mjs),
[block 1](../2026-10-22-adaptive/heldout/sealed/heldout-tasks.mjs)). One study-local module
re-exports the three, with no change to any task text, check or install.

## Arms

All arms run one pinned build, named by commit and digest in the launch log before the first
launch. They differ only in frozen flags:

| Arm | Flags | What it is |
| --- | --- | --- |
| `swarm-control` | `--adaptive` | the current pipeline, with this stage's shared correctness fixes |
| `swarm-prose` | `--adaptive --review prose` | the equal-budget control: the same reviewer conversation and the same owed attempt, objections in words, nothing run |
| `swarm` | `--adaptive --review executable` | the treatment: probes run on the base and the candidate, findings with execution |

Every arm uses `qwen3.6:35b-a3b` through local Ollama at `127.0.0.1:11434`, one sequence at a time,
the same task text, visible check, contract and allowed-change policy, and the execution profile
the comparison harness builds.

## Samples, order and resources

- Two samples per cell: 3 tasks × 3 arms × 2 = 18 launches, matched by sample.
- Order: sample 1 of every task, then sample 2. Tasks are in the listed order, with arms rotated
  by task position (`studyOrder`).
- Per launch, every arm gets:
  - 720,500 ms of launch wall, of which 60,000 ms is held as the verification reserve;
  - an 8,000,000-token ceiling;
  - 40 steps per loop.

  The review draws from the same allowance and is withheld, on the record, where too little is
  left.
- Resource ceiling: 216 agent-minutes of launch wall, plus preparation and scoring. Local inference
  only; paid inference is $0.

## Stopping and validity rules

- Every registered arm runs, whatever another arm's result.
- A zero-inference setup failure is recorded apart and retried at most twice, after a recorded
  correction. Once inference begins, the outcome stands.
- Hidden verdicts are sealed beside each record and released only by `study.mjs --reveal` after
  the eighteenth launch has an outcome. The progress line carries health only.
- Nothing in the product or the scoring changes between launches. A defect found during the study
  is recorded and fixed after it.

## Scoring and report

- **Primary.** Complete delivery: the hidden evaluator passes, the visible check and the project
  tests pass, lint passes where the base passes it, and where the task asks for tests, at least
  one added test fails on base source and passes on the delivered source (the previous stage's
  definition).
- **Separately, per launch:**
  - hidden behaviour alone;
  - the product verdict against the hidden verdict;
  - whether the review examined or was withheld, and why;
  - each established finding;
  - the reviewer's attempt: given, kept or rolled back;
  - the candidate before that attempt (a `candidate-snapshot-v1` record) and the delivered one,
    each scored by the hidden evaluator offline, so a gain, damage or no change is measured
    rather than inferred;
  - wall, tokens and unknown-usage calls, with the review's own share.
- **Finding validity**, by an offline assessor. The reference patch is used only there and never
  reaches a model. Each established finding's probe is run on the reference tree:
  - valid where the reference gives the expectation and the candidate does not;
  - a false accusation where the reference also disagrees;
  - a false accusation, too, where the hidden evaluator passes the candidate.
- Pairs per sample and task, as wins, losses and ties.

## Decision recorded before launch

The review stays experimental and off by default unless all three of these hold:

1. the executable arm delivers strictly more complete changes than both controls;
2. no complete delivery is lost to its attempt;
3. the gain traces to a valid finding.

Even then, this study only earns it a fresh block: a count from three exposed tasks is not a
general result. If the executable arm does no better than the prose control, any difference from
the current pipeline is attributed to extra computation, not to executable feedback.
