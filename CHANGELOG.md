# Changelog

## Unreleased

### Added

- **A screen for `swarm calibrate`.** A three-model sweep is 180 runs over roughly three hours,
  the longest thing this tool does, and it had none: the 08-23 sweep was watched through
  `tail -f`. It is a second view rather than a second use of the run screen, because a sweep
  has no plan and no gate strip and does have a denominator. One row per model with what it was
  asked to run, what it answered, what it solved, and the reason code for anything that
  measured nothing. No keys; a sweep is watched rather than steered. Off a terminal it is
  silent and the piped output is byte for byte what it was.
- **A raw wire trace for local backends, behind `SWARM_LOCAL_TRANSPORT_TRACE`.** Two
  calibration bundles came back holding assistant turns with nothing in them, and the three
  things that produce that cannot be told apart once the bytes are gone: the backend emitted no
  content, the client lost it assembling the stream, or the chat template answered into a
  channel the assembly does not read. The trace writes the raw request and response bodies
  before anything parses either, copying the response through as it arrives rather than
  buffering it, and both go through the ledger's own scrub. Off unless a path is named.
  `docs/empty-turn-diagnosis.md` says how to read one, and records that the root cause is not
  diagnosed: it needs the live backends.
- **An advisory `constant-return` gate.** It runs the base version and the submitted version of
  a changed module over one fixed ladder of inputs and reports a function that varied with its
  input before the change and does not after. That separates a stub from a function whose
  correct implementation is a constant without knowing what either is for. Advisory and staying
  advisory: a function can legitimately become constant, and what a measured loss of variance
  means is a person's to read.
- **The evidence column of the review page is indexed.** How many records, how many groups, one
  line per turn with its task and count, one line per record kind with a link to the first. A
  record is collapsed to its head line rather than a fully expanded card, and its digest moved
  inside. Rendering only: nothing about what is recorded moved, and a bundle written before
  this still verifies.

- **Workers that read what the others have already tried.** They ran side by side and saw
  nothing of each other, so two could declare the same file and one could spend its whole
  attempt cap on a gate that had already refused the same fix on the chain next door. They
  coordinate now through the thing they were already writing: a `read_trail` tool projects
  typed signals off the peers' ledgers, which files are claimed, which gates failed and how
  often, which attempts the ratchet rejected, which approaches are spent. No daemon, no bus,
  nothing anyone writes through, and no read of a chain but the peers' own. Nothing it returns
  can render green: every signal comes from a record rather than from model text, every line
  names the peer it is about, and no signal kind reports a success. A run that is not parallel
  is offered none of it and sends the same tools and the same prompt, byte for byte.
- **`--redundancy <n>`: try each task several ways and land the best of them.** Attempts
  diverge because each carries a seed derived from the task, the model and the attempt number,
  so a report can re-derive them. The winner is chosen by a comparator over harness-measured
  numbers with the precedence written down, never by asking a model which answer it likes: four
  earn-it dimensions above every do-less one, a dimension nothing measured abstained on by
  name, and a dimension only one side measured won by the side that measured it. Counting
  happens over a file universe fixed across the attempts first, so opening a large test file
  gains the opener nothing. The whole ranking goes on the chain, losers and their reasons
  included. A refused winner falls to the next attempt only where the integrated gates were
  what refused it.
- **`--goal <text>`: the tool breaks the goal into tasks itself.** A planner run reads the
  workspace with read-only tools and declares a task graph, which is checked before anything
  runs for unique ids, resolving dependencies, no cycle, and files that two unordered nodes
  do not share. The graph is a ledger record written before the first worker starts. Nodes
  land layer by layer, each layer branching from the tree the one before it left, and a node
  whose parent did not land is recorded as blocked rather than run against a tree that lacks
  it. `--tasks` also reads a JSON graph now, so a hand-written one and a declared one are the
  same artifact. The claim says every declared node ran and landed and says nothing about
  whether they satisfy the goal, which this tool does not check and says so.
- **`--concurrency <n>`,** capping how many workers hold a worktree at once. It defaults to
  one against a local model server, because every worker in the run is asking one resident
  model for tokens, so the parallelism buys nothing and costs the memory the model lives in.
  Against a model served elsewhere it defaults to four and deliberately does not grow with the
  hardware: what the machine is being asked for is N copies of the project's test suite, and a
  bigger machine does not make those cheaper. The fan-out was unbounded before this, at any
  redundancy.

### Fixed

- **An empty assistant turn can no longer be recorded as an executed run.** The harness reads
  every turn at the record that carries it into the ledger and writes what it read beside it:
  characters of text after trimming, tool calls, whether that amounts to nothing, and which
  nothing it was. A calibration repeat takes "the model answered" off those records rather than
  off a counter the loop kept in memory, so what makes a repeat executed is what a reviewer
  holding the bundle can recount, and a repeat with no answered turn carries an abstention
  naming its reason. A record with no harness reading counts as unread and never as answered.
- **The ratchet no longer compares a number the code under measurement can write.** The count
  of tests a run collected came from a parser reading a gate's stdout, and two of the three
  readers take the first match in that text, so a test printing `Tests  9999 passed (9999)`
  supplied the reader its summary line before the runner's own existed. A raised count is what
  hides a deletion in a file the test-file recognizer does not recognize. It now comes from a
  result the runner wrote to a path the harness named, exactly as coverage does, and abstains
  by name wherever the harness cannot vouch for the invocation. `docs/ratchet-inputs.md` is the
  inventory of all eleven inputs, each cited to where it originates and each with its
  resolution.
- **A seed is recorded only where the backend carries one.** Anthropic and Google drop the
  field rather than reject it, so a seed written to the ledger for those was a number that
  re-derives a repeat nothing can replay.
- **Two of the judge-shaped residuals are narrowed, and neither is closed.** A comparison that
  reduces to itself once the assignments above it are substituted no longer counts as an
  assertion, and a credential a `+` chain reassembles is caught however its pieces are named.
  Both come from one analysis, and inertness is what keeps a memoization test counting. A
  command copied out of content the model read is now also matched after canonicalizing it, so
  inserting flags and swapping `sh` for `bash` stops working; the overlap threshold is
  untouched. What remains open is written into the tests beside each.

- **A parallel run now sweeps up the branches it created.** Worker branches outlive their
  worktrees on purpose, because the merge queue merges from them after the working copy is
  gone, and nothing outlived the queue: a repository gained a branch per worker per run, for
  ever. The integration branch is never swept, since that is the result. It prunes worktrees
  first, which is what stops a run killed part-way from making the next one fail on a path git
  still believes in.
- **`--goal` says how the planner stopped, not just that it declared nothing.** Running out of
  steps, answering in prose, and returning nothing at all want three different responses, and
  the message treated them as one. It now names the stop reason and the step count and says
  what to try for each.
- **Two review-page summaries that trailed off after the colon.** `worker-finished` and
  `merge-attempt` both asked for a field neither writer emits, so they rendered as
  `worker-1 finished:` with nothing after it. They read what is actually recorded now.

## 13.1.9

### Added

- **A line that says the run is alive, and what it is doing.** A spinner that turns, the current
  activity, how long it has been going, and while the model is talking, the tail of what it is
  saying. Nothing on the screen moved before this: the status said `thinking (step 3)` and
  stayed there, and the only thing that changed was a seconds counter the layout hides below 80
  columns or 12 rows, so a run taking a minute looked exactly like one that had hung.
- **The model's words as they arrive.** The stream was already being drained to time the first
  token and every piece of text was discarded. It is handed on now. One line of it: the whole
  response lands in the action stream when it arrives and in the ledger for ever, and repeating
  it as it streams would be the same text three times.
- **The tool that is running, named while it runs.** Between a tool starting and finishing
  nothing was emitted, which for a shell command is a screen sitting still for a minute and a
  half. A tool that finishes inside a frame still draws nothing, which is the right amount.

## 13.1.8

### Added

- **`swarm doctor`, and `swarm doctor --fix`.** What owns the `swarm` command, and repairing it
  when the answer is wrong. The same failure has happened on two machines months apart and
  presented as something else both times: an `ENOTDIR` during a global install on one, and on
  the other a `swarm` with no `select` command. Both were a development checkout linked into the
  global prefix with `npm link`, which owns the command until it is removed and which npm cannot
  install over. Nothing here can intercept that at install time, because npm fails before any
  script of ours would run, so this answers the question afterwards instead. It reports the link
  and what it shadows, every `swarm` on PATH since the first one wins silently, an executable
  whose package a failed install removed, and whether the registry is ahead of what is running.

### Fixed

- **A bare word that is nearly a subcommand is refused.** A bare word is the task, which is what
  makes `swarm fix the parser` work. The cost is that a subcommand a build does not have becomes
  a task: running `swarm doctor` against a version predating it started an agent on the
  repository, declared its uncommitted files and wrote a bundle. Nothing was damaged and nothing
  about it looked wrong. One word that is nearly a command is now refused with the nearest match
  named, and a task of more than one word is untouched.

## 13.1.7

Found by driving the session through a real terminal rather than a pipe.

### Fixed

- **Enter did not submit at the prompt.** A terminal hands over what it buffered in one read, so
  the newline arrived inside a longer chunk with no key flag set, and the whole chunk including
  the control character was typed into the task being composed. A pasted task arrives the same
  way, so everything before the newline is now typed and the newline still means run it.
- **The screen still showed a plain `DONE` for a run that changed nothing.** The gate strip
  cannot tell passes over work from passes over an empty diff, and a model answering in prose
  stops for the honest reason `completed` having done nothing. It now reads `DONE, but no files
  changed`. The plain path already said this above its gate table.

## 13.1.6

A session, and the evidence a person reads.

### Added

- **`swarm` with no task opens a session.** One process, one ledger, tasks typed one after
  another, each continuing the conversation the last one left. The screen keeps what each
  finished turn came to, so it does not forget between them. `swarm "task"` is unchanged.
- **Each turn is measured on its own.** A turn ends by recording where it left the tree, so the
  next turn's gates see that turn's changes and not the ones before it. Without it the second
  turn is charged with the first's diff and the file-set check calls the first turn's files
  out-of-set.
- **The review page says what happened.** The header carries the tasks, the model, whether the
  loop completed, how long it took and what it cost, above the identifiers it used to open with.
- **The gate table is in the bundle.** It was printed to a terminal and never written into the
  page, where the gates had been indistinguishable cards among the model calls.
- **The change itself is recorded and shown.** Nothing recorded a patch, so the question the
  page exists to answer, what did this do to my code, meant leaving the evidence and running git.

### Fixed

- **A run that changed nothing reported `DONE`.** The gates run after the loop and each gate
  event rewrote the status, so the last gate to pass over an empty diff became the last word on
  a run that built nothing. The stop reason is now its own field, and a cycle that measured no
  changed files says so before the table.
- **A second turn measured its own edits as deletions.** `git diff <base>` from the person's
  index calls a file that is in the base and untracked here deleted. Changes are now measured
  through a scratch index, which makes the comparison tree to tree and counts a file the agent
  just wrote as added.
- **`q` did not leave the view.** It set a flag that three things read after the fact; nothing
  unmounted the screen, which kept painting. It now comes down and the run reports the way it
  does off a terminal.
- **A refused bundle named nothing.** The failing check was read off stderr and the verifier
  reports through stdout, so every real refusal said "no detail given" at the one moment the
  panel exists for.
- Six record types rendered as their own bare name on the page, including the one holding what
  the run cost.

## 13.1.5

Three fixes, all found by running the tool rather than by reading it.

### Fixed

- **A routed model the backend does not serve reached dispatch.** The router picks from what a
  calibration measured, and a calibration is a record of a machine at a moment; the backend
  answering today is a separate fact, and the two drift. A model pulled into Ollama, discovery
  preferring rapid-mlx, and the router handed over a name that endpoint had never heard of. It
  answered `Not Found` three times and the run stopped at zero steps. The served list is now
  asked before dispatch, and a served local model, then a frontier provider whose key is set,
  answers instead. Substitutions are announced and recorded.
- **A run that built nothing reported `DONE`.** The gates run after the loop and every gate
  event rewrote the status line, so the last gate to pass became the last word on the run. A
  loop that stopped at step zero displayed `DONE gate diff-budget: passed` in the success
  colour, over an empty diff. The stop reason is now its own field and the outcome leads with it.
- **`git diff` outside a repository printed its whole option list.** One line of diagnosis
  followed by a hundred lines about `--dirstat`, with the sentence saying what to do at the
  bottom. Now one line, and it says to run `git init`.

## 13.1.4

### Fixed

- **The readme printed an install command that cannot work.** It offered
  `npm install -g github:owner/repo#tag` beside the registry line. `dist/` is not committed, so a
  git ref builds itself on install and needs this package's devDependencies to do it, and npm
  does not install those under `-g`: it carries the global context into its git-dependency
  preparation, places the clone as a root package rather than building a tree inside it, and runs
  `prepare` without the compiler. The same ref installed without `-g` works and always did. Found
  by a person running the line the readme printed.
- **That failure surfaced as `ENOENT` on a path the reader never typed.** The build now names the
  cause and the two commands that do work, rather than reporting a missing file.

## 13.1.3

The first 13.x on the npm registry. No behaviour changed: this is 13.1.1 with a manifest the
registry accepts and install instructions that are true.

### Fixed

- **The manifest named no repository, so a signed publish was refused.** `npm publish
  --provenance` signs a statement naming the repository the tarball was built from, and the
  registry checks it against `repository.url` before it accepts the write. That field was
  absent, so the statement said one thing and the manifest said `""`, and the registry answered
  `E422` after the provenance had already been written to the transparency log. Nothing in the
  source tree can show this, so a test now asserts the field.
- **The package told its own readers it was not published.** The install section named a git ref
  and said the registry served 12.0.0, because that is what was true while the credential was
  missing. Those words ship inside the tarball, so publishing 13.1.1 as it stood would have put
  a package on the registry whose first section denies being there. `npm install -g
  swarm-orchestrator` is the first line again.

### Added

- A description, keywords, a homepage and a bug-tracker link, which is what the registry page
  renders around the readme and what a search on the registry matches against.
- Three flags the readme never listed, `--base`, `--max-steps` and `--local-endpoint`, and a
  pointer to `swarm --help` for the calibration flags it still does not list.

`13.1.2` was tagged and refused by the registry for the manifest reason above. The tag is left
where it is rather than moved, because it names a real tree and the refusal is part of the
record.

## 13.1.1

A packaging fix. Nothing about how the tool runs changed.

### Fixed

- **Installing from a git ref produced a package with no binary.** `dist/` is not committed and
  is built by a script, and npm runs `prepare` for a git install but never `prepublishOnly`.
  Only the latter was declared, so `npm install github:moonrunnerkc/swarm-orchestrator#v13.1.0`
  resolved, reported no error, and left a directory with no `dist/` and no `swarm`. This is the
  install path that matters while the registry publish is blocked, and it was the one that did
  not work.

## 13.1.0

A run you can watch and drive, and an end-of-run panel that shows you what it produced.
Everything below is additive: no flag, command or output changed meaning, and the plain-line
stream a pipe or a CI job reads is byte-for-byte what it was.

### Added

- **An interactive terminal interface.** On a TTY, a run draws a single screen: the task and
  the model in a header, the plan, the action stream, the gate strip, and a status line.
  Scroll it, expand a row to the whole tool input and output and the ledger record it came
  from, filter it, freeze the render without touching the run, and press `?` for the keymap.
  Two exits that are not the same thing: `q` leaves the view and lets the run finish, `ctrl+c`
  cancels the run.
- **An end-of-run evidence panel.** What the run produced, named by what each artifact is for,
  with the record count and how many claims the harness verified against how many it refused.
  One keystroke opens the review page, another the bundle directory. It says the bundle
  verified only if the bundle's own verifier ran in that session and exited 0, and it names the
  exit code; otherwise it says "not verified in this run" and prints the command.
- **`swarm review <bundle directory>`**, which shows that same panel for any bundle already on
  disk, running the same verifier. Nothing is re-run.
- **`swarm --help`**, which used to report that `--help` needs a value.
- **Screen flags**: `--no-tui` for plain lines even on a terminal, `--color` and `--no-color`,
  `--open-evidence` and `--no-open-evidence`. Opening is opt-in and never happens off a
  terminal.
- **Three `swarm.toml` tables**: `[interface]` (`tui`, `color`, `open_evidence`), `[theme]`
  (a colour per slot), and `[keys]` (a key per action). Flags win over the file, as everything
  else does. An unknown key, colour or action is a typed error naming what was wrong and what
  would have been accepted.
- **Sampling settings on the wire for a calibration run**: temperature and top-p pinned and
  recorded in every model-call record, with a seed per repeat. An ordinary task run sends
  nothing and is unchanged.

### Fixed

- **Two consumers of one stdin.** The CLI built a readline interface on `process.stdin` while
  Ink held the same stdin in raw mode. A confirmation firing mid-run raced them, which is the
  least acceptable place to drop a keystroke. Confirmation is now a component inside the
  running screen, answered by the same key dispatcher.
- **The curated model shortlist and pricing table answered 404.** Both URLs named the branch
  `main`, which is the v12 lineage and carries neither file, so `swarm select` fell back to the
  bundled snapshot on every machine.
- **A missing verifier read as a refused bundle.** Node exits 1 on a module it cannot find,
  which at the exit code is the same as a verifier that ran and said no. One is the absence of
  a verdict.
- **Local models reported no tokens, and so cost nothing.** An OpenAI-compatible server streams
  a usage chunk only when the request carries `stream_options.include_usage`, and the local
  provider was not built to send it. Every local run recorded `outputTokens: 0`, so throughput
  was unmeasurable and every run priced at `$0.0000`, which the routing reward is built from.
  The router had been learning that local models are free.
- **One keychain message for three different failures.** A key that could not be read, an entry
  holding something that is not a key, and a keychain that would not accept a new one now say
  which happened and what to do about it. The middle one names the service and the account, and
  says the entry can be deleted.

## 13.0.0

Same package name, different product. If you installed `swarm-orchestrator` before this
release, read this before upgrading: v13 is not a newer v12, and nothing in v12's interface
survives.

### What v12 was, and what v13 is

v12 was a PR auditor. It ran as a GitHub Action, read pull requests opened by AI coding
agents, looked for cheat patterns (test relaxation, mock-of-hallucination, assertion strip,
no-op fix), posted findings as a comment, and gated merges.

v13 is a coding agent. It does the work rather than auditing somebody else's, and every
claim it makes about that work resolves to machine-captured evidence in a tamper-evident
ledger. The two share a name and nothing else: no shared history, no shared interface, no
migration path from one to the other, because there is nothing to migrate.

### Breaking

- **The `swarm-audit` and `swarm-orchestrator` binaries are gone.** One binary now, `swarm`.
- **The GitHub Action is retired.** v13 ships no `action.yml`. There is no v13 equivalent of
  the merge gate, and none is planned.
- **Node 24 or newer.** v12 asked for 20. The floor is not stylistic: the coverage cycle
  spawns the test runner with `--test-isolation=process`, which Node 22 rejects as a bad
  option, so on anything older that arm measures nothing.
- **The histories share no merge base.** v13 is a separate lineage. `git log` will not show
  you v12's commits from here.

### If you are using v12

Stay on it. It is tagged `v12-final` and that tag is not going away.

    npm install swarm-orchestrator@12.0.0

That is the newest v12 the registry carries. The `v12-final` tag is at 12.1.1, which was
tagged but never published, so `@12.1.1` does not resolve; install from the tag if you need
exactly that tree.

For the Action, pin the tag rather than a branch, since the default branch is moving to the
v13 lineage:

    uses: moonrunnerkc/swarm-orchestrator@v12-final

### What v13 does

One task, start to finish, in a git workspace: plan, edit through a chokepoint that records
every tool call, run the gates, auto-resolve failures under a numeric ratchet, and export a
signed evidence bundle a stranger can verify without installing anything.

The parts worth knowing before you try it:

- Gate results, claim verdicts and bundle status are computed by the harness. Model prose
  renders as unverified narrative and cannot render green.
- The ledger is append-only and hash-chained, signed with a key from the OS keychain.
- The bundle carries its own verifier. `node verify.mjs <bundle>` needs Node and nothing
  else.
- Local model selection is measured on your hardware rather than guessed from model cards.

`README.md` links each of those to a committed artifact of it happening. `docs/claims.md`
maps every claim to its evidence, and lists what this tree cannot back.
