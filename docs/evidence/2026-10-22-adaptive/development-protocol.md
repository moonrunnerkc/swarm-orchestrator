# Adaptive decision point: live development study, registered before launch

Development material only. Every task here is already exposed to this project; nothing from
this study is a transfer or generalization result. Its job is to show whether the decision point
is exercised live, what it decides, and whether that changes the delivered artifact, and to tune
the mechanism before a product freeze for the held-out block.

## Arms

Both arms run the same pinned build (`git archive` of the commit named in the manifest) on
`qwen3.6:35b-a3b` through the local Ollama endpoint, with identical task text, visible check,
contract, tools, execution profile and total resources:

- `swarm`: `--adaptive` (adaptive-decision-v1).
- `swarm-control`: no study flag.

Matched resources per launch: 540,500 ms of launch wall (the 2026-10-22 trials' figure),
8,000,000 Swarm tokens as a safety ceiling, 40 steps per loop and three repair attempts (the
product defaults the contract carries), no external corrections. The decision point's diagnosis
steps, tokens and wall are charged to the loop it serves; it adds no allowance. Swarm's own final
verification share is unchanged.

## Tasks and order

1. `acorn-bugfix-member-target-pattern-errors`, pair A: `swarm`, then `swarm-control`.
2. `entities-bugfix-restore-get-code-point`: `swarm-control`, then `swarm` (direct-path control).
3. `sinon-bugfix-stub-accessor-calls-v2`: `swarm`, then `swarm-control`.
4. `acorn-bugfix-member-target-pattern-errors`, pair B: `swarm-control`, then `swarm`.

Eight launches, at most 72 agent-minutes of launch wall plus preparation and scoring; local
compute only; paid inference $0. A launch repeated on acorn uses a fresh workspace and the same
frozen inputs; the two acorn pairs are two samples, not a retry.

## Setup failures and retention

Before the first launch, the neutral smoke passes for both arms through the same runner and
builder. A launch that stops before its arm's first model request is a zero-inference setup
failure: recorded separately, corrected with a recorded note, and retried with the same arm and
task at most twice. Once the arm has made a model request the outcome stands; nothing is retried
because an artifact failed, and an infrastructure failure after that point is that cell's outcome.

## Scoring

Each delivered tree is read by the frozen visible check plus the project tests, the hidden
evaluator (upstream tests, the stage's behavior and preservation cases, the allowed-change
policy) and the project's lint on the base and the tree. Complete delivery requires all of them
where the base passes lint, and added tests that fail on base source and pass on the candidate.

For every `swarm` launch the record reports, from the ledger: whether the decision point fired,
at which step and by which rule; the action (continue, retrieve, diagnose, withheld); for a
diagnosis, whether its answer was actionable, which locations the harness could read, the
distinguishing command and its result, and the hypothesis statuses; whether the next edits or
reads followed the notice; the candidate at the decision point and the delivered candidate; and
the decision's cost in steps, tokens and wall. A notice that changed nothing, a longer trace, a
better explanation or a passing generated check is not an artifact improvement.

## Decision

Pairs are reported as wins, losses and ties on complete delivery, with semantic ties and
infrastructure failures named. Eight development launches support no significance claim. The
held-out product freeze keeps `--adaptive` experimental unless the enabled arm improves complete
delivery without new preservation failures; tuning made from this study is recorded as such
before that freeze.
