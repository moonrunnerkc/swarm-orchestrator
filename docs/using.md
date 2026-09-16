# Using swarm

What a run looks like from the keyboard, and the two shapes beyond one task: a session of
tasks against one workspace, and several workers at once. The commands and flags are in
[`cli.md`](cli.md); this is what they do once they are running. A goal run returns a branch only
after its integrated tree has been checked against the complete declared requirement set.

[What a run does](#what-a-run-does) | [A session](#a-session-or-a-single-task) | [Several workers](#several-workers-at-once) | [The screen](#watching-it-work) | [Settings](#settings)

## What a run does

Give it a task and a git repository. It declares the files it intends to touch, edits through a
chokepoint that records every tool call, runs your project's gates, and retries a failing gate
under the ratchet. What comes back is a reviewable change plus a signed, hash-chained record of
what ran, what passed, and what nobody measured.

|  | |
| --- | --- |
| **Make a bounded change** | The intended file set goes on the ledger before the first edit. An edit outside it blocks until an amendment naming the file and the reason is recorded, and the amendment is in the bundle for a reviewer to see. |
| **Retry under the ratchet** | A blocking gate that fails hands its output back to the model, which gets a capped number of attempts. The ratchet compares numbers rather than booleans: tests collected, assertions in the touched test files and coverage of changed lines cannot decrease, skip markers cannot increase, and a passing gate cannot regress. A retry that trades one of those away is rejected and still counts against the cap. The final state is compared to the base commit as well, so a first attempt that deleted the failing tests and went green is caught without a retry ever running. |
| **Say what a result does not establish** | A run reports nine answers rather than a boolean, and `unmeasured` is one of the values. "Nobody checked" and "checked and failed" are different findings, and flattening them is how a change nothing executed comes to read green. |

The ratchet has one escape hatch: a test that is new in the submitted file and fails on the base
commit is a new specification rather than a tampered one, and clears exactly one deleted test in
its own file. Coverage of changed lines is read only from an lcov report the runner wrote on a
stream the harness owns, under an invocation the harness built argument by argument; a runner the
harness cannot invoke that way leaves that arm `unmeasured` by name, never guessed at.

For a cross-component change, use the goal controller:

```sh
swarm parallel --goal "Add pagination through storage, the API, the SDK, and maintained tests" \
  --model local:qwen3.6:35b-a3b --max-tokens 200000
```

The controller shares one budget, starts dependents when their prerequisites land, and creates
bounded repair work when a clean merge fails behaviorally. Tiny or tightly coupled goals stay with
one worker. The result names accepted requirements, blockers, the integrated branch, and its
evidence.

## A session, or a single task

Run `swarm` with no task and it opens a session: one process, one ledger, and tasks typed one
after another, each continuing the conversation the last one left.

```
› create calculator.js exporting add and multiply, and calculator.test.js covering both
  8 gate(s) passed, 8 step(s)

› add a divide function that throws on division by zero, and cover both cases
```

Each turn is measured on its own. A turn ends by recording where it left the tree, so the next
one's gates see that turn's changes and not the ones before it. The gate commands every turn
runs are read from the commit the session started on and sealed once before the first turn, so
no turn is measured by a manifest the turn before it wrote. Three turns of this, with the
bundle verified from outside and the page it produced, are in
[`session.md`](evidence/2026-08-24/session.md).

`swarm "task"` still runs one task and exits.

## Several workers at once

`swarm parallel` gives each task a git worktree of its own and a merge queue that lands them
one at a time under the same ratchet a single run answers to. Nothing is merged into the
branch you are sitting on; the result waits on an integration branch and the report tells you
how to take it. The controller starts ready work as resources permit, keeps one integration writer,
and shares the planning, worker, repair and verification budget.

Three things sit on top of that, each optional and each off unless asked for.

**Workers read each other's ledgers.** They coordinate through the record they were already
writing, not through a bus or a daemon: which files a peer has declared, which gates have
failed on it and how often, which approaches it has already spent its attempts on. Nothing a
worker reads there can render green. Every signal comes from a ledger record rather than from
model text, every line names the peer it is about, and no signal reports a success, so there
is nothing in it to mistake for a gate result.

**`--redundancy <n>` tries each task several ways and lands the best of them.** The winner is
chosen by reading which attempt moved the measured numbers, never by asking a model which
answer it likes. The whole ranking goes on the chain, losers and the reason each was left out
included, so you re-read the choice instead of taking it.

**`--goal <text>` breaks the goal into tasks itself.** A planner reads the workspace with
read-only tools and declares a task graph before the first worker starts. The controller checks
unique ids, resolving dependencies, cycles, intended files, effective task contracts and required
checks. Readiness scheduling releases a dependent as soon as its prerequisites are accepted while
unrelated work continues. A missing prerequisite, repeated interaction failure, or repair route can
produce a bounded append-only graph revision. Requirement identities and failed attempts remain in
the ledger, and stale candidates cannot overwrite accepted state.

Two runs of this, committed with their bundles, are in
[`swarm.md`](evidence/2026-08-24/swarm.md). The second one is the more useful: every
structural check passed on a decomposition that could not work, because the planner left out
a dependency. The adaptive controller turns that observed failure into a recorded repair or graph
revision. Final goal checks run in a fresh verifier workspace, so worker-local green checks do not
establish completion.

Prefer one worker for a one-file edit, a tiny task, or components that must change together. Use
several workers when the goal has independent, observable interfaces and the shared budget supports
the extra setup and integration cost. A repair records the rejected candidate, the current
integration commit, the bounded retry, and the resulting branch. `resume` reconstructs those
events and never lands an accepted commit twice.

## Watching it work

On a terminal, a run draws a single screen you can drive. Off one, it writes the same plain
lines it always did, so pipes and CI are unchanged.

Before the screen goes up, a card says what the run settled before the model was asked for
anything. It stays on the scrollback, so it can still be read once the screen has come down.

```
✓ repository   ~/projects/scratch-repo at aae1321a
✓ manifest     package.json
✓ model        local:qwen3-coder:30b-a3b  (the best served model for this hardware)
✓ approval     ask  (a on a prompt allows that program for this run; --approve auto answers allowlist prompts itself)
```

Then the screen: a header with the task and the run's counters, the plan, a timeline with a
mark and a clock time on every row, and the gate strip with its counts.

```
swarm  make the parser trim before it splits
  20s · step 4 · tokens at the end · attempt 1/3 · local:qwen3-coder:30b-a3b · approval: ask · ~/projects/scratch-repo
◆ plan
  read the failing test, fix the parser, run the gates
◆ timeline
  ○ 0:04  edit path=src/parse.ts find=text.split replace=text.trim().split
  ✓ 0:04  edit ok: 1 replacement
  ○ 0:09  shell command=npm test
  ✗ 0:17  shell failed: 1 failing
  ✓ 0:19  ratchet accepted: tests collected 12 to 12, assertions 34 to 35, skips 0 to 0
◆ gates  attempt 1/3   ✓ 2 passed  ✗ 1 failed  ○ 1 n/a
  ✓ PASS tests: 12 collected, 0 failed
  ✓ PASS lint: no findings in 208 files
  ○ N/A  coverage: no lcov artifact was written to the path the harness named
  ✗ WARN diff-budget (advisory): 1 file changed, 1 line added, budget 12 files and 400 lines
DONE stopped: completed (4 steps, 5812 tokens)
j scroll  enter expand  tab pane  / filter  e evidence  ? help  q detach  ctrl+c cancel run
```

The marks are ASCII (`+`, `x`, `-`, `*`) where the locale is not UTF-8 or the terminal is dumb.

While it works there is a line that says so: a spinner that turns, what is happening, how long
it has been happening, and, while the model is talking, the tail of what it is saying. One
line, deliberately: the whole response lands in the action stream when it arrives and in the
ledger for ever, and repeating it as it streams would be the same text three times.

`?` lists every key. `enter` expands a row to its whole payload and the ledger record it came
from. `q` leaves the view: the screen comes down and the run keeps going, reporting the plain
lines it writes off a terminal. `ctrl+c` cancels the run. There is no progress bar, because an
agent run has no denominator.

When the run ends, the screen becomes a finish card: the verdict, what the run took, and the
two paths a person opens, each a clickable link where the terminal understands OSC 8 links
(iTerm2, WezTerm, kitty, VS Code, Windows Terminal, GNOME Terminal and its relatives).

```
✓ work accepted   1m 04s · 4 steps · 5,812 tokens · $0.00
  review page   /Users/brad/.swarm/sessions/s-20260916-1a2b/bundle/review.html
  bundle        /Users/brad/.swarm/sessions/s-20260916-1a2b/bundle
  verify        node /Users/brad/.swarm/sessions/s-20260916-1a2b/bundle/verify.mjs /Users/brad/.swarm/sessions/s-20260916-1a2b/bundle
  180 records, 2 claims verified, 0 refused, bundle verified here (exit 0)
```

`o` opens the review page and `b` the bundle without the link. The cost is the run's own
token counts at the published rate, `$0.00` for a local model, and `cost not priced` where no
rate could be read. It says the bundle verified only if the bundle's own verifier ran here and
exited 0. `swarm review <bundle>` shows the same facts for any bundle already on disk. `swarm calibrate` has a screen of its
own for a sweep, built the same way, from the sweep's own records.

The keymap, the `swarm.toml` surface, the degradation matrix, and a recording of a session
are in [`interface.md`](evidence/2026-08-23/interface.md), with the frames in
[`interface-frames.txt`](evidence/2026-08-23/interface-frames.txt) and a playable
asciinema capture in [`interface.cast`](evidence/2026-08-23/interface.cast).

## Settings

Settings live in one optional `swarm.toml` in the workspace: providers and endpoints, gate
definitions, budgets, model pins, and the `[interface]`, `[theme]` and `[keys]` tables. Flags
win over the file. `swarm init` writes one from the scripts `package.json` declares, and a
first run on a terminal in a workspace that has a manifest and no file offers to.

```toml
[gates]
# from package.json scripts.test: node --test
tests = { command = "npm run --silent test", parser = "test-output" }
# from package.json scripts.lint: biome check
lint = { command = "npm run --silent lint", parser = "exit-code" }
build = "npm run --silent build"

[providers]
local_thinking = false         # the model behind the local endpoint answers without reasoning first

[interface]
confirm_timeout_minutes = 30   # an unanswered confirmation refuses itself; 0 waits for ever
```

A gate line is a command alone, or a table naming the severity it blocks at and the rule that
reads its output; an id the harness has no slot for, such as `build`, adds a gate. Where the
harness has no parser for a test runner's output, `swarm init` writes that gate advisory and
says why in the comment above it.

`local_thinking` matters on a reasoning model served locally. Left unset, nothing is sent and
the server's own default stands, which is the only safe default: the field is a vendor
extension and a server that rejects what it does not recognise would fail every call rather
than one. Ollama's OpenAI-compatible route ignores the field; that is the server's limit
rather than this one's.

`confirm_timeout_minutes` is why a run left alone no longer waits for ever. The chokepoint asks
before it runs a command that is not on the allowlist, and a question nobody answers used to
hold the run until somebody came back to it. Refusing is what a declined question records
either way, so the deadline costs that one tool call and the run carries on.
