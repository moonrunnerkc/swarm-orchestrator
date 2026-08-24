# swarm-orchestrator

[![gates](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/gates.yml?branch=v13-main&style=flat-square&label=gates)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/gates.yml)
[![npm](https://img.shields.io/npm/v/swarm-orchestrator?style=flat-square&label=npm)](https://www.npmjs.com/package/swarm-orchestrator)
[![node](https://img.shields.io/badge/node-%3E%3D24-blue?style=flat-square)](package.json)
[![license](https://img.shields.io/github/license/moonrunnerkc/swarm-orchestrator?style=flat-square)](LICENSE)

A coding agent whose claims about its own work resolve to machine-captured evidence.

The model can say whatever it likes. It cannot make a gate pass, it cannot mark a claim
verified, and it cannot change a record after the fact. Those are the harness's to decide,
and the run exports a signed, hash-chained bundle that anybody can check without installing
this tool.

[What it does](#what-it-does) | [Install](#install) | [Use](#use) | [Watching it work](#watching-it-work) | [What is claimed](#what-is-claimed) | [What is not claimed](#what-is-not-claimed) | [How it works](#how-it-works) | [Limits](#limits) | [Upgrading from v12](#upgrading-from-v12)

## What it does

Give it a task and a git workspace. It plans, declares the files it intends to touch, edits
through a chokepoint that records every tool call, runs your gates, and retries failures
under a numeric ratchet that refuses a fix which trades away tests, assertions, or coverage.
Then it exports the evidence.

Here is a real run, committed: [`live-tasks.md`](docs/evidence/2026-08-18/live-tasks.md),
with its bundle in [`live-frontier/`](docs/evidence/2026-08-18/live-frontier). And here is the
packaged tool doing it, installed from a tarball into a directory holding nothing else, against
a workspace it had never seen, recorded in a real terminal:
[`installed-package-run.md`](docs/evidence/2026-08-23/installed-package-run.md).

## Install

    npm install -g swarm-orchestrator

That is **13.1.6**, and it leaves `swarm` on your path.

Installing from a tag works too, but only into a project rather than globally:

    npm install github:moonrunnerkc/swarm-orchestrator#v13.1.6

`dist/` is not committed, so a git ref builds itself on install and needs this package's
devDependencies to do it. npm does not install those when a git ref is installed with `-g`: it
carries the global context into its git-dependency preparation, places the clone as a root
package, and runs the build without the compiler. The published package needs no build, which
is why the line above it is the one to use.

Anything below 13 is a different program. This package name carried a pull-request auditor
through 12.x, and `npm install -g swarm-orchestrator@12` still installs it, so pin the major if
you depend on one or the other: [Upgrading from v12](#upgrading-from-v12).

Node 24 or newer. That is a runtime floor rather than a preference: the coverage cycle
spawns the test runner with `--test-isolation=process`, which Node 22 rejects as a bad
option, so on anything older that measurement does not happen.

## Use

    swarm "make slugify collapse whitespace and strip punctuation"

    swarm                            # a session: type tasks, one after another
    swarm gates                      # run the gates over a workspace, no model
    swarm select                     # probe this machine, recommend a local model
    swarm calibrate                  # measure candidate models on the golden set
    swarm routing                    # what the reward log adds up to
    swarm parallel --tasks <file>    # one worktree per task, then a merge queue
    swarm review <bundle>            # what a past run produced, and open it
    swarm replay <bundle>            # read a bundle back

    swarm --no-tui "..."             # plain lines even on a terminal
    swarm --no-color "..."           # no colour, whatever the terminal says
    swarm --open-evidence "..."      # open the review page when it finishes
    swarm --model local:<id> "..."   # a specific model
    swarm --workspace <dir> "..."    # a repository other than the current directory
    swarm --base <ref> "..."         # what the diff and the ratchet measure against
    swarm --attempts <n> "..."       # how many times the ratchet may retry a gate
    swarm --max-steps <n> "..."      # how long the loop may run before it stops
    swarm --local-endpoint <url>     # an OpenAI-compatible server other than the default

`swarm --help` prints all of it, including the calibration flags.

Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` for a frontier
model, or start Ollama or rapid-mlx and pass `--model local:<id>`. With no model named, the
router picks one from what the calibration measured on this machine, and `swarm routing` shows
what it has learned.

Settings live in one optional `swarm.toml`: providers and endpoints, gate definitions, budgets,
model pins, and the `[interface]`, `[theme]` and `[keys]` tables. Flags win over the file.

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
[`live-tasks.md`](docs/evidence/2026-08-18/live-tasks.md).

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

**Adversarial passes, with each closure locked as a regression test.** Six pass directories
under [`redteam/`](redteam), 49 cases in `src/evidence/redteam-adversarial.test.ts`, and an
accounting record mapping each pass to what it actually was, because the driver ledger
records one completed lap and a directory is not a lap.

## What is not claimed

Kept short and kept honest, because the point of the rest of this file is that claims cost
something.

- **Not "fully secure".** The secret detector does known-pattern scrubbing, not secret
  removal, with a four-character floor. Zero crashes at a fuzz budget is evidence, not proof.
- **No benchmark numbers.** Nothing here is measured against another tool. The calibration
  results are self-run, on one machine, and labelled directional in the file itself.
- **Four known gaps are open**, not closed, and they ship that way. They are in
  [build guide 7.1](docs/build-guide.md), and each is a permanent test case asserting the
  gap as it stands.
- **A signature does not make the machine honest.** It proves the bundle was not altered
  after it left the machine that produced it. The review page says that on its face.

## How it works

- **Claims are predicates, not prose.** A claim names a record, a record kind, and a
  machine-checkable predicate. The harness recomputes the record's kind, evaluates the
  predicate, and decides. Model narrative always renders as unverified prose.
- **The ledger is append-only and hash-chained.** Each record carries the previous record's
  hash. A failed write aborts the run. Nothing is updated or deleted, ever.
- **Every tool call goes through one chokepoint** that records it, tags its provenance, and
  enforces the sandbox. Credential paths are denied by default and each denial is itself
  recorded.
- **Gates are data.** A gate declares a command, a parser, and whether it blocks. The engine
  never special-cases one.
- **The ratchet is numeric.** Tests collected, assertions in touched test files, coverage of
  changed lines, skip markers. Coverage comes from a report the runner wrote where the
  harness told it to, never from what a gate printed, and an unobtainable measure is
  reported as "not measured" rather than as a pass.

The full design, including what it refuses to build and why, is in
[`docs/build-guide.md`](docs/build-guide.md).

## Limits

Gates prove mechanical quality. They do not prove design quality, and nothing here pretends
a passing run means the change is good. What the bundle buys you is that reviewing the
change is fast and that its claims are checkable, not that review is unnecessary.

## Upgrading from v12

v12 was a PR auditor that ran as a GitHub Action. v13 is a coding agent. Same package name,
different product, no migration path. If you are using v12, stay on it: it is tagged
`v12-final`. Details in [`CHANGELOG.md`](CHANGELOG.md).

## License

ISC. See [`LICENSE`](LICENSE).
