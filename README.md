# swarm-orchestrator

[![gates](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/gates.yml?branch=v13-main&style=flat-square&label=gates)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/gates.yml)
[![nightly proof](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/nightly-proof.yml?branch=v13-main&style=flat-square&label=nightly%20proof)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/nightly-proof.yml)
[![weekly evidence](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/weekly-evidence.yml?branch=v13-main&style=flat-square&label=weekly%20evidence)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/weekly-evidence.yml)
[![npm](https://img.shields.io/npm/v/swarm-orchestrator?style=flat-square&label=npm)](https://www.npmjs.com/package/swarm-orchestrator)
[![node](https://img.shields.io/badge/node-%3E%3D24-blue?style=flat-square)](package.json)
[![license](https://img.shields.io/github/license/moonrunnerkc/swarm-orchestrator?style=flat-square)](LICENSE)

A proof-carrying runner and verifier for bounded code changes.

Give it a task and a git repository and it will make the change. Give it somebody else's patch
and it will tell you what that patch actually establishes. Either way what comes back is a
signed, hash-chained record of what ran, what passed, and what nobody measured, which anybody
can check without installing this tool.

The model can say whatever it likes. It cannot make a gate pass, it cannot mark a claim
verified, and it cannot change a record after the fact.

[What it does](#what-it-does) | [Install](#install) | [Use](#use) | [Verifying somebody else's work](#verifying-somebody-elses-work) | [What a run reports](#what-a-run-reports) | [Several workers](#several-workers-at-once) | [Watching it work](#watching-it-work) | [What is claimed](#what-is-claimed) | [What is not claimed](#what-is-not-claimed) | [How it works](#how-it-works) | [Limits](#limits) | [Upgrading from v12](#upgrading-from-v12)

## What it does

Three jobs, and the second and third do not need this tool's own agent.

**Make a bounded change.** Give it a task and a git workspace. It plans, declares the files it
intends to touch, edits through a chokepoint that records every tool call, runs your gates, and
retries failures under a numeric ratchet that refuses a fix which trades away tests, assertions
or coverage. Then it exports the evidence.

**Verify a patch anybody produced.** `swarm ci --patch <file>` clones the base commit somewhere
the producing tree cannot reach, applies the patch there, and runs the checks in that checkout.
Nothing the producer said travels except the patch. It reads another agent's own event stream
beside it if you have one.

**Say what a result does and does not establish.** A run reports nine separate answers rather
than a boolean, and `unmeasured` is one of the values. "Nobody checked" and "checked and
failed" are different findings that call for different things, and flattening them is how a
change nothing executed comes to read green.

Here is a real run, committed: [`live-tasks.md`](docs/evidence/2026-08-18/live-tasks.md),
with its bundle in [`live-frontier/`](docs/evidence/2026-08-18/live-frontier). And here is the
packaged tool doing it, installed from a tarball into a directory holding nothing else, against
a workspace it had never seen, recorded in a real terminal:
[`installed-package-run.md`](docs/evidence/2026-08-23/installed-package-run.md).

## Install

    npm install -g swarm-orchestrator

That is **13.1.9**, and it leaves `swarm` on your path.

Installing from a tag works too, but only into a project rather than globally:

    npm install github:moonrunnerkc/swarm-orchestrator#v13.1.9

`dist/` is not committed, so a git ref builds itself on install and needs this package's
devDependencies to do it. npm does not install those when a git ref is installed with `-g`: it
carries the global context into its git-dependency preparation, places the clone as a root
package, and runs the build without the compiler. The published package needs no build, which
is why the line above it is the one to use.

Anything below 13 is a different program. This package name carried a pull-request auditor
through 12.x, and `npm install -g swarm-orchestrator@12` still installs it, so pin the major if
you depend on one or the other: [Upgrading from v12](#upgrading-from-v12).

If `swarm` turns out to be an older version than you installed, something else owns the command.
The usual cause is a development checkout linked into the global prefix with `npm link`, which
owns it until it is removed and which npm cannot install over: the install either fails renaming
a symlinked directory aside, or succeeds behind a stale executable still pointing at the
checkout. `swarm doctor` says which of those happened and `swarm doctor --fix` repairs it.

Node 24 or newer. That is a runtime floor rather than a preference: the coverage cycle
spawns the test runner with `--test-isolation=process`, which Node 22 rejects as a bad
option, so on anything older that measurement does not happen.

## Use

    swarm "make slugify collapse whitespace and strip punctuation"

    swarm                            # a session: type tasks, one after another
    swarm doctor                     # what owns the swarm command, and --fix to repair it
    swarm init                       # write swarm.toml from package.json's scripts
    swarm gates                      # run the gates over a workspace, no model
      --allowed-files <a,b>          # the scope you authorise, for the file-set check
    swarm select                     # probe this machine, recommend a local model
    swarm calibrate                  # measure candidate models on the golden set
    swarm routing                    # what the reward log adds up to
    swarm parallel --tasks <file>    # a worker per task, then a merge queue
    swarm parallel --goal <text>     # break the goal into tasks, then run them
      --redundancy <n>               # try each task n ways, land the best of them
      --concurrency <n>              # how many workers may hold a worktree at once

    swarm ci --patch <file>          # verify a patch in a fresh checkout of the base
      --immutable <a,b>              # paths the patch may not touch
      --agent-stream <file>          # another agent's event stream, read beside it
      --agent-format claude-code     # or generic
    swarm verify <bundle>            # check a bundle, and who signed it
      --signer <fingerprint>         # the identity you expect, from outside the bundle
    swarm review <bundle>            # what a past run produced, and open it
    swarm replay <bundle>            # read a bundle back

    swarm list-runs                  # runs this machine has state for
    swarm inspect <run-id>           # what a run did, and what it still owes
    swarm resume <run-id>            # take up a run that was interrupted
    swarm retry-step <run-id> <step> # run one step again
    swarm abort <run-id>             # stop a run and refuse it new work
    swarm repair <run-id>            # release what a dead run left held
    swarm gc [--older-than 30d]      # what stored evidence would be removed, --remove to do it

    swarm --isolation docker "..."   # run commands behind a kernel-enforced boundary
    swarm --json "..."               # line-delimited JSON: one line per event, one result
    swarm --no-tui "..."             # plain lines even on a terminal
    swarm --no-color "..."           # no colour, whatever the terminal says
    swarm --open-evidence "..."      # open the review page when it finishes
    swarm --model local:<id> "..."   # a specific model
    swarm --workspace <dir> "..."    # a repository other than the current directory
    swarm --base <ref> "..."         # what the diff and the ratchet measure against
    swarm --attempts <n> "..."       # how many times the ratchet may retry a gate
    swarm --max-steps <n> "..."      # how long the loop may run before it stops
    swarm --max-wall-minutes <n> "..." # the whole run's clock: the loop and every retry together
    swarm --local-endpoint <url>     # an OpenAI-compatible server other than the default

`swarm --help` prints all of it, including the calibration flags.

Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` for a frontier
model, or start Ollama or rapid-mlx and pass `--model local:<id>`. With no model named, the
router picks one from what the calibration measured on this machine, and `swarm routing` shows
what it has learned. Keys come from the environment or your OS keychain and have no
`swarm.toml` setting: that file is committed and cloned, so a key in it has already been shared
with everyone holding the repository, and a file naming one is refused with rotation guidance.

Settings live in one optional `swarm.toml`: providers and endpoints, gate definitions, budgets,
model pins, and the `[interface]`, `[theme]` and `[keys]` tables. Flags win over the file.

Two of those are worth knowing about before you need them.

    [providers]
    local_thinking = false      # the model behind the local endpoint answers without reasoning first

    [interface]
    confirm_timeout_minutes = 30   # an unanswered confirmation refuses itself; 0 waits for ever

`local_thinking` matters on a reasoning model served locally. Left unset, nothing is sent and
the server's own default stands, which is the only safe default: the field is a vendor
extension and a server that rejects what it does not recognise would fail every call rather
than one. Set it, and a model that would otherwise spend its whole output budget thinking
answers instead. Against rapid-mlx serving qwen3.8:27b, one request cost 37 completion tokens
with reasoning on and 2 with it off. Ollama's OpenAI-compatible route ignores the field; that
is the server's limit rather than this one's.

`confirm_timeout_minutes` is why a run left alone no longer waits for ever. The chokepoint asks
before it runs a command that is not on the allowlist, and a question nobody answers used to
hold the run until somebody came back to it. Refusing is what a declined question records
either way, so the deadline costs that one tool call and the run carries on.

## Verifying somebody else's work

Every gate a run executes runs in the workspace that run was editing, with the tests that run
may have changed, reading reports that run's own processes wrote. The sealed criteria and the
ratchet close most of that. What they cannot close is the shape of it: a subject grading its
own paper.

`swarm ci` is the separate opinion.

    swarm ci --patch candidate.diff --immutable ".github/**"

It clones the base commit into a fresh checkout, applies the patch there, and runs the checks in
that checkout, with the gates assembled from the base commit's manifests rather than the patched
tree's, so a patch that rewrites the test script does not get to choose the instrument that
measures it. A patch touching a path you declared immutable is refused before anything runs. A
patch that will not apply reports that no check happened rather than passing on an unchanged
tree.

It does not need this tool's agent to have produced the patch. Pass `--agent-stream` with
`--agent-format claude-code` or `generic` and another agent's own event stream is read beside
it; a line the adapter does not recognise refuses the whole stream by line number rather than
being skipped, because a skipped line is evidence that quietly went unread.

## What a run reports

Nine answers, not one:

```
verdict:
  integrity       valid
  signer          untrusted
                  no expected signer was matched, so the signature shows the bundle is
                  unchanged since it was written and not who wrote it
  executionTrust  restricted
                  commands ran under a lexical path and program policy, which is not containment
  policy          pass
  mechanical      pass
                  lint passed
  behavioral      unmeasured
                  no dynamic gate ran, so nothing executed the change (tests stood down)
  semantic        unmeasured
  task            unjudged
  humanApproval   not-required

acceptable: no
```

`unmeasured` is a value, not a missing one. A change whose only passing gate was a linter is
not a change anything ran: linting proves the source parses and establishes nothing about
whether any of it was executed. `semantic` abstains by construction, because judging whether a
change means what the task asked for is a judgement about meaning and nothing here is allowed
to make one.

`--json` gives the same thing as one line of JSON per event and one result at the end, each
naming its schema. Exit codes are a taxonomy rather than zero-or-not: acceptable, not
acceptable, invalid request, cancelled, unavailable, internal error.

## Running behind a boundary

`--isolation docker` runs every shell command, every gate command and every worker inside a
container with only the workspace mounted, a read-only image filesystem, no network, no
capabilities and bounded memory and process count. The default is the host, because turning
containment on is a decision somebody makes rather than one that happens to them.

The difference is the layer under the policy guard. `cat $(echo /host/secret)` names no path for
any reader to rule on, which is exactly the case the build guide lists as a residual: on the
host it reads the file, and behind the backend it does not.

A run that is interrupted leaves state you can act on: `swarm list-runs`, `swarm inspect`,
`swarm resume`, `swarm retry-step`, `swarm abort`, `swarm repair`. Intent is written before
every effect, so a crash between the two is visible rather than invisible, and idempotency is
keyed on the work rather than a clock, so resuming does not repeat an effect that already
committed.

## A session, or a single task

Run `swarm` with no task and it opens a session: one process, one ledger, and tasks typed one
after another, each continuing the conversation the last one left.

```
› create calculator.js exporting add and multiply, and calculator.test.js covering both
  8 gate(s) passed, 8 step(s)

› add a divide function that throws on division by zero, and cover both cases
```

Each turn is measured on its own. A turn ends by recording where it left the tree, so the next
one's gates see that turn's changes and not the ones before it. Three turns of this, with the
bundle verified from outside and the page it produced, are in
[`session.md`](docs/evidence/2026-08-24/session.md).

`swarm "task"` still runs one task and exits, exactly as before.

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
[`swarm.md`](docs/evidence/2026-08-24/swarm.md). The second one is the more useful: every
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
it has been happening, and, while the model is talking, the tail of what it is saying.

```
⠙ thinking, step 2  5s   I don't see calculator.js in the root directory
⠹ shell npm test  12s
```

One line, deliberately. The whole response lands in the action stream when it arrives and in the
ledger for ever, and repeating it as it streams would be the same text three times. A tool that
finishes inside a frame never draws one.

`?` lists every key. `enter` expands a row to its whole payload and the ledger record it came
from. `q` leaves the view: the screen comes down and the run keeps going, reporting the plain
lines it writes off a terminal. `ctrl+c` cancels the run. There is no progress bar, because an
agent run has no denominator.

When the run ends, the screen lists what it produced, says how many claims the harness
verified and how many it refused, and offers to open the review page. It says the bundle
verified only if the bundle's own verifier ran here and exited 0. `swarm review <bundle>`
shows the same panel for any bundle already on disk.

The keymap, the `swarm.toml` surface, the degradation matrix, and a recording of a session
are in [`interface.md`](docs/evidence/2026-08-23/interface.md), with the frames in
[`interface-frames.txt`](docs/evidence/2026-08-23/interface-frames.txt) and a playable
asciinema capture in [`interface.cast`](docs/evidence/2026-08-23/interface.cast).

## What is claimed

Every line here links to a committed artifact of the thing happening. The full table,
including what backs each one, is [`docs/claims.md`](docs/claims.md).

**A green verdict is computed by the harness, and the model cannot produce one.** In a real
run, the model asserted a predicate the language does not parse. The harness rendered it
`UNVERIFIED (predicate-unparseable)` and carried on, twice, until the model wrote one that
could be evaluated:
[shakedown results](docs/evidence/2026-08-18/shakedown/results.md).

**One changed byte breaks verification.** The same bundle, verified and then tampered with
in a single byte of one record, exit 0 and exit 1 side by side, with a script to reproduce
it: [tamper demo](docs/evidence/2026-08-18/tamper-demo).

**The bundle carries its own verifier, and it works on a machine that has never seen this
repo.** `node verify.mjs <bundle>` checks the manifest, the chain, the signature, every blob
against its content address, and recomputes every claim verdict. Run in a `node:24` container
with no network and no mount of this repository: exit 0 on the committed bundle, exit 1 on the
same bundle one byte later, with the image digest and both transcripts in
[`clean-container-verification.md`](docs/evidence/2026-08-23/clean-container-verification.md).
Transcripts from two earlier runs outside the repository:
[`live-tasks.md`](docs/evidence/2026-08-18/live-tasks.md). Beside the verifier, every bundle
now carries `rederive.mjs`, which recomputes every gate status from the recorded exit code and
output under the rule the record names, every ratchet decision from its recorded measures,
every bond verdict and every claim, and names what it cannot re-derive rather than agreeing
with it: [`gates-bonded/`](docs/evidence/2026-09-02/gates-bonded) is a run with nine gates
sealed, four bonds held, and all seventeen verdicts re-derived.

**A signature is checked against an identity from outside the bundle.** A bundle carries the
public key its own signature verifies against, so checking it against itself can only say
"unchanged since written". Anyone can edit a bundle, rehash it, sign it with a key of their own
and ship that key in the manifest. `swarm verify <bundle> --signer <fingerprint>` is the check
that catches it: named and matching is trusted, named and not matching is untrusted with both
fingerprints in the message, no signer named is untrusted rather than trusted, and an ephemeral
key is never trusted whatever the policy says because the run generated it for itself. Beside
the bundle signature every run now writes a DSSE envelope binding the patch, the spec digest,
the source commit, the chain head and the verdict under one signature, so a diff and a bundle
can be shown to be about each other.

**Bundles are signed from the OS keychain**, not from a key in the workspace. Both manifests
in [`live-tasks.md`](docs/evidence/2026-08-18/live-tasks.md) say `"keySource": "keychain"` and
both verifiers confirm it. Where the keychain holds no usable key the run signs with a per-run
key and says which of the three keychain failures happened, rather than signing quietly with
something else; the manifest then records `keySource: ephemeral`, which is what the bundles in
[`installed-package-run.md`](docs/evidence/2026-08-23/installed-package-run.md) carry.

**Local model choice is measured on your machine.** The probe output and recommendation from
real hardware: [`hardware-select.md`](docs/evidence/2026-08-18/hardware-select.md). A hundred
and eighty calibration runs across three models, distributions rather than averages, with the
pick ranked against the other two:
[`calibration-report.md`](docs/evidence/2026-08-23/calibration-report.md).

**Eight untrusted boundaries are fuzzed**, and the harnesses are checked against a defect
injected on purpose so a clean run cannot be a blind one: [`fuzz/`](fuzz/README.md) and
[`security-coverage.md`](docs/security-coverage.md).

**The screen renders from ledger projections, and a keystroke has no route to a verdict.**
Interactive state is a separate type with a separate reducer, and a test asserts across every
action that none of its fields can be mistaken for a gate result:
[`interface.md`](docs/evidence/2026-08-23/interface.md).

**A choice between competing attempts is made from measured numbers.** One task tried three
ways: three green attempts, coverage measured rather than abstained on, the third ranked last
on the dimension that saw it wrote one test fewer, and the top two identical on everything so
the tie broke on the earliest, which the report says in those words rather than inventing a
reason it did not have: [`swarm.md`](docs/evidence/2026-08-24/swarm.md).

**Adversarial passes, with each closure locked as a regression test.** Six pass directories
under [`redteam/`](redteam), 49 cases in `src/evidence/redteam-adversarial.test.ts`, and an
accounting record mapping each pass to what it actually was, because the driver ledger
records one completed lap and a directory is not a lap.

## What is not claimed

Kept short and kept honest, because the point of the rest of this file is that claims cost
something.

- **Not "fully secure".** The secret detector does known-pattern scrubbing, not secret
  removal, with a four-character floor. Zero crashes at a fuzz budget is evidence, not proof.
- **The default execution mode is `restricted`, not `isolated`.** A run gets a lexical path and
  program policy in front of interpreters unless you pass `--isolation`. That is reported before
  the run starts and recorded on the chain rather than quietly assumed, but it is not
  containment. The container backend has not been audited against a determined escape, and a
  container is not a virtual machine.
- **No benchmark numbers.** Nothing here is measured against another tool. The evaluation
  harness exists, is tested and is a command away, and it has not been run at scale: what
  would make it worth reading is five seeds across matched arms with frozen environments, and
  the frontier arms of that cost real money nobody has spent. The calibration results that do
  exist are self-run, on one machine, and labelled directional in the file itself.
- **A full clone is still heavy.** Blob payloads, 409 MB of the tracked tree, now live outside
  the repository with their digests committed beside them, and a shallow clone packs to about
  19 MB. A full clone still carries the history those blobs were committed into, and shrinking
  that means rewriting history, which is a worse trade than the download it saves.
- **Learned routing is not on by default**, and there is a bar under turning it on: held-out
  success non-inferior within five points judged by the whole interval, at least thirty tasks
  per arm, and cheaper or faster. Nothing has cleared it yet, so routing follows the
  calibration and the competency table.
- **Six known gaps ship open**, and none of them is claimed closed. They are in
  [build guide 7.1](docs/build-guide.md), which says for each what now catches it and what
  still gets past. Four of them have detections built against them and have not yet been
  attacked, so what is claimed is a detection and not a closure: a check nobody has tried to
  get past is a check nobody has measured. The other two came with the scale-out work and are
  unchanged, since a decomposition that is well formed can still be unrunnable and a
  comparator built from gate measures reads discipline rather than completeness.
- **A signature does not make the machine honest.** It proves the bundle was not altered
  after it left the machine that produced it. The review page says that on its face.

## How it works

- **Claims are predicates, not prose.** A claim names a record, a record kind, and a
  machine-checkable predicate. The harness recomputes the record's kind, evaluates the
  predicate, and decides. Model narrative always renders as unverified prose.
- **The ledger is append-only and hash-chained.** Each record carries the previous record's
  hash. A failed write aborts the run. Nothing is updated or deleted, ever.
- **Every tool call goes through one chokepoint** that records it, tags its provenance, and
  applies the policy guard. Credential paths are denied by default and each denial is itself
  recorded. The guard is a lexical path and program policy, not a sandbox: it reads a command
  into the programs it would run and the words that could name a file, and rules on those. That
  bounds which programs start and never what they do once started, because an allowlisted
  interpreter runs whatever a workspace script says.
- **What a run executed under is measured, not asserted.** Before the first tool call a
  containment self-test runs the escapes rather than reasoning about them: read a host file
  outside the workspace, write outside it, open a network connection. Whatever gets through is
  named in an `execution-envelope` ledger record and printed before the run starts. With no
  kernel-enforced backend in front of it, the honest answer is `restricted`, and that is what
  it says. `isolated` is reserved for a backend that refused every probe.
- **Child processes get a built environment, never an inherited one.** A path check cannot see
  `process.env.ANTHROPIC_API_KEY`, so the model's shell commands and the repository's own gate
  commands run under an allowlist: PATH, the locale names, TERM, a harness-owned HOME, and
  whatever the run authorized by name. Provider keys have no `swarm.toml` setting, and a file
  that names one is refused with rotation guidance.
- **Gates are data, and each declares what a pass establishes.** A gate declares a command, a
  parser, whether it blocks, and its capability: `static` reads the source, `dynamic` executes
  the code under change, `policy` rules on the change without doing either. "Did anything run
  over this change" is answered by a passing `dynamic` gate, which is why a lint-only pass no
  longer reads as one. The engine never special-cases a gate; the capability is read off its id.
- **A run's state outlives its process.** Which activities were dispatched and never came back,
  which files are held, what budget is spent, what a person approved: SQLite in WAL mode beside
  the ledger, with intent written before every effect. A hundred injected kills, three committed
  effects each, three hundred effects and no duplicates.
- **Killing a run kills what it started.** Every child leads a process group and the signal goes
  to the group. A wall budget, a Ctrl-C and a supervisor's SIGTERM all reach the same signal,
  and in a parallel run a worker starting late is handed what is left of the budget rather than
  a fresh one.
- **Evidence has a lifetime.** `swarm gc` says what it would remove and removes nothing until
  told. The store is created 0700 and 0600, and a directory made before that rule is narrowed
  rather than assumed.
- **A pass is bonded, and the criteria are sealed first.** Before the model is asked for
  anything, the gates it will be measured by, with their severities, the rule that reads each,
  the budgets and the attempt cap, are one record on the chain, and the verifier holds every
  gate run to it. After the fixed point, every gate that passed is handed one file it has to
  refuse: a test that throws, a TODO, a credential-shaped token, a file outside the declared
  set, a change over the budget. A check that refuses it held. A check that passes over a
  bond it demonstrably saw is vacuous, and a vacuous blocking gate makes the run not green.
  A pass nothing shows can fail is not a pass.
- **The ratchet is numeric.** Tests collected, assertions in touched test files, coverage of
  changed lines, skip markers. The two the runner reports, tests collected and coverage of
  changed lines, come from reports the runner wrote where the harness told it to, never from
  what a gate printed: a test file that prints its own counter line is the code under
  measurement authoring the measurement. Where the harness cannot vouch for the run that would
  write those reports it asks for none, and an unobtainable measure is reported as "not
  measured" rather than as a pass. Assertions and skip markers need no runner: the harness
  counts them out of the text of every test file the run touched.

The full design, including what it refuses to build and why, is in
[`docs/build-guide.md`](docs/build-guide.md).

## Limits

Gates prove mechanical quality. They do not prove design quality, and nothing here pretends
a passing run means the change is good. What the bundle buys you is that reviewing the
change is fast and that its claims are checkable, not that review is unnecessary.

The verdict says so in its own vocabulary: `semantic` is `unmeasured` on every run and always
will be, because whether a change means what was asked is a judgement about meaning, and this
tool makes none. `acceptable` means no blocking gate failed, no policy gate failed, and
something executed the change. It does not mean the change is right, and no number here could
tell doing the whole task from doing the minimum that passes its own tests.

## Upgrading from v12

v12 was a PR auditor that ran as a GitHub Action. v13 is a coding agent. Same package name,
different product, no migration path. If you are using v12, stay on it: it is tagged
`v12-final`. Details in [`CHANGELOG.md`](CHANGELOG.md).

## License

ISC. See [`LICENSE`](LICENSE).
