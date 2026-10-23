# Adaptive decision point (experimental)

`swarm "<task>" --adaptive` turns on one decision point per worker loop (rule
`adaptive-decision-v2`; `v1` is the October 22 version). It is off by default and experimental:
the evidence so far is listed at the end of this page, and it does not establish a general benefit.

## What it does

Each loop, the task's first loop and every repair or continuation attempt, reaches its decision
point after the first step at which it has used 40 percent of its steps or 40 percent of its wall,
whichever comes first. A loop that finishes earlier never reaches it, so a direct task pays
nothing. At the point the controller reads the loop's **working state** and chooses one action by a
registered rule:

| Working state | Action | Model call |
| --- | --- | --- |
| Changes have landed and no check is failing on the current tree | continue | none |
| Changes have landed and a check's latest result on the current tree failed | one diagnosis of that failure; a different implementation is admissible only after two edited trees ended with a failing check | one bounded diagnosis |
| No change yet, and code-like names were searched for that appear nowhere the loop was shown | harness search for those names as whole words | none |
| No change yet, otherwise | one diagnosis of what blocks implementation | one bounded diagnosis |

Reaching the point without an edit is not treated as proof of a stall: exploration can be
productive. The point sits at a fixed share of the allowance so that one fresh look happens while
most of the allowance is still there to act on it.

## Looking at what an intervention led to

A retrieval or a diagnosis that gave the worker a notice records what it was for: a change landing
on the tree, or the failures it was about no longer being open. A few steps later (a tenth of the
loop's steps, at least three) the point looks again, at no cost:

- if that happened, it is done;
- if not, but the worker is reading files it had not read or running checks, it looks once more;
- otherwise the intervention led nowhere, and the loop's second and last intervention is one
  **reassessment**: a diagnosis told what the first intervention was for and that it has not
  happened, asked for one concrete action (an edit batch with exact text, or one shell command
  that changes the workspace). The harness carries a valid action out through the worker's own
  chokepoint, so the worker's permissions, declared files, guard and records all apply, and the
  worker's next turn shows what was done and the result. An edit batch is applied whole or not at
  all.

A loop makes at most three decisions and two interventions. Everything they spend comes out of
the loop's own steps, tokens and wall; the final verification reserve is held apart as before.
Continuing a loop whose work is landing has no follow-up.

## Working state

`src/core/working-state.ts` derives a compact record from the loop's recorded tool calls and
results, never from model prose:

- the original task, the required checks, and the task's own sentences about behaviour to keep
  and tests to add, quoted and labelled as judged by no check here;
- the candidate's digest and changed files, measured by the harness at the point;
- landed changes (file edits, and shell commands whose measured effect changed files), refused
  edits, reads, searches that matched nothing, declared files not yet edited;
- checks failing on the current tree, and checks that failed before a later change and have not
  run since;
- the last few executions with command, exit status, whether it was an inspection, a bounded
  excerpt, the evidence record holding the whole result, and the tree it ran against;
- explanations, labelled as model-proposed hypotheses, and whether each one's stated prediction
  held when the harness ran the distinguishing command;
- the next unresolved question, labelled as model-proposed, and the loop's remaining steps, tokens
  and wall.

What changed in v2, and why:

- **Checks are kept apart from inspections.** A command that only prints the workspace (`ls`,
  `sed -n`, `git diff`, `grep`) is an inspection; its exit status is never a check result. Any
  other command is a check of its subject (the command without a workspace `cd` and trailing
  filters). A check's result is compared only with a later run of the same subject. In v1 an `ls`
  exiting 0 after a failing `npm test` made the tree look green; one development repair loop
  continued past an open lint failure that way.
- **A status that is not the check's is unknown.** `npm test | tail`, `cmd || true` and `cmd; echo`
  report another command's status; a refused call and a timeout report none. These are recorded as
  uncertainty, never as a pass or a failure.
- **Shell writes count.** The harness measures the workspace before and after every shell command
  (`src/agent-workspace-effects.ts`, one scratch index kept for the run) and writes the effect into
  the result: unchanged, the paths changed (moves paired), or not measured. A changed tree starts a
  new generation, so a check before it predates the current tree; an unmeasured command marks what
  came before it as possibly changed. After a move or deletion, the result also names where the
  old path is still written, which is a lexical search, not import resolution.
- **Retrieval only of what the loop has not seen.** A name searched for under a path-qualified
  pattern that matched nothing, but already shown by a listing or another search, is not missing.

## Edits

Two readings of edits apply in every run, adaptive or not:

- **Batch edits.** `edit` takes `edits: [{path, find, replace}, ...]`, checked whole before
  anything is written and applied all or none. A mechanical change across files is one call. After
  a replacement lands, the result names other files where the exact replaced text still occurs.
- **A reason before a rewrite drops an existing implementation.** An edit whose replaced code calls
  a function the workspace defines, whose new code no longer calls it, and which puts at least three
  times as many lines (and at least twelve) in its place is held with a sentence naming the
  function and where it is defined, the task's own words about behaviour to keep, and a request to
  delegate where that suffices or resend with a `reason`. Fewer changed lines is not the rule; the
  reason is. Held-out block 1's p-limit bug fix re-implemented the queue in place of the
  delegating call and lost the synchronous-throw behaviour the task named.

A task that asks for tests, whose candidate changes no file that could hold them, is owed one
bounded follow-up through the existing outcomes slot (it reports the measured absence and the
task's words; no sealed check states it, so it stays reported as unresolved either way).

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

Live results are in [the adaptive stage's evidence](evidence/2026-10-22-adaptive/README.md). In
development the point delivered one diagnosis notice before any edit on a task the same launch then
completed (one sample, no causal claim); on the four held-out tasks it decided seven times, chose
continue six times and retrieval once, ran no diagnosis and changed no delivered artifact.

The October 23 revision is evidenced in [its stage report](evidence/2026-10-23-controller/README.md):
reproductions of both decision-input defects, a replay of all 23 recorded decisions through v2
(three change), deterministic tests of the follow-up and reassessment path, and the live studies.

Known limits: the rule's thresholds and the follow-up window were set before any live trial and are
not tuned; the diagnosis uses the same model as the worker; a location that exists can still be the
wrong place; the inspection list is lexical, so a program not on it is read as a check; a
reassessment's action is the same model's proposal, carried out under the worker's permissions,
and can be wrong, which the gates and the worker's next turns must catch; the rewrite reading is
lexical (a call is a name before a parenthesis) and can ask for a reason where none was needed; and
an alternative implementation is advice plus a recorded recoverable candidate, not a separately
selected attempt.
