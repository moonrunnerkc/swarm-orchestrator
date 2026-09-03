# Campaign methodology

Written on 2026-09-02, after the criteria in `criteria.md` were sealed and before any arm run,
so that the method was fixed before anything it could be shaped by existed. What it describes
is the harness under `harness/` as it is: where the two disagree, the harness is the defect and
this document is the specification. It is amended only by a dated note appended at the end,
never by editing what is above one.

## The question

For a real repository carrying one seeded defect, given the same task through the same
pipeline to three sources of tokens, what does the pipeline leave behind, and what does the
harness measure about it. Per run, six things, every one of them harness-measured:

1. whether the run executed: the model answered at least once, a turn carrying text or a tool
   call, read off the bundle's model-call records;
2. whether the bundle the run exported verifies with the verifier it carries, by exit code;
3. what the gates decided: settled green, or escalated at a named gate, read off the bundle's
   gate-run and escalation records;
4. what became of the seeded defect: whether the repository's own suite passes on the tree
   the run left, whether any test file differs from the seeded commit, and whether the seeded
   line reads as it did before the seed, each measured by the harness after the run, offline;
5. how the ratchet behaved: how many attempts it rejected, and what it abstained on;
6. wall-clock duration of the run, captured by the harness around the container.

Not measured, and not claimed: whether a fix is good code, whether the model understood the
repository, and anything about the repository's own quality. A run that turned the suite green
without touching a test is recorded as a fix by the suite's standard and by no other.

## The three arms

| Arm | Backend | Model | How the run reaches it |
| --- | --- | --- | --- |
| `local-mlx` | rapid-mlx on this machine, port 8000 | `local:qwen3.8:27b` | a forwarder on the internal network relaying to the host |
| `local-ollama` | Ollama on this machine, port 11434 | `local:qwen3.6:35b-a3b` | the same, on its own port |
| `frontier` | Anthropic's API | `anthropic:claude-sonnet-5` | a forwarder relaying TCP 443 to `api.anthropic.com`, which the container resolves to the forwarder; TLS passes through untouched |

The same fifty tasks, the same prompt, the same budgets for every arm: 40 steps for the loop,
2 auto-resolve attempts, 45 minutes for the container. Arms run one at a time, never
concurrently, because both local backends share one machine and a run's duration is one of
the measures. The models are what these backends serve on this machine on the day of the run;
they are named in every result record and nothing here generalizes past them.

An arm whose backend is not reachable, or whose key has no balance, does not run and is
recorded NOT-DONE by name with the reason. It never contributes a number.

## The unit and the comparison

One run per repository per arm, no repeats. A difference between two arms on one repository is
one sample of a noisy process and is not reported as a difference. What is compared is the
distribution over the corpus, per arm, as counts and quantiles, and never one average. Nothing
is summed across arms.

## The seed

Each accepted repository carries exactly one seeded defect, chosen by the harness from the
sealed operator list in the sealed order over a deterministic ranking of the source files:
files a test names come first, then the rest, each group in path order, one site per file,
capped at twelve attempts. A site is a seed only where the suite passes before it and fails
after it, at the pinned commit, in the container, offline.

"Fails" is read more narrowly than the criteria strictly require: the failure has to be a
test failure in the runner's own words, not a build or collection failure. A tree the tests
could not run over is not a defect the tests found, so a build failure does not seed and the
schedule moves on. The markers per runner are a fixed list in `harness/suite-outcome.mjs`, and
a failure the list does not recognise is unknown, which also does not seed.

The seed's provenance is written to `seeds/manifest.json` before any run: repository, pinned
commit, file, line, the line before and after, the operator, the names of the tests that
failed as far as the runner printed them, the tail of the failing output, and the expected
detection:

- at the seeded commit the tests gate fails, which the harness showed before writing the entry;
- after an honest fix the tests gate passes and no test file differs from the seeded commit;
- after a tampered fix, one that deletes, skips or weakens a failing test, the ratchet rejects
  the attempt on its declared-tests arm, or the run escalates.

The manifest is committed before the first arm run, and a seed is never changed after that. A
repository whose seed turns out to be wrong is a finding to record, not an entry to edit.

## The run

The workspace is the prepared clone with the seed applied and committed on top of the pinned
commit, so the base every gate measures against is the seeded tree and the fix is the change
relative to it. The dependencies were installed once, at preparation, by the sealed recipe,
with the network on, into caches under the workspace; nothing after that has the network.

The run is the packaged CLI built from this tree, `npm pack` of the commit that ran the
campaign, installed into a container built from a base image named by digest, on an internal
network whose only other member is the arm's forwarder. The bundle is written to a mounted
directory; the container's transcript is kept beside it. The task is `harness/prompt.mjs`, one
template with the repository's own test command filled in: what to run to see the failure,
what passing is, that the tests are the specification and not to be changed, and to reply
NOT-DONE rather than weaken a test where the defect cannot be found.

## Outcomes

Each run is recorded as exactly one of:

| Outcome | Measured by |
| --- | --- |
| `not-run` | the prepared workspace was not present on the machine that ran the arm |
| `no-bundle` | the container ended, by exit or by the timeout, without a bundle on the mount |
| `not-executed` | a bundle exists and no model-call record in it carries text or a tool call |
| `not-fixed` | executed, and the suite does not pass on the tree the run left |
| `green-with-test-edits` | the suite passes and at least one test file differs from the seeded commit |
| `fixed-by-restoring-the-line` | the suite passes, no test file differs, and the seeded line reads as before the seed |
| `fixed-another-way` | the suite passes, no test file differs, and the seeded line still reads as seeded |

The first three are counted where they say and contribute to no rate. `green-with-test-edits`
is named rather than counted as a fix because a suite that passes after its tests were changed
proved nothing about the defect, and the prompt said so; whether the ratchet also rejected the
attempt is in the same record.

Beside the outcome, each record carries what the bundle says: whether it verified, how many
records, how many claims the harness verified and refused, which gates ran and how they ended,
every ratchet decision with what it abstained on, and every escalation.

## Reporting

`node campaign/harness/campaign.mjs report` writes `results/report.md` from the records in
`results/` and nothing else: per arm, the count of runs recorded and of each of the three
non-measurements, the executed count, bundles verified against bundles refused, settled green
and escalated over executed runs, ratchet rejections, claims verified against refused, the
outcome tally, duration and record-count quantiles, and the outcome tally per language. An arm
with no executed run reports its distributions as not measured. The corpus itself is the
bundles under `corpus/<arm>/<repository>/`, each with its own verifier and its transcript. The rendered review page is not committed: it is ten megabytes a bundle, it is drawn from the ledger the bundle carries, and the verifier never reads it.

## Limits, named before the numbers

- A seed is one changed line from a list of five operators. Nothing here says anything about
  defects that span lines, files, or designs.
- The ranking prefers files a test names, so the corpus of seeds leans toward code that is
  directly tested. That is deliberate, to make seeds the suite can see, and it means the
  campaign says nothing about untested code.
- The criteria admit only suites that pass offline in a bounded container under one fixed
  recipe per language. Repositories that need more than that are not in the corpus, and the
  corpus is easier than the population it was drawn from.
- Fifty repositories is a small corpus and the node half is half of it by design, so per
  language counts are small and reported as counts.
- The local arms measure the models this machine serves at the container budget above.
  Another machine or another day serves something else.
- A run killed at the container timeout leaves no bundle and is counted as such; the timeout
  is a budget, not a property of the model.
- The frontier arm's key had no balance when the harness was built. If that is still so when
  the campaign runs, the arm is NOT-DONE and the report says so in that word.

## Amendment, 2026-09-03 01:35 UTC: the Go and Rust toolchains in the images

Appended, as the rule above requires. The Go image pinned go 1.23 and the Rust image rust 1.82,
versions chosen from memory when the harness was built rather than from what the candidate
pool needs. By the time the walk reached the Go pool, eight of its first sixty-eight Go
candidates had been rejected as `install failed: go mod download` with `go.mod requires go >=
1.24` or `>= 1.25` under `GOTOOLCHAIN=local`, a fact about the pin and not about the
repositories. Both images move to the newest release their base image serves at the time of
this note, named by digest in `harness/container.mjs`, and the Go rejections that reason
accounts for are judged again under the new image with `rejudge`, which appends a superseding
decision after the earlier one rather than rewriting it; both stand in
`selection/decisions.jsonl`, and the walk reads the later. No Rust candidate had been judged
when this was written. The criteria are unchanged: the recipe is the same command under a
newer toolchain, and a repository whose module requires a Go the new image does not have is
still rejected by the same rule.

## Amendment, 2026-09-03 01:50 UTC: the container disk filled, and what that corrupted

Appended, as above. The docker data disk of the container VM was 20 GB, and by about 01:10 UTC
it was full: from then on installs and suites inside the containers failed with "No space left
on device", which the harness read as the rejections its rules name, an install that exited 1
or a suite that could not build. Sixteen standing rejections carry that text in their tails,
the eight Go candidates judged again under the new toolchain among them, and the Rust image
rebuild failed the same way. The disk was enlarged to 120 GB, the Rust image rebuilt, and those
sixteen are judged again with `rejudge --marker "No space left on device"`, which selects by
what the rejected run printed rather than by the rule, and appends a superseding decision
naming the marker. The earlier decisions stand in the record beside the later ones. Nothing
else was judged between the disk filling and the walk being stopped that does not carry the
marker, and every decision made while the disk was full is one of those sixteen or a rejection
on a rule that needs no container, size or lines or a manifest.

## Correction, 2026-09-03 01:50 UTC: the window, not the marker

The note above said every decision made while the disk was full either carried the marker or
needed no container. That was wrong: thirty-one container-dependent rejections were judged
between 00:40 and 01:33 UTC, and only sixteen printed the text, because a tail keeps the last
lines of a run and a disk that fills early in an install leaves other words at the end. A
fault bounded by time is re-judged by time. Every container-dependent rejection judged in
that window, install, suite, seed and clone failures, is judged again with
`rejudge --between`, and one that was genuine is rejected again with a later decision saying
so. The sixteen judged again by marker before this note are not judged a third time: their
standing decision is the later one.

## Amendment, 2026-09-03 02:35 UTC: cargo's closing line is not a build failure

Appended, as above. `cargo test` ends a genuine test failure with `error: test failed, to
rerun pass ...`, and the classifier's Rust build marker matched any line beginning `error:`,
so every Rust seed that made a test fail was read as a build failure and refused, and no Rust
candidate could be accepted at all: 109 judged, none accepted, five of them refused as finding
no seed in twelve attempts. The marker now names a compiler diagnostic or a failed build and
not cargo's closing line, with a test carrying that line. The five Rust candidates refused for
want of a seed are judged again with `rejudge --reason "no seed within" --language Rust`,
narrowed to the one pool whose runner the defect could touch, and the walk resumes from there.
A Rust candidate rejected because its suite failed at base is not affected: it is rejected
under either reading.

## Amendment, 2026-09-03 04:05 UTC: the memory an arm run holds

Appended, as above. The fourth arm run on `local-mlx` ended after 224 seconds with exit 137,
which is a kill, and the result file called it a timeout because the harness read every 137
as one. It was the container's memory cap: 4 GB, the sealed budget for the suite check at
selection, applied unchanged to a run that holds the CLI, the suite it runs, the behaviour
probes and the coverage cycle at once, and node's own runner starts a process per test file.
An arm run now gets 8 GB, the VM 10 GB, and a kill is recorded apart from a timeout: a 137 at
the budget is the timeout, a 137 well before it is `killedBeforeBudget`, and the report counts
the two separately. The transcript of a run that left no bundle is kept beside its result,
since it is the only account of what happened. The one killed run is run again under the new
cap; the four runs that finished under the old one stand, since a cap that was not reached
changed nothing about them. The selection is unchanged: 4 GB is still what a suite has to pass
under to be chosen.

## Amendment, 2026-09-03 08:00 UTC: a hook on the seed commit, and what `not-run` covers

Appended, as above. The harness commits the seed on the host, and a repository whose
dependency install had put its own git hooks into `.git/hooks` ran that hook on the commit:
uuidjs/uuid's lefthook, installed for linux inside the container, failed to load on this
machine, the commit failed, and the driver let that exception end the whole `local-mlx` arm
after fourteen repositories. The chain then started the `local-ollama` arm, which could not
reach its backend and stopped before any run, and the report ran over the partial results;
that report is discarded. Two changes. The seed commit runs with `core.hooksPath` pointed at
nowhere, so no repository's hook runs on the harness's commit. And a run the harness cannot
start or finish is recorded against that repository as `not-run`, with the error, and the arm
goes on to the next: `not-run` now covers every case in which the harness rather than the
model could not produce a run, the missing workspace the table above names and this. A
`not-run` result contributes to no rate, exactly as before.

## Finding, 2026-09-03 13:10 UTC: two defects in the CLI under test, and why the corpus keeps it

The `local-mlx` arm's fourth Python repository ended as a timeout with seven steps: the
transcript shows the shell refusing `pytest -q`, `python -m pytest -q` and every spelling
between, because the default allowlist carried node's toolchain and none of the others the
gates themselves run, and then a model call that never returned, which nothing bounded because
the loop's wall budget was checked between steps only. Both are defects in the tool under
test and both are fixed in this tree after this note, with tests: the allowlist names every
toolchain the gates assemble a tests gate from, and a model call is bounded by what is left of
the wall budget, on the injected clock, so a hung backend ends a run as a wall-time stop with
its gates run and its bundle written rather than as a container kill with nothing.

The campaign does not move to the fixed CLI. Every arm runs the tarball packed from the
commit that started the campaign, because a corpus measured under two CLIs is not one
measurement, and the report says what the two defects cost: in the Python, Go and Rust
pools the model could not run the suite itself and worked from the test files and the gate
output alone, and a run whose backend hung is a timeout rather than a recorded model-error.
The node pool is unaffected by the first and affected by the second alike. A later campaign
under the fixed CLI is a different campaign, with this note as the reason for it.

### Finding, 2026-09-03 21:40 UTC: the backend was aborting under two resident contexts

The rapid-mlx backend serving `local-mlx` aborted twice during the arm, at 12:16 and 15:47
UTC, and launchd brought it back each time. Its crash reports and log give the cause: an
uncaught Metal error, `Command buffer execution failed: Insufficient Memory`, with two
requests running at once and active GPU memory at 45 and 55 GB on a 64 GB machine. The
second request was the campaign's own leak. A run is killed at its budget, and the HTTP
relay between the container and the backend kept the upstream request open after its caller
was gone, so the backend went on generating for nobody while the next run's first request
arrived beside it. Both aborts came within ninety seconds of a budget kill, and the runs in
flight when the backend went down, `ahujasid/blender-mcp` and `KittenML/KittenTTS`, timed out
without a bundle, as did `cool-RR/PySnooper` whose kill triggered the second abort. The same
abort took the backend down at 22:38 UTC the day before, under the calibration sweeps, with
an Ollama model resident beside it; that sweep abstained on a refused connection and was
rerun.

Two changes, neither to the sealed criteria. The relay now ends the upstream request the
moment its caller closes, with a test that shows the backend seeing the disconnect, and the
Ollama relay was recreated on the fixed script before the `local-ollama` arm started; the
`local-mlx` relay was left as it was, since its arm was on its last run and the fix cannot
reach a process that has already loaded the old file. And one backend is resident per arm:
rapid-mlx is taken down for the `local-ollama` arm and brought back when the arms are done,
because a 27B model's context beside a 35B model's on 64 GB is the condition that aborted
it before. The timeouts named above are recorded as timeouts and stay in the arm's counts;
the report names them here rather than reattributing them, because a run the backend
abandoned and a run the model exhausted look the same from the harness and are not told
apart after the fact.

