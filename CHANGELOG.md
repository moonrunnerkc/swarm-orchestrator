# Changelog

## Unreleased

### Added

- **`swarm ci` reports whether anything broke and whether the task was done, separately.**
  `regression` says the project's own suite still passes; `task` says a trusted oracle agrees the
  work was done, and reads `unjudged` where none was given. `verified` requires both, so a run
  with no oracle is unverified with the reason printed rather than verified by omission. This
  closed a real 22.2% false-green rate: a repository's suite tests the behaviour the project
  already had, and a task adds behaviour it did not, so a patch that adds a feature badly still
  passes it.
- **`--oracle <command>` supplies that task check.** Nothing infers one. It runs in the fresh
  checkout after the suite, whether or not the suite passed, so its verdict is readable either
  way.
- **`--install` installs the fresh checkout's dependencies from its lockfile**, with install
  scripts off. Off by default, because installing runs whatever the registry serves. Without it a
  real project has no test runner in a fresh clone, every check stands down, and the honest
  answer is that nothing was measured rather than that nothing passed. Reporting the second was a
  defect, and it is why this exists.
- **`--isolation <runtime[:image]>` runs commands behind a kernel-enforced boundary**, on docker,
  podman or nerdctl, with no network, a read-only root, a tmpfs, dropped capabilities, no new
  privileges, and memory and pid ceilings.
- **A run measures what it actually executes under, before the first tool call.** The containment
  self-test runs the escapes rather than reasoning about them: read a host file outside the
  workspace, write outside it, open a socket. Whatever gets through is named in an
  `execution-envelope` record and printed. With no kernel-enforced backend the answer is
  `restricted`, and that is the word used. A backend that refused every escape and could not
  reach its own workspace is `unknown` rather than `isolated`, since a command that sees nothing
  is contained and cannot work.
- **A bundle carries a DSSE envelope over an in-toto statement**, signed over the
  pre-authentication encoding rather than the payload bytes, so what a run produced can be checked
  by tooling that never heard of this project.
- **Durable run state, and the commands to work with it.** `swarm list-runs`, `swarm inspect
  <run-id>`, `swarm resume`, `swarm retry-step`, `swarm abort` and `swarm repair`, over a
  `node:sqlite` store in WAL mode with intent recorded before effect and an idempotency key per
  step, so an interrupted run is taken up rather than started again and a dead run's leases are
  released rather than held forever.
- **`swarm gc [--older-than 30d] [--remove]`** says what stored evidence would be removed before
  removing any of it.
- **`--json` on a run and on `swarm ci` and `swarm inspect`**: line-delimited JSON, one line per
  event and one result at the end, each naming its schema.
- **`confirm_timeout_minutes` under `[interface]`**, so a confirmation nobody answers is refused
  after thirty minutes rather than holding a run open indefinitely.
- **The false-green rate is measured against an oracle the tool is never given.** Each
  real-repository task carries two: one sealed before the runs and handed to the tool, one written
  from the task text and held back from it. 0 of 11, 95% CI [0.0, 25.9], counting the eleven
  patches the tool certified. `node scripts/second-oracle-pass.mjs` reproduces it from recorded
  diffs with no model calls. A single-oracle version of this number was published and withdrawn:
  the same test on both sides of a comparison agrees with itself.
- **`scripts/restore-bundle-blobs.mjs` puts offloaded artifacts back**, writing a file only where
  its content hashes to the digest the bundle names.

- **A run has a wall budget of its own.** `--max-wall-minutes <n>`, or `max_wall_minutes`
  under `[budgets]` in swarm.toml, bounds the whole run: the first loop and every auto-resolve
  attempt draw from it, the attempts stop when it is spent, and the run goes on to its final
  gates and its bundle with the budget recorded on the chain as a `session-budget` record.
  Before this each loop had its own half hour and the run as a whole had no bound, which is how
  a run measured inside a forty-five minute container could outlast it and leave nothing: the
  campaign's first arm lost seven runs that way. Unset, nothing changes: each loop keeps its
  half hour.
- **The criteria a run is measured by are sealed on the chain before the model is asked for
  anything.** Every gate with its severity and the rule that reads it, the budgets, the attempt
  cap and the ratchet arms, as one record written before the loop, and the embedded verifier
  holds every gate run to it: a gate the seal does not name, a severity or rule it did not
  declare, or a sealed gate missing from the final attempt fails verification. A bundle of the
  new format that carries gate runs and no seal is refused, since that is the one way to dodge
  the check; a bundle that ran no gates has nothing to be held to.
- **Every passing gate is bonded.** After the fixed point, each gate that passed is handed one
  added file it has to refuse, a failing test, a TODO, a credential-shaped token, a file outside
  the declared set, a change over the budget, and the result is a `gate-bond` record carrying
  the observation. A check that refused it held. A check that passed over a bond it demonstrably
  saw is vacuous, which makes a blocking gate's run not green whatever the cycle said, and the
  exit code says so. A command that passed where nothing shows it read the bond is unshown,
  named as such and never promoted to held. A gate with no bond is recorded as not bonded. The
  review page carries the bond beside every gate and paints a vacuous pass red.
- **A bundle carries `rederive.mjs` beside `verify.mjs`.** Where the verifier asks whether a
  bundle is what it says it is, the re-deriver asks whether a third party applying this tool's
  rules would reach the verdicts it records: every gate status from the recorded exit code and
  output under the rule the record now names, every ratchet decision from its recorded
  measures, every bond from its observation, every claim from its predicate, and the gate runs
  from the seal. What it cannot re-derive from the bundle alone, it names rather than agrees
  with. Dependency-free, like the verifier, and parity-tested against the parsers it mirrors.
- **Routing by a competency table, class by class, and never by interpolation.** `swarm
  calibrate` now writes, beside its pick, what each model was measured to do on each class of
  task: executed repeats and the ones whose gate passed, per sweep, read off the sweep's own
  `calibration-run` records and folded across sweeps of the same golden set. A task's router
  asks the table for its class before the reward log has enough samples to say anything, and
  where a candidate has at least six executed runs on that class the best gate share stands
  as the default, recorded as a `competency` assignment with the counts it was chosen on. Where
  no candidate clears the floor, or none has an entry for the class at all, the table abstains
  by name and the calibration pick stands as before; a model's showing on one class is never
  read as evidence about another.
- **A fifty-repository campaign harness, with its criteria sealed before anything was
  selected.** `campaign/criteria.md` was committed before the first GitHub query, the method in
  `campaign/methodology.md` before the first run, and `campaign/harness/` sequences the rest:
  the search saved raw, the candidate walk judged by rules that name the first one failed, one
  seeded defect per repository accepted only where the repository's own suite passes before and
  fails after, and one run per arm inside a pinned container on an internal network whose only
  other member is a forwarder to the model backend. Results are read off the bundle and the
  tree, never off the run's exit code.
- **The campaign was run: two local arms over fifty repositories, one hundred runs, ninety-three
  bundles that verify.** Fifty seeds in five languages, each a repository whose own suite passed
  before the seeded line and failed after it, run once per arm under a forty-five minute
  budget. On qwen3.8:27b over rapid-mlx, forty-three runs executed and every bundle verifies,
  twenty-six of them fixing the seed; seven ran out of budget without a bundle. On
  qwen3.6:35b-a3b over Ollama, all fifty executed and verify, thirty-nine fixing the seed, at a
  median of nine minutes against sixteen. The frontier arm was not run, because the key it
  needs has no balance, and the report carries it with zero runs rather than leaving it out.
  `campaign/results/report.md` is generated from the result records alone, the bundles are
  under `campaign/corpus/`, and the method with its dated amendments is in
  `campaign/methodology.md`. The campaign measured the CLI packed on 2026-09-02 and stayed on
  it while two defects it exposed were fixed in the tree: a shell allowlist that refused every
  toolchain but node's, and a model call with no deadline.
- **Two scheduled proofs on GitHub Actions.** A nightly one runs the suite and the fuzz smoke
  from a clean clone, then verifies the committed reference bundle with its own verifier and
  refuses a one-byte copy of it, uploading the transcript. A weekly one installs a pinned
  Ollama on the runner, seeds a workspace whose test fails on a real defect, runs one task
  through the built CLI, and verifies the fresh bundle in the same job; the task outcome is
  recorded and never judged. Neither continues on error, and a scheduled failure of either
  opens an issue with the run link.

- **A debug copy of what a local backend was actually sent and actually said.**
  `SWARM_TRANSPORT_TRACE=<path>` writes the raw request body and every raw response frame of
  every local call to a JSONL artifact, before anything parses them. Off with no path, which is
  the default: the artifact holds whole prompts and whole completions unscrubbed, so it is not
  the ledger and not a thing to leave running. It exists for one question the assembled response
  cannot answer, which is whether a turn that arrived empty was empty on the wire, dropped
  during stream assembly, or genuinely empty from the model. The response body is teed rather
  than buffered, so streaming timing is unchanged and the first-token measurement stays real.
- **A screen for `swarm calibrate`.** A three-model sweep is 180 runs over roughly three hours,
  the longest thing this tool does, and it wrote plain progress lines and nothing else. It has a
  view of its own now, because a sweep has none of the things the run screen is built around: it
  has a grid. Runs finished out of runs planned, the run in flight, a row per model in plan
  order with green counted over executed runs rather than attempted ones, abstentions named by
  the reason code the harness recorded, and the last few outcomes. No estimate of time
  remaining, which would be a prediction people plan around, and no keys, because a sweep has
  nothing to scroll. Off a terminal it writes one line per finished run in the same words, so
  the log and the screen stay one account of the run.
- **An index over the evidence column of the review page.** Records are grouped by turn and
  folded by default, the per-record digest moved into the expanded payload where the reviewer
  resolving a claim through it is already looking, and the column opens with how many records
  there are, how many of each type, a button per type and a search box. The 08-23 calibration
  bundle is 3,716 records; before this there was no way to find anything in it. A rendering
  change and nothing else: no record changed, and four existing bundles verify unaltered.
- **A behaviour probe over changed functions.** A function that answered several ways at the
  base commit and answers one way now is reported by a blocking gate. Reading the text will
  never tell a stub from a correct constant, and running it does not have to: the comparison is
  between two measured variances rather than a judgement about what a function is for. Quiet on
  a function that was always constant, one that takes no arguments, and one that now refuses
  every input, which is a tighter signature rather than a missing body.

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

### Changed

- **Bundle format 2.** A format 2 bundle carries the sealed criteria, a bond per passing gate,
  and the re-derivation script; every gate-run record names the rule that read it. Format 1
  bundles are still read, replayed and verified, and the four committed ones verify unchanged
  under the new verifier, which reports their lack of a seal as predating sealing rather than
  as a defect.
- **The corpus replay reads the v12 falsification corpus from the `v12-final` tag.** It named
  `main`, which held the v12 tree until `main` was moved onto this lineage; from then on the
  three replay tests skipped under a green run, on CI and on any clone that had moved its
  `main`. A tag is the one name that does not move, and the checkout test now pins that the
  corpus was reached rather than allowing a skip.
- **The reports the ratchet reads come off streams the harness owns, not files.** The first fix
  for the counter forgery below had the runner write reports to paths the harness named under
  the session store. An adversarial pass took that apart: a destination is an argument of the
  spawned process, so `ps -p $PPID -o command=` hands it to any test that asks, and the file is
  writable by anything running as the same user, since the writer is the same uid. Getting the
  harness to read a forgery did not work, because it reads as soon as the runner exits and won
  that race every time; what did work, four times out of four, was destroying both measures, and
  an abstention is not a violation. So there is no file: tap goes to stdout and lcov to stderr,
  and under process isolation a test's own output is captured by the parent and folded into the
  reporters' streams as escaped comments. The base-control result had the identical hole and
  gets the identical fix.
- **The base a run is measured against is resolved to a commit before anything reads it.** HEAD
  is a symbolic ref spent at the moment each base-side question is asked, and `git` is on the
  default shell allowlist, so one unconfirmed tool call moved it. Measured on a scratch
  repository with two of three tests deleted in the tree: after a `git commit -am` the base
  declared 1 test instead of 3 and the change set held 0 files instead of 1, so the deletion the
  ratchet exists to catch stopped being a deletion. The parallel path already resolved its base
  before handing it to any worker; this is the single-run path held to the same thing.
- **The ratchet's collected and skipped test counts come from a report the runner wrote, not
  from what it printed.** Node's default reporter passes a test's own `console.log("# tests
  999")` through ahead of its own counters and the counter reader took the first match, so four
  print statements in one test file reported 999 collected for a suite of one. That number fed a
  blocking arm. Where the harness can vouch for the invocation it now asks node for TAP at a
  path of its own and counts result points there, which a test cannot print into existence.
  Where it cannot vouch for the invocation both measures are null and the ratchet abstains on
  them by name, which is stricter than the reading it replaces.
- **An empty assistant turn is recorded as an abstention rather than as a run of the model.**
  The harness classifies every turn as it crosses into the ledger and stamps the verdict on the
  record, so a repeat whose only turn arrived empty reports `abstained` with a machine-readable
  reason instead of being scored against the model as a wrong answer. Two calibration bundles
  had been scored with those folded in. Calibration now reads `executed` off the records rather
  than off the loop's own counter, because a reviewer re-deriving that number has the records
  and not the loop.
- **A seed is recorded with whether the backend took it.** Ollama and rapid-mlx both accept a
  seed field and neither promises to sample from it, and the SDK reports a refused setting as a
  warning. Those warnings now reach the record, so a seed in a bundle is never read as a seed
  that made the run re-derivable.
- **The derivation heuristic reads a shell command as a command.** Its threshold is unchanged,
  because lowering it flags ordinary commands that mention a filename someone read. What changed
  is that where an argument parses as a shell command it is also compared as one, with flags
  dropped and interpreters folded together, so inserting `-fsSL` and swapping `sh` for `bash`
  no longer rewrites it past the match.
- **An assertion comparing a value with itself stops counting as an assertion.** The rule was a
  literal against the identical literal; it now substitutes the file's own bindings first, so
  `expect(v0.a).toBe(v0.a)` and the spelling that binds one side to a name are both seen. This
  is arithmetic over expressions and not a judgement about meaning: deciding that two
  *different* expressions mean the same thing is still refused.
- **The secret-scan gate reads a credential written in pieces.** Where a change rejoins them,
  by concatenation or by a template literal, the gate rebuilds the value those lines make and
  hands it to the detector that already decides about credentials, under the name the change
  gave it. No second detector and no new threshold. Halves that are never rejoined build no
  value and are still not caught, which build guide 7.1 says in those words.

### Fixed

- **Every evidence bundle verifies from a clone again.** An earlier weight reduction moved record
  payloads out of the tracked tree, which stopped 47 of 51 bundles passing their own verifier,
  four of them cited in the README and `claims.md` in words like "verify.mjs exit 0". Payloads are
  never offloaded now; only derived artifacts are, and those are regenerated from the records.
- **The README no longer cites a number the documents behind it withdrew**, and its gate tally is
  counted from the table rather than from memory.

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
- **The weekly scan stopped filing the same 21 findings every Monday.** Data is excluded by
  path, meaning the secret scrubber's own fuzz corpus and the captured shakedown logs and
  nothing else; the nine findings in real source carry a suppression naming the one rule and the
  reason, at the line that carries the finding. Under the workflow's own command it now reports
  zero and exits 0, so the weekly issue means something arrived that nobody has looked at.

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
