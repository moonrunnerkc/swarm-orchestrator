# Using swarm

What a run looks like from the keyboard, and the two shapes beyond one task: a session of
tasks against one workspace, and several workers at once. The commands and flags are in the
README; this is what they do once they are running.

[A session](#a-session-or-a-single-task) | [Several workers](#several-workers-at-once) | [The screen](#watching-it-work) | [Settings](#settings)

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
how to take it.

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
read-only tools and declares a task graph, which is checked for unique ids, resolving
dependencies, no cycle, and files that two unordered tasks do not share, and recorded before
the first worker starts. Nodes land layer by layer.

Two runs of this, committed with their bundles, are in
[`swarm.md`](evidence/2026-08-24/swarm.md). The second one is the more useful: every
structural check passed on a decomposition that could not work, because the planner left out
a dependency. Whether a set of tasks adds up to a goal is a judgement about meaning, and this
tool makes none.

## Watching it work

On a terminal, a run draws a single screen you can drive. Off one, it writes the same plain
lines it always did, so pipes and CI are unchanged.

```
swarm  make the parser trim before it splits
  local:qwen3-coder:30b-a3b  /Users/brad/projects/scratch-repo  20s  step 4  5812 tokens  attempt 1/3
plan
  read the failing test, fix the parser, run the gates
actions
  edit path=src/parse.ts find=text.split replace=text.trim().split
  shell command=npm test
  shell failed: 1 failing
  ratchet accepted: tests collected 12 to 12, assertions 34 to 35, skips 0 to 0
gates  attempt 1/3
  PASS tests: 12 collected, 0 failed
  PASS lint: no findings in 208 files
  N/A  coverage: no lcov artifact was written to the path the harness named
  WARN diff-budget (advisory): 1 file changed, 1 line added, budget 12 files and 400 lines
DONE stopped: completed (4 steps, 5812 tokens)
j scroll  enter expand  tab pane  / filter  e evidence  ? help  q detach  ctrl+c cancel run
```

While it works there is a line that says so: a spinner that turns, what is happening, how long
it has been happening, and, while the model is talking, the tail of what it is saying. One
line, deliberately: the whole response lands in the action stream when it arrives and in the
ledger for ever, and repeating it as it streams would be the same text three times.

`?` lists every key. `enter` expands a row to its whole payload and the ledger record it came
from. `q` leaves the view: the screen comes down and the run keeps going, reporting the plain
lines it writes off a terminal. `ctrl+c` cancels the run. There is no progress bar, because an
agent run has no denominator.

When the run ends, the screen lists what it produced, says how many claims the harness
verified and how many it refused, and offers to open the review page. It says the bundle
verified only if the bundle's own verifier ran here and exited 0. `swarm review <bundle>`
shows the same panel for any bundle already on disk. `swarm calibrate` has a screen of its
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
