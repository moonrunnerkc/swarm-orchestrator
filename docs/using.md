# Using swarm

What a run looks like from the keyboard, and the two shapes beyond one task: a session of
tasks against one workspace, and several workers at once. The commands and flags are in
[`cli.md`](cli.md); this is what they do once they are running. A goal run returns a branch only
after its integrated tree has been checked against the complete declared requirement set.

[What a run does](#what-a-run-does) | [A session](#a-session-or-a-single-task) | [Several workers](#several-workers-at-once) | [The screen](#watching-it-work) | [Settings](#settings)

## Existing repositories and bounded workflows

Start with `swarm init`, which preserves existing configuration and installs nothing. Use repeated
`--package` selections for Node/Python units; outside or shared-root changes stay unverified.
`--preset bugfix|refactor|upgrade --goal-contract FILE` uses the ordinary worker engine with
explicit base controls or narrow dependency authorization. Setup failures stop before model
spending. `--escalate-model` authorizes one alternate target within the original budget; a cloud
credential alone grants no escalation permission. See the [walkthroughs and capability table](broad-use.md).

Browser acceptance requires a sealed `instrument` and an immutable Playwright container runtime.
Project `argv` reports remain unjudged. Unavailable package checks remain visible; missing
required checks prevent complete verification. See the linked broad-use guide for migration.

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

## An ordinary task, start to finish

Most tasks arrive as a sentence, not as a contract file. The ordinary workflow turns the
sentence into sealed criteria, implements against them, and reports what was and was not
established:

```sh
cd your-repository
swarm "add a --no-cache flag that disables the response cache, with a test" --plan-checks
```

1. **Preflight**, before any model call: the repository and base commit, the manifest the gates
   assemble from, the model and why it was chosen, the approval mode. A workspace with no
   manifest is offered a harness first; a missing runtime stops the run here.
2. **Criteria**, with `--plan-checks`: the planner reads the workspace with read-only tools and
   writes requirements, each quoting the task where it can, with checks: a short program over the
   project and input cases with expected results, or, where the task says some text must behave
   like other text, a relation: seed strings, a reference and variants, which the harness tries at
   every position of every seed and compares with each other rather than with written answers. Each check is run once on a fresh checkout of
   the unchanged base and admitted only if it loads, runs, and tells the base from the change: a
   check of the change gets a case wrong and one right there, a check of behaviour that stays
   gets every case right, and a program that imports nothing from the repository is refused.
   A check of behaviour that stays which the base fails is recorded as a disagreement with the
   base, case by case, with whether the task names that case's input; that shows the expectation
   and the base differ, not that the task's request is wrong, since a task can describe as kept
   an outcome the base does not give yet. Dropped checks get one revision when the planning
   allowance still fits it: it is shown the task's words each check quotes, every case with what
   the base gave, and the choice between correcting an expectation and declaring the check again
   as a change with its reason, which is then held to the change control and admitted only for
   inputs the task names. Coverage is read from the checks admission kept: a coverage review that
   names a refused check covers nothing, and a requirement left with no check is reported as
   uncovered, with why and the next useful action, in the worker's brief, the outcome and the
   JSON result (`plannedChecks.uncovered`). Coverage is also read per requested outcome: each
   check records the task's words it quotes, and an outcome is its requirement, those words and
   whether its cases change or keep behaviour. An outcome no retained check states stays
   unresolved even when another check covers its requirement, and is named the same way
   (`plannedChecks.unresolvedOutcomes`); where any is, an `accepted` run says that reading is
   the supplied contract's only. The outcomes are the planner's own statements, so two it put in
   one quote are one, and one it never stated is not tracked. A case that throws is read by where
   it was thrown: in the check program's own code it observed nothing of the project, and the
   check is refused for the revision with the message; in the project it is the project's answer
   (a declared throw, or a diagnostic of a crashing base); where no stack frame names a file it is
   read as the base's answer with that uncertainty recorded. Admission shows a
   check runs and discriminates; it cannot show that its expected results are what the task
   means, so an admitted check is a **diagnostic**: it runs on every candidate, its disagreement
   drives a bounded repair (the repair is told the expectation is the planner's reading of the
   task, which it may contradict), and its result is reported, but it never decides a
   requirement. A planned requirement is therefore a hypothesis about the task: it is reported
   with what its generated checks did, and it neither establishes the task nor counts against
   it; only a requirement you supply, in `--goal-contract`, decides. A planned requirement that quotes the task is kept, unjudged
   and visible, even when every check for it is dropped; one the planner invented, with no quote
   and no admitted check, is dropped and reported as unsupported. The criteria are shown in plain
   language before implementation; on a terminal you are asked to seal them, and anything but `y`
   stops the run having spent only the planning tokens. If the planner cannot pin criteria it
   says why and the run stops before implementation; on a terminal you get one round to answer,
   with the task text kept verbatim. With a contract of your own, pass `--goal-contract`
   instead, or both: the planner's checks are added beside yours and yours still decide.
3. **Base check** of the sealed checks: a check that cannot run here stops the run with the
   remedy named; a check that already passes on the base is named as not evidence of change.
4. **Implementation** through the one worker loop: declared files, the recording chokepoint,
   the gates with the supplied checks as the blocking `task-acceptance` gate and the generated
   ones, where there are any, as `task-diagnostics` beside it, bounded repair under the ratchet. A
   repair that satisfies a generated check by breaking a supplied one is a passing gate
   regressing, and is rolled back; one that a generated check alone asked for is named in the
   outcome. A worker that repeats a tool call it has already been answered is told once and
   stopped the second time, and the gates still run over the tree. A command output over 12,000
   characters reaches the model as a bounded view: its first and last lines, the exit status and
   timeout facts the harness measured, the omitted range, the omitted lines that mention a failure,
   and the evidence record, from which `read_recorded_output` returns any omitted lines. The
   ledger keeps the output as captured, and claims are evaluated against its recorded facts.
5. **Final verification** of the exact tree in a fresh checkout, independent of the worker. It
   has its own share of `--max-wall-minutes`, held back from planning, implementation and repair:
   four times what the preflight's fresh checkout and base checks took, at least a minute, at
   most a quarter of the total (the `verification-reserve-v1` record). When model work reaches
   its share, the gates still run on the delivered tree; a check still running when the whole
   allowance ends is stopped and reported as not run, never as a pass.
6. **The outcome block**, led by one status that the JSON result (`outcome.status`) and the
   exit code share:
   - `accepted` (exit 0): every requirement you supplied was met by a check that decides it, and
     no generated check disagrees; the scope line says what those requirements cover;
   - `unjudged` (exit 0): the gates passed and no requirement was supplied, so nothing says the
     task was done (planned requirements whose generated checks agree leave a run here);
   - `partially-checked` (exit 1): nothing refused the change, but a requirement you supplied was
     decided by no check that ran;
   - `unresolved` (exit 1): a generated check disagrees with the final tree and nothing that
     decides refused it; either the check expects something the task does not ask for or the
     change is incomplete, and nothing here can tell which;
   - `unverified` (exit 4): the model or the final verification's environment was unavailable,
     so nothing established the change either way;
   - `not-accepted` (exit 1): a supplied check, a blocking gate, policy or the final
     verification refused it, nothing executed it, or the run was interrupted.

   Then each requirement (met, unmet, unjudged; a planned one with the task words it quotes and
   what each generated check did), the scope of what was sealed, the branch and the files the
   recorded diff touches (edits land in the working tree, uncommitted), which checks ran and
   what they could not measure, time, tokens and cost with planning shown separately,
   interventions counted by who made them, and, when the run is not accepted, one next action,
   including `swarm resume <run-id>` where it applies. The evidence panel follows with the
   bundle, the review page and the verifier.

During repair the worker can call `run_check` to rerun the acceptance checks exactly as the gate
runs them and see a failing check's cases, or to run a short diagnostic program over the project
with no file to write. A repair after a rolled-back attempt is told what that attempt fixed, what
it broke and why it was refused, while it starts from the restored files.

Planning and criteria authoring are part of what the task costs and are accounted against the
run's token and wall allowances, not granted on top of them.

## When a first run fails

- **`no model to run: ...`, exit 4.** Nothing pinned a model and no local server answered where
  the message says it looked. Start Ollama with a model pulled (`ollama pull qwen3.6:35b-a3b`) and
  pass `--model local:qwen3.6:35b-a3b`; add `--local-endpoint <url>` if the server is not on its
  default port. `swarm select` suggests a model for the machine.
- **`--x is not an option of this command`, exit 2.** A misspelt flag is refused by name before
  anything runs; `swarm --help` lists the flags.
- **`swarm --version` does not say `source build`.** The installed `swarm` is the 14.4.0 npm
  release, not the build of this source; reinstall the packed tarball as the README shows.
- **The outcome reads `unverified`, exit 4.** The model stopped answering, or the final
  verification could not prepare a fresh checkout (its line in the outcome block says why). The
  edits are left in the working tree; fix what it names and run again.
- **The model answers but nothing changes.** The outcome says `the run changed nothing`; a
  smaller model often stops early. Give the task a file name and a concrete behaviour, or use a
  stronger model.
- **`swarm verify <bundle>` exits 1 with every check passing.** No `--signer` was named, so the
  signer is untrusted by design; `node <bundle>/verify.mjs <bundle>` checks the record without
  one ([verifying.md](verifying.md)).

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
tests = { command = "npm run --loglevel=error test", parser = "test-output" }
# from package.json scripts.lint: biome check
lint = { command = "npm run --loglevel=error lint", parser = "exit-code" }
build = "npm run --loglevel=error build"

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
