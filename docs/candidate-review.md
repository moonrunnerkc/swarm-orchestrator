# Preservation obligations, known violations, retained tests and the candidate review

Four parts. The first three apply to every run. The fourth is experimental and off by default.

## Obligations (every run)

Before the first model call, a run records what it must produce and what it must keep
(`preservation-obligations-v2`). Each obligation is tied to its source and kept in one of four
categories:

| Category | Source | What it is | What settles it |
| --- | --- | --- | --- |
| requested | the supplied contract | a requirement for new or changed behaviour (any requirement without `"intent": "preserve"`) | its checks: `met` or `unmet`. A met requirement is new behaviour, never preserved behaviour |
| requested | the task's own code | an example the task writes as code (`f("a") is "b"`), a relation between two calls (`f(input, x) equals g(input, {})`), or a callback's stated calls (`cb is called once for each key of g(input)`), `task-code-v2` | the review's run of that code on the delivered candidate: `met`, `unmet`, or for a relation `exercised` at the inputs run |
| explicit preserve | the task, the supplied contract | the task's sentences about behaviour to keep ("behaves as today", "must keep passing", "must remain available", ...), an example the task writes with "stays" or "still returns", and a requirement marked `"intent": "preserve"` | a supplied requirement's own check (`held`); a kept example by its own call (`held`); a task sentence only through review probes that name it, and then only `exercised` |
| observed | the base | the project's own checks that pass on the base still pass | the final verification's regression reading, which leaves out failures the base had (`held`, naming any that remain) |
| proposed | the review | probes a reviewer chose once a candidate existed (experimental, below) | the probe's own cases, `exercised` at most |

**Statuses.**
- `held` is said only where a check measured the obligation as it is stated.
- `exercised` means examples of it ran and each kept the base's answer. That is a sample, and it
  does not establish a broad statement such as "all public exports remain available".
- `regressed` means something that measured the obligation failed.
- `unmeasured` means nothing decided it.

**What each status records.** Every status carries the measurement behind it:
- the check or probe case that ran, with its input;
- the base's answer and the candidate's answer;
- the reading.

The settled record also names the delivered patch by its digest, the same tree the final
verification applied.

**Extraction and its limit.** Every task sentence is kept, with no count limit.
- **Keep wording becomes an obligation.** That includes modal forms such as "must remain" and
  "should continue to".
- **Any other sentence is retained as unclassified task text** (`unclassifiedTask` in the
  result).
- **What it can miss.** Extraction reads wording. A sentence that asks for behaviour to be kept
  in other words is listed, not read as an obligation, and nothing measures it.
- **The precise route** is a supplied requirement with `"intent": "preserve"` and a check of its
  own.

The run prints one line that keeps the two apart. For example:
`preservation: 1 held, 1 exercised by examples only, 0 regressed, 2 unmeasured, of 4 obligation(s) ...; requested behaviour (new, not preserved): 1 met, 0 unmet, 0 unjudged`.

What the base does is what currently happens, not by itself what should happen. A behaviour the
task authorizes changing is not held to the base. The set examined is finite, so a run that keeps
every obligation has not shown backward compatibility in general.

## Known violations decide completion (every run)

A run declares `known-violation-completion-v1` before its first model call, and is assessed under
`run-acceptance-v7`.
- **A validated counterexample** is a case of the harness's own run of the task's code (below),
  under a supported reading, that gave the same answer on two runs of the delivered candidate and
  is not the task's expectation.
- **It refuses the run** while it stays open on the delivered candidate, with the case named in
  the verdict's reason.
- **It stays visible to repair.** It is checked on every later candidate within the run's attempt
  and time limits.
- **What never refuses:** a reviewer's probe, a model-written test, a relation over a domain the
  reader could not follow, and a case that did not run twice the same way.
- **Re-derived independently.** The bundle's `verify.mjs` reads the delivered reading from the
  ratchet decisions, each held case from its two candidate runs' recorded output, and a
  relation's expectation from the reference's run on the base. Records under v1 to v6 keep their
  meaning.

## Retained tests (every run)

A test a worker writes and then deletes or changes keeps the question it asked
(`test-retention-v1`).
- **What is kept.** Every version of a test file a worker's write or shell step leaves, whether or
  not any gate cycle saw it. A failure that ran through a pipe, which records exit 0, is kept the
  same way.
- **When it runs again.** At the first gate cycle and on every kept candidate whose tests pass:
  each named test the worker has since deleted or changed, as it last stood, appended to its file,
  through the tests gate's own command for that file. The file is put back byte for byte.
- **The reading.**
  - `passes`: the candidate meets it.
  - `open`: a deleted test that fails. It is owed an attempt once the gates are green, and stops
    at the repeated-failure rule.
  - `corrected`: a changed test whose earlier version fails where the current one passes. The
    record keeps both versions.
  - `unmeasured`: the tests did not pass, or the command could not run the file.
- **It decides nothing.** A retained test is a model's expectation, and can be wrong. Its link to
  the task is only which of the task's stated functions it calls. Deleting it again does not
  answer it; passing does.

## Candidate review (experimental: `--review grounded|executable|prose`)

The harness's own checks of the task's code, and optionally a separate conversation that did not
write the change, review the actual candidate (`candidate-review-v4`). It needs `--goal-contract`
or `--plan-checks`, because its probes run on fresh checkouts the way the sealed checks do.

**Three modes.**
- `grounded`: only the harness's run of the task's code. No conversation, no tokens.
- `executable`: the same, then a reviewer asked only about the task sentences no harness check
  reaches (the stated gaps). It is not asked where there are none.
- `prose`: the control, with a reviewer's objections in words and nothing run.

**When it runs.** Once the candidate *runs*. Something that executes the code must have run the
change, and every blocking failure must be a static check (lint, format, typecheck, a build) or a
gate whose own named checks all passed. A lint finding does not withhold the review: the review's
findings and the lint failure travel in the same attempt. The review is withheld, on the record,
where:
- a test or a policy check fails;
- a blocking command stood down;
- what is left cannot pay for the review, its probes, an attempt and the cycle that measures it.

**What the reviewer is shown and may do.**
- **Shown:** the task, the candidate's diff, the run's obligations with their ids, and what the
  checks reported.
- **May:** read, list and search the workspace, and try a probe up to four times with
  `try_probe`. That tool runs the program on a copy of the candidate, so a probe never changes
  what it reviews, and it reports whether the program loaded and what each input gave.
- **May not:** edit anything or run commands.
- **Never sees:** the implementer's account, a hidden evaluator, a reference patch or a scored
  verdict.

**How a probe loads the project** (`project-loader-v1`). Before the reviewer is asked, the harness
tries, on a copy of the base, the ways the project can be loaded, in this order:
- the entry the task names, then the files the change edits, then the manifest's entry points
  and the usual source entries;
- a TypeScript loader the project has installed (jiti, tsx), then Node's own.

It keeps the first that loads and exposes exports. The reviewer is given those loading lines and
the exports. Every probe the harness builds starts with them. Where none loads, every attempt is
recorded with its error, and what the probes would have measured is unmeasured.

**The task's own code** (`task-code-v2`). The harness reads examples and relations the task
writes as code, with no model involved, and runs them itself on both trees:
- `f(args) is literal` (also returns, gives, equals): a requested example. Its expectation is the
  task's literal.
- `f(args) stays literal` (also still returns), or one in a sentence saying what must not change:
  a kept example. The base must give the literal first. Where it does not, the case is
  `provisional`.
- `today f(args) returns literal`: today's behaviour, which the task is often asking to change. It
  is not held of the candidate.
- `f(input, ...) equals g(input, ...)`, with a domain such as "for every input that contains
  "?"": a relation. `g` runs on the unchanged base, so the expectation is the existing
  function's, outside the candidate's reach. The inputs are the task's own literals in that
  position. Where the domain is "contains S", literals without S are carried into it. The
  reviewer may add inputs. A domain the reader cannot apply leaves every difference
  provisional.
- `cb is called once for each key of g(input)`, where the task declares a function taking both
  (`f(input: string, cb: (key, value) => boolean)`): the callback's stated calls. The candidate's
  calls of `cb` are compared with the entries of `g(input)` on the unchanged base, in order where
  the sentence says so, and with the values where it names them. Of the 28 comparison tasks and
  the held-out texts, only the ufo feature task states one.
- A call over bare names (`keep(key, value) returns true`) describes a signature, and is not read
  as an example. A function the candidate does not export answers as such, as an observation.

**Generated inputs** (`domain-inputs-v1`). Inside a relation's followed domain, inputs are made
from the task's own literals by one operation each (splice, move, drop, repeat or blank a
segment, or insert another literal's), kept only where they are new, inside the domain and of a
new shape. The seed is the statement's own sentence, digested, and is recorded with how each input
was made.
- A **discovery batch** of six runs beside the task's inputs.
- A **validation batch** of twelve, from a separate seed, excludes both and is held back. It runs
  first on a repaired candidate. Once that candidate is kept its cases are exposed, held like the
  others, and a counterexample among them may enter a later attempt, whose brief says so.

**What it answers** (executable mode): up to four probes, each a plain JavaScript module that
calls the project, with up to six inputs.
- **Preservation probe.** It names the obligation it exercises (by id, or by quoting its words) and
  chooses inputs whose behaviour the task does not change. The harness takes the expected answer
  from the unchanged base.
- **Requirement probe.** It quotes the task and gives the answer it reads there. That stays the
  reviewer's reading.
- **Relation probe.** It states requested behaviour the task describes in terms of existing
  functions, such as a callback called once per key of an existing function's result, in order.
  It needs:
  - a quote of the task;
  - a `reference` program that calls only functions the quoted words name, as
    `project.<name>`.

  The reference runs on the unchanged base. A difference counts only where the relation held on
  at least one of the inputs, which shows the two programs answer in the same terms.

**Admission runs.** Every probe the reviewer submits runs once, by the harness, on a copy of the
tree it is read on, whether or not the reviewer tried it. Each run is read as one of four things:
- a load failure;
- a probe failure: it threw in its own code, printed to stdout, or did not finish;
- a project exception, which is an answer;
- an observation.

A probe that does not run goes back to the reviewer once with its error, together with any probe
refused for its form and the reason it was refused. A corrected probe is taken under whatever id
it comes back with, up to the limit. Still broken, it is left out as `unmeasured`, never read as
nothing found. A `try_probe` trial is reused only where the
program, inputs, tree, candidate patch and environment all match.

**What the harness does.** Every probe runs twice on a fresh checkout of the base and twice on one
of the candidate, through the planned-check runner, and each case is qualified:

| Reading | Meaning | Acted on |
| --- | --- | --- |
| `kept` | the candidate answers as the base does | held by the ratchet where an obligation the task states covers it |
| `preservation-regression` | the base answered, an obligation the task states covers the input, and the candidate answers otherwise (or, on a candidate whose checks all run, no longer loads what the base loaded) | **established** |
| `requested-unmet` | a requested example of the task's own code, and the candidate gives other than its literal | **established** |
| `relation-violated` | a relation the task writes as code, or a reviewer's relation that held on some input, and the candidate's subject gives other than the reference gives on the base | **established** |
| `met` / `related` (task code and relations) | the candidate gives the expectation | held by the ratchet |
| `relation-unconfirmed`, `provisional` | a difference whose reading nothing confirms | reported only |
| `difference` | the candidate differs from the base, and no stated obligation covers it: the task may have asked for it | reported only |
| `base-raised` | the base raised where the candidate answers: what the base lacked, often the requested feature | reported only |
| `met` / `missed-requirement` | the candidate gives, or does not give, the reviewer's expected answer | reported only; the expectation is the reviewer's |
| `unstable`, `defective-program`, `did-not-load`, `did-not-complete` | nothing was established: a broken or unavailable probe. A load error names its message | reported only |

**What follows from a finding.** An attempt from the run's existing attempt cap, under the
ratchet. Another is owed while established cases stay open and the last attempt fixed one of them
or a newly exposed case appeared. Where the same cases stay open after an attempt given them, the
repeated-failure stop is recorded and nothing more is owed. Open review cases and open retained
tests travel in one attempt. The brief gives, for each case:
- the obligation and its words;
- the input;
- the expectation (the base's observed answer, the task's literal, or the reference's answer on
  the base) and the candidate's answer;
- the probe's program;
- the digest of the candidate it was read on.

The attempt is told to leave the code where the task asks for the change, and to say which
sentence asks for it. Every probe then runs again on each later candidate. Every held case is its
own ratchet part, so a repair that breaks a held case the incumbent kept, or a requested case it
met, is rolled back, even where it fixes another case of the same probe.

**What decides and what does not.** A validated counterexample of the task's own code refuses
completion (above). Nothing a reviewer's probe reads decides acceptance, changes a sealed gate or
enters the final verification. A model's expectation is never acted on.

**Prose mode** is the control. It runs the same conversation and the same attempt, with objections
in words and nothing run.

**Cost.** The reviewer takes at most:
- ten steps;
- a quarter of the remaining tokens;
- 30% of the remaining wall, capped at four minutes.

The probes cost two fresh checkouts. Every token is charged to the run's own allowance, and the
verification reserve is untouched.

## Limits

- **Not a trained test agent.** The reviewer is the same untrained local model with a different
  prompt. In ExecCritic ([arXiv 2609.09133](https://arxiv.org/abs/2609.09133)) the untrained
  Qwen 35B test agent's tests lowered the resolve rate.
- **Only code-shaped task text is read without a model.** Prose requirements reach a measurement
  only through a reviewer's relation probe, and only where an existing function the task names
  can serve as the expectation. A relation's inputs are the task's literals, eighteen generated
  ones and the reviewer's: a sample of the domain, not the domain.
- **A reviewer's finding still decides nothing.** Only the harness's run of the task's code
  refuses a run, and only through a counterexample that stays open.
- **Coverage of a statement is the reviewer's reading.** Whether a probe's input is one the named
  obligation covers is the reviewer's reading. Naming a stated obligation is what lets a
  difference count, but the harness cannot check that the input falls within it.
- **Narrow reach.** Probes call the project through its module exports with JSON inputs and
  results. Behaviour that needs a process, a file system fixture or a browser is out of reach.
- **Shared dependencies.** `try_probe` copies the candidate's files but links its installed
  dependencies, so a program that writes through `node_modules` reaches the workspace's own.
- **Rewritten test expectations.** An authorized change that rewrites an existing test's
  expectation is left `unverified` by the final verification's base-tests reading, review or not.

## Evidence

The deterministic controls are in `src/cli-review.integration.test.ts` and
`src/cli-retained-tests.integration.test.ts`. Each drives the ordinary
command line on a scripted model, through the real gates, ratchet and final verification, and then
the bundle's own `verify.mjs` and `rederive.mjs`. A scripted model shows what the controller does
with a given answer, not what a real model would answer.

The controls:
- a correct change;
- a counterexample repaired;
- a review despite the base's own lint;
- a review despite a lint finding of the change's own;
- an authorized change a probe calls a regression (no attempt spent);
- a wrong expectation (never acted on);
- broken probes;
- a weakened test;
- the prose control;
- more than twelve obligations kept visible;
- the grounded path: a counterexample found with no reviewer, a repair that fixes some cases and
  is owed another attempt, a repair that meets every case it was shown and fails the held-back
  batch, and a known violation left in place refusing the run;
- retained tests: a failure deleted before the first gate cycle and then repaired, the same
  deletion left unresolved, and a wrong test the worker corrected.

The two development false accusations of October 23 are unit cases in `src/agent-review.test.ts`:
- a base that raised for want of the requested rule;
- an expectation all three trees contradict.

Live results:
- [October 23](evidence/2026-10-23-preservation-review/README.md);
- [October 24](evidence/2026-10-24-delivery-preservation/README.md);
- [October 24, detection and repair](evidence/2026-10-24-detection-repair/README.md);
- [October 24, retained counterexamples](evidence/2026-10-24-retained-counterexamples/README.md).
