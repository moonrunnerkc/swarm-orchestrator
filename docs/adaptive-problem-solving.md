# Adaptive decision point (experimental)

`swarm "<task>" --adaptive` turns on one decision point per worker loop (rule
`adaptive-decision-v1`). It is off by default and experimental: the evidence so far is listed at
the end of this page, and it does not establish a general benefit.

## What it does

Each loop, the task's first loop and every repair or continuation attempt, reaches its decision
point once: after the first step at which it has used 40 percent of its steps or 40 percent of its
wall, whichever comes first. A loop that finishes earlier never reaches it, so a direct task pays
nothing. At the point the controller reads the loop's **working state** and chooses one action by a
registered rule:

| Working state | Action | Model call |
| --- | --- | --- |
| Edits have landed and no check at the current tree failed | continue | none |
| Edits have landed and the latest check at the current tree failed | one diagnosis of that failure; a different implementation is admissible only after two edited trees in a row ended failing | one bounded diagnosis |
| No edit yet, and searches matched nothing for code-like names | harness search for those names as whole words | none |
| No edit yet, otherwise | one diagnosis of what blocks implementation | one bounded diagnosis |

Reaching the point without an edit is not treated as proof of a stall: exploration can be
productive. The point sits at a fixed share of the allowance so that one fresh look happens while
most of the allowance is still there to act on it.

## Working state

`src/core/working-state.ts` derives a compact record from the loop's recorded tool calls and
results, never from model prose:

- the original task and the required checks still to pass on the delivered tree;
- the candidate's digest and changed files, measured by the harness at the point;
- landed and refused edits, reads, searches that matched nothing, declared files not yet edited;
- the last few executions with command, exit status, a bounded excerpt, the evidence record
  holding the whole result, and the workspace generation they ran against;
- explanations, labelled as model-proposed hypotheses, and whether each one's stated prediction
  held when the harness ran the distinguishing command (held, failed, untested, or no
  distinguishing prediction where several hypotheses predict the same result). A held or failed
  prediction says nothing beyond that prediction: a weak prediction can fail for a right explanation;
- the next unresolved question, labelled as model-proposed, and the loop's remaining steps, tokens
  and wall.

An execution made before a later edit is named as predating the current tree. Shell commands can
change files without a recorded edit, and the record says so rather than guessing. Repair and
continuation briefs carry the previous loop's working state and the run's hypotheses, so findings
and requirements survive a fresh context; the decision notice is a user-role harness message, so
compaction keeps it. Nothing is inserted twice: one notice per loop.

## The diagnosis

A fresh context with read, search and list only, at most five steps and a quarter of the loop's
remaining tokens and 30 percent of its remaining wall (at most 150 seconds), answers with one JSON
object: the unresolved question, up to three competing hypotheses with what each predicts of one
distinguishing command, up to four locations and an approach. The harness then checks what it can:

- a location counts only if the worker's own chokepoint can read it from the workspace now;
- the distinguishing command runs through the worker's chokepoint, and its exit status and output
  decide whose stated predictions held;
- an approach counts only if it names a file the harness has seen.

An answer with no readable location, no executed distinction and no grounded approach is discarded
and the loop is told nothing; its cost is still charged and recorded. The diagnosis cannot write,
and nothing it says reaches the gates: acceptance, checks, ratchets, scope and the final
verification reserve are unchanged. Each decision is a `verification-command` record with the
rule, signals, chosen action, the diagnosis answer and what the harness established, and its cost.

## Research basis and what transfers

Read October 22, 2026 (see [the capability study](capability-study-2026-10-22.md#research-to-mechanism)):

- [Scaling Test-Time Compute for Agentic Coding](https://arxiv.org/html/2604.16529v1): compact
  trajectory summaries support sequential refinement on SWE-Bench Verified and Terminal-Bench with
  frontier models and extra compute. Plausibly transferable: carrying a compact, checkable state
  into a fresh context. Not transferred: model-written summaries as fact, voting or tournaments.
- [Scaling Inference-Time Compute with Teams of Coding Agents](https://arxiv.org/html/2610.17471v1):
  delegated planning helps some benchmark stages and costs more compute. Hypothesis only: one
  bounded diagnosis inside the existing allowance helps a local model that inspects without
  implementing. No team, no extra allowance.
- [Effective context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents):
  guidance on compact state and retrieval, not a controlled comparison. Used for the shape of the
  working state and retrieval through existing tools; no memory database.
- [Harness design for long-running applications](https://www.anthropic.com/research/harness-design-long-running-apps):
  planner and evaluator roles, with orchestration removable as models improve. Used as a caution:
  keep the direct path cheap and measure whether added reasoning pays for itself. No LLM evaluator
  or agreement gate.

No published percentage is carried over. Whether any of this helps a local model on these tasks is
what the studies measure.

## Evidence so far and limitations

Deterministic controller tests (`src/agent-run.test.ts`, `src/core/working-state.test.ts`,
`src/core/loop.test.ts`) script the model and show: the point fires before the allowance is spent
and receives the task and measured observations; stale observations are named; an edit and a check
can follow the notice; the diagnosis's cost stays inside the original budget; a direct task gets no
decision and a loop with landed edits gets no model call; generic advice is discarded; the
diagnosis cannot write, and a test weakened on its advice is still refused by the gates. These are
scripted, not live model behavior. A replay of the registered rule over the two retained acorn
loops of 2026-10-22 (no model call) shows both reaching the point at step 16 of 40 with no edit.

Live results are in [the adaptive stage's evidence](evidence/2026-10-22-adaptive/README.md).

Known limits: the rule's thresholds were set before any live trial and are not tuned; the
diagnosis uses the same model as the worker; a location that exists can still be the wrong place;
exit statuses of commands that end in `echo` or `exit 0` carry no information; the point fires once
per loop, so a loop that goes wrong after it gets no second look; and an alternative
implementation is advice plus a recorded recoverable candidate, not a separately selected attempt.
