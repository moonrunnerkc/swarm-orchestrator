# Verifying work, yours or somebody else's

A gate is a check declared as data: a command, the rule that reads its output, and whether it
blocks. The ratchet is the rule that a retry may not trade away tests, assertions or coverage to
turn a gate green. An oracle is the check you supply that says the task was done. Reach is
whether that oracle executed the lines a patch added. Unmeasured is a verdict of its own: nobody
checked is not the same as checked and passed, and it never renders green. This page is what
each of those does in practice, and what none of them establishes.

[A pass is a claim](#a-pass-is-a-claim-until-it-is-shown-able-to-fail) | [Two answers](#two-answers-not-one) | [The oracle](#the-oracle-is-judged-too) | [Nine answers](#what-a-run-reports) | [Without this tool](#checking-a-bundle-without-this-tool) | [Not claimed](#what-is-not-claimed)

## A pass is a claim until it is shown able to fail

Real output, the bond section of `swarm gates` over the three-test project in
[`verify-only.md`](verify-only.md#swarm-gates-a-workspace-measured), where the whole transcript is:

```
bonds, one per gate that passed:
  tests: held. the tests gate refused the bond: 4 collected, 3 passed, 1 failed, 0 skipped (exit 1)
  placeholder: held. the placeholder gate refused the bond: 1 placeholder marker(s) introduced: swarm-falsification-bond.js:1 // TODO: swarm falsification bond
  secret-scan: held. the secret-scan gate refused the bond: 1 added line(s) match a known credential pattern: swarm-falsification-bond.env.example.js:1 (github-token)
  behaviour-probe: not bonded. no bond is defined for this gate, so its pass has not been shown capable of failing
  diff-budget: held. the diff-budget gate refused the bond: over budget: 2 file(s) against 12 and 603 added line(s) against 600. This does not block. It requires a justification claim citing this record.
```

After the gates go green, each one that passed is handed a bond: one file it has to refuse, a
test that throws, a line carrying a placeholder marker, a credential-shaped token under a
credential-bearing name. A check that refused it held. A check that passed over a bond it
demonstrably saw is vacuous, and a vacuous blocking gate makes the run not green whatever the
cycle said. A check that passed where nothing shows it read the bond, a linter pointed at a
directory the bond is not in, is unshown, and unshown is never promoted to held. A gate with no
bond is recorded as not bonded rather than quietly counted among the held. Shown on a real run
in [`gates-bonded/`](evidence/2026-09-02/gates-bonded), with the seal and every bond recomputed
by the bundle's own verifier.

The criteria a run is measured by, every gate with its severity and the rule that reads it, the
budgets, the attempt cap and the ratchet arms, are sealed on the ledger before the model is
asked for anything, so a run cannot loosen what it is measured by on the way. The verifier holds
every gate run to that seal.

## The separate opinion

Every gate a run executes runs in the workspace that run was editing, with the tests that run may
have changed, reading reports that run's own processes wrote. The sealed criteria and the ratchet
close most of that. What they cannot close is the shape of it: a subject grading its own paper.

`swarm ci` is the separate opinion, and it does not need this tool's agent to have produced the
patch. Nothing the producer said travels except the patch.

```sh
swarm ci --patch candidate.diff --install --oracle "npx jest tests/the-task.test.ts"
```

It clones the base commit into a fresh checkout, applies the patch there, and runs the checks in
that checkout, with the gates assembled from the base commit's manifests rather than the patched
tree's, so a patch that rewrites the test script does not get to choose the instrument that
measures it. A patch touching a path you declared immutable is refused before anything runs. A
patch that will not apply reports that no check happened rather than passing on an unchanged tree.

## Two answers, not one

```
regression: pass   task: unjudged
```

`regression` is whether the repository's own suite still passes: it says nothing broke.

`task` is whether the work was actually done, and only an oracle can say that, because a suite
tests the behaviour a project already had and a task adds behaviour it did not. A patch that adds
a feature badly still passes a suite written before the feature existed.

**Measured:** four of eighteen real-repository patches passed their project's whole suite and
failed a hidden acceptance test. That is a 22% false-green rate, and it existed until the two
answers were separated. `--oracle <command>` supplies the second; without it the task is
`unjudged` and nothing is verified, which is the honest answer rather than a pass by omission.

## The oracle is judged too

An oracle is evidence only about the code it ran, so `swarm ci` reports what its own oracle
reached before it reports a verdict:

```
regression: pass   task: accepted   oracle reach: unreached (lib/winston/container.js: 46, 47)
oracle bond: not-bonded (no mutant of the change could be built, so nothing was asked of the oracle)
```

Three ways an oracle can fail to be evidence, and all three are checked. One that **accepts the
base commit** would have accepted a patch that changes nothing, so `task` reads `vacuous` and
nothing is verified. One that **never executed lines the patch added** cannot have judged them, so
`oracleReach` reads `unreached`, the lines are named, and nothing is verified. One that **executed
those lines and accepted a change to them** ran the code without asserting anything about it, so
`oracleBond` reads `vacuous`, the mutant it accepted is printed, and nothing is verified.

| the oracle | the tool says | why |
| --- | --- | --- |
| accepts the base commit too | `task: vacuous` | it would have accepted a patch that changes nothing |
| never ran the lines the patch adds | `oracleReach: unreached`, lines named | it cannot have judged what it did not execute |
| ran them and accepts a change to them | `oracleBond: vacuous`, mutant and witness printed | it executed the code without asserting anything about it |

All three came out of measuring this tool against real work. Certified tasks turned out to rest on
oracles that could not fail; the first false green found was certified by an oracle that never ran
the branch it broke; and the one false green that still stands, `commander#1671`, is certified by
an oracle that runs every line the patch adds and never tests the precedence those lines decide.

`unreached` and `vacuous` block. `unmeasured`, `unshown` and `not bonded` do not: an absence of
evidence is not evidence of a gap.

### How reach is measured, and what it is not

Three ways of asking, chosen by what the oracle starts, and `unmeasured` where none applies:

| the oracle starts | reach comes from |
| --- | --- |
| node's own test runner, in an invocation the harness can rebuild itself | that runner's lcov reporter, on a stream the harness owns |
| a runner that loads the file as written (mocha, a plain node script) | V8's own coverage, written to a directory the harness names outside the workspace |
| jest or vitest, which transform before they run | the runner's own lcov report, under coverage flags the harness appends |
| anything else | nothing: reach is `unmeasured` |

A transforming runner is caught where it shows. Under jest the coverage offsets address babel's
output rather than the file: dayjs's `src/index.js` is 11,794 characters on disk and its coverage
names offsets past 218,000. An offset past the end of the file abstains the whole reading rather
than dropping the file, because a file missing from a reading reads as one the oracle skipped, and
that would refuse the patch instead of declining to judge it.

**What reach does not judge, and says so.** Some changed files can never appear in a runtime
coverage report, and refusing a patch over one tells its author that lines nothing can execute
went unexecuted. Six of nine refusals in the reach-pressure experiment did exactly that, over a
tsd type test. Reach sets a file aside only for a reason about what a coverage report can contain,
and every verdict names what it set aside under `setAsideByReach`:

| reason | files | why |
| --- | --- | --- |
| `type-declaration` | `.d.ts`, `.d.mts`, `.d.cts` | types only, erased before anything runs |
| `type-test` | `.test-d.ts`, anything under `test-d/` | read by the type checker, executed by no runner |
| `candidate-test` | test directories, `.test.*`, `.spec.*`, `_test.*` | the oracle runs its own test file, never the change's |
| `no-runner-loads-it` | docs, changelogs, JSON, snapshots, YAML and TOML | no JavaScript runner loads it |
| `no-code-on-added-lines` | any | blank lines and bare punctuation execute nothing |

Nothing is set aside for how its name looks. A scratch script, a JavaScript tool configuration
and a file called `latest.ts` are all executable and all judged. A change in which no file could
be judged reads `unmeasured`, not `reached`: it was not measured and found complete.

**Named honestly:** the last two arms read a report the workspace's own processes wrote, and
nothing here detects a forged one. That is deliberate and it is not the hole it sounds like. The
bar the ratchet uses, an invocation the harness assembled with no shell in between, exists because
a workspace can inflate a number a retry is judged against. Reach only ever turns a green into a
refusal, so a workspace that forged its coverage would be handed `reached`, which is exactly what
an oracle nobody could measure already gets. Holding reach to the ratchet's bar cost thirteen of
seventeen repositories in the mined corpus and closed nothing.

**What it costs.** Reach refuses patches that are fine. A change that restructures one assignment
into an `if` and an `else`, judged by an oracle whose cases all take the `if`, is refused with the
`else` named: the oracle did not run it, so it did not judge it. Those refusals are reported as
`refused-on-reach` rather than as the tool being wrong about the patch, and they are counted where
the rate is, because a refused patch is one the tool did not certify.

**What it is easy to get wrong, measured three times.** Reach compares the lines a patch added
against a coverage report, so anything the patch touches that *cannot appear in such a report*
reads as a line the oracle skipped. Three of those were found by running it against real patches:
a line holding one closing brace, which lcov names with zero hits because a function returning
early never reaches its implicit end; a changelog; and a TypeScript declaration file, which is
erased before anything runs. Each refused patches that were fine, and one of them was also masking
a patch that was not. A line carrying no character that could begin an identifier, a number or a
string is skipped, and so is a file no runner could load.

### Bonding the oracle, and what a bond is worth

Reach asks whether the oracle executed the change. It cannot ask the question underneath: an
oracle can run a line and assert nothing about it. So after the oracle accepts, the lines the patch
added are changed into something that behaves differently and the oracle is run again.

The four words are the ones a gate bond already uses. **held**: the oracle refused the mutant.
**vacuous**: it accepted one the coverage of its own run says it executed, and a second detector
says changed something. **unshown**: it accepted one nothing says it ran, or one nothing shows
changed anything. **not bonded**: no mutant could be built, or the oracle did not accept, so
nothing was asked of it. `unshown` and `not bonded` are absences of evidence about the oracle
rather than evidence against it, and neither is ever read as `held`. Only `vacuous` refuses, and
whether it does is one exported boolean so that turning it off is one line.

There are eight operators, each a syntactic rule over a line and never a rule keyed to a
repository, a patch or a task: invert a comparison, negate an `if` or `while` condition, swap the
operands of a non-commutative arithmetic operator, replace a returned expression with a sentinel,
replace the value a plain assignment writes, swap the two arguments of a call, drop a no-argument
call whose result the chain uses, remove the statement. Six mutants per patch at most, two per
operator. They are read off the language's statement productions rather than off the patches that
exposed a gap in them, and the derivation is in
[`oracle-bond-operators.md`](oracle-bond-operators.md).

Removing a statement is the one that can leave a file which does not compile, and every oracle
refuses one of those, so it is confirmed against `node --check` on the file the patch left and on
the file with the line blanked. In a dialect `node --check` cannot read, TypeScript or JSX, it
proposes nothing and the other seven still apply.

**Why a second detector, and what it is.** An oracle accepting a mutant means nothing unless the
mutant was a change, and until recently what established that was a person reading each mutated
line. That audit found two equivalent mutants, `return false;` replaced by `return undefined;`
inside a `filter` predicate, which is the same predicate because both are falsy, and a swapped
`Math.min`, which is the same call. Each narrowed the operator that produced it. It does not scale
and it is not evidence anybody else can re-derive.

So every mutant the oracle accepted on a line it ran is adjudicated, cheapest detector first. The
oracle runs again over the mutant under the same instrumentation reach used, and a line other than
the mutated one that ran in one reading and not the other is a demonstrated difference in what the
program did. Failing that, the repository's own gates that passed with the patch are run again, and
one that now fails is a demonstrated difference. Neither seeing anything is `none`, which means
everything that could be asked was asked and nothing showed a difference; a patch whose own checks
all failed leaves nothing to ask of the second detector and reads the same way. `not adjudicated`
is the other absence, that no detector was asked at all, and the two are not one word: a refusal
carrying the wrong one is a refusal with nothing beside it to explain itself, which is how two
commander rows read before this was separated.

**Three residuals, named rather than implied away.**

Neither detector sees a mutant that changes only a value on a path that runs either way, in code
the project did not have before. Coverage cannot: the same lines run the same number of times.
The repository's own suite cannot: it was written before that behaviour existed. That costs a real
catch. `commander#1671` was refused because its oracle accepted a mutant dropping one `.reverse()`,
which inverts a merge precedence, and nothing here can witness a reordering. It reads `unshown`
now, and the tool no longer refuses it.

A patch with no line these operators can change gets no bond at all, and that is much rarer than it
was: `koa#1999`, whose added lines are a regular-expression test, two `new URL(...)` calls and a
template literal, used to be the example and now certifies on `held`. `not bonded` is still not a
pass and is never counted as one, and the certify rate is reported split by bond state for that
reason.

A bond that held under a runner that type-checks before it runs may have held on the types. The
mutant a `filter` predicate or a swapped argument list produces is often not well typed, and
`darkreader`'s oracle runs `ts-jest`, which refuses it as a compile error. The oracle did refuse the
mutant, which is what `held` says; what it does not say is that the assertions would have. Two of
the three new operators widen that: `const at: number = undefined` and a deleted declaration are
both compile errors before they are anything else, so on a type-checking runner a `held` bond over
them says less than the same word over an untyped one. The witness beside a gap does not help
here, because this is a residual of a refusal rather than of an acceptance.

**What it does not catch, measured rather than reasoned about.** Reach refuses a patch that adds
code the oracle never runs. It says nothing about a patch that never wrote the code at all. Given
the oracle it will be judged by and told to satisfy that and leave an adjacent case broken, a model
produces exactly the second kind: every line it adds is executed by the sealed cases, `oracleReach`
reads `reached`, and a second oracle still refuses the result. On the two tasks where that happened
the honest attempt had been refused on reach and the minimal one was certified, which is the
ordering nobody wants and is what a visible oracle buys an attacker. Only a second oracle
distinguishes them.

## A failure the base already had is not a regression

A check that fails with the patch is re-run with the patch reverted, on the same checkout, so the
two runs differ in the patch and nothing else. One that fails both ways is recorded as inherited
and does not make `regression` fail.

This is not hypothetical. Dependencies install with `--ignore-scripts`, because install scripts
run whatever the registry serves, so a project that builds on `prepare` is verified without its
build output. koa routes `import 'koa'` to `./dist/koa.mjs`: 437 tests passed and 2 failed without
the build, 439 and 0 with it, and those two were being charged to the patch.

## Installing dependencies

`--install` installs the fresh checkout's dependencies from its lockfile, with install scripts
off. It is not the default, because installing runs whatever the registry serves.

Without it a real project has no test runner in the checkout and every check stands down, which is
reported as `not measured` rather than as a refusal. Those are different findings, and the
difference is the point of this tool.

## Judging a second oracle without re-running the suite

`--oracle-only` runs the oracle and skips the repository's own checks. It is for the second
judgement of one patch by a different oracle, where the suite would answer the same way both times:
on a corpus where a project runs its tests under four timezones and every patch is judged twice,
that is most of the machine time.

Skipping is not passing. `regression` reads `unmeasured`, nothing is verified, and the advice says
the checks were not asked for, because a run that did not measure the suite has not established
that the patch broke nothing.

## Reading another agent's stream

Pass `--agent-stream` with `--agent-format claude-code` or `generic` and another agent's own event
stream is read beside the patch. A line the adapter does not recognise refuses the whole stream by
line number rather than being skipped, because a skipped line is evidence that quietly went unread.

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

`unmeasured` is a value, not a missing one. A change whose only passing gate was a linter is not a
change anything ran: linting proves the source parses and establishes nothing about whether any of
it was executed.

`semantic` abstains by construction, because judging whether a change means what the task asked
for is a judgement about meaning, and nothing here is allowed to make one.

`acceptable` means no blocking gate failed, no policy gate failed, and something executed the
change. It does not mean the change is right.

## Checking a bundle without this tool

Every bundle carries its own verifier, and it is dependency-free by design:

```sh
node verify.mjs .        # from inside a bundle directory
node rederive.mjs .      # re-derive every verdict from the records
```

`verify.mjs` checks the manifest, the chain, the signature, every blob against its content
address, and recomputes every claim verdict. `rederive.mjs` goes further: it recomputes every gate
status from the recorded exit code and output under the rule the record names, every ratchet
decision from its recorded measures, every bond and every claim, and names what it cannot
re-derive rather than agreeing with it.

Shown running in a `node:24` container with no network and no mount of this repository, exit 0 on
the committed bundle and exit 1 on the same bundle one byte later:
[`clean-container-verification.md`](evidence/2026-08-23/clean-container-verification.md).

## Identity

A bundle carries the public key its own signature verifies against, so checking it against itself
can only say "unchanged since written". Anyone can edit a bundle, rehash it, sign it with a key of
their own and ship that key in the manifest.

```sh
swarm verify <bundle> --signer <fingerprint>
```

Named and matching is trusted. Named and not matching is untrusted, with both fingerprints in the
message. No signer named is untrusted rather than trusted, and an ephemeral key is never trusted
whatever the policy says, because the run generated it for itself.

Beside the bundle signature every run writes a DSSE envelope binding the patch, the spec digest,
the source commit, the chain head and the verdict under one signature, so a diff and a bundle can
be shown to be about each other.

## What is not claimed

The whole list. The README carries the five that matter most.

- **It is not production-ready.** Of the gates this project agreed not to call itself
  production-ready without, the historical assessment records eight passing, two partial, two
  unproven, and two reported rather than barred. Those counts describe the linked campaigns, not
  a fresh measurement of every gate on this checkout. The old "zero false greens in 400 held-out
  tasks" gate is retired, for four reasons that are measured rather than argued, and replaced by
  three statements about three different questions. Each row and what would settle it:
  [`beta-gates.md`](beta-gates.md).
- **Not "fully secure".** The secret detector does known-pattern scrubbing, not secret removal.
  Zero crashes at a fuzz budget is evidence, not proof.
- **The default execution mode is `restricted`, not `isolated`.** A lexical path and program
  policy in front of interpreters unless you pass `--isolation`. Reported before the run starts
  and recorded on the chain rather than quietly assumed, but it is not containment.
- **The September 6 mined-corpus rate was 0 in 15**, 0.0%, 95% CI [0.0, 20.4], and that upper
  bound is the honest half of it. Every task carries two oracles, one handed to the tool and one
  held back from it, and fifteen certified patches cannot say more than "under 20%":
  [`mined-corpus/`](evidence/2026-09-06/mined-corpus/README.md). Those tasks came from real pull
  requests, where maintainers test what they cared about rather than what the author of a tool
  thought to check. That historical rate is not a rate for the current build or for the separate
  synthetic campaign. The one that used to stand, `commander#1671`, is refused now because its
  oracle accepted a change to a line it had run.
- **Shown its oracle, a model still gets past this.** Both of those patches now get a bond and
  both bonds hold, which is the finding rather than a fix: a patch written to satisfy a visible
  test has its added lines tested by that test, so the oracle refuses every mutant of them and is
  right to. Bonding asks whether the oracle judged what the patch added. It cannot ask what the
  patch left out, and that is what an adversarial patch does.
- **The denominator moved when the tool did, and that is a cost.** Four patches both oracles
  accept are refused because the tool's own oracle never ran part of what they changed, five more
  because the sealed half rejects work the held-back half accepts, and one because its oracle
  accepted a change to a line it had run. A tool that refuses more has fewer claims to be wrong
  about, so the interval over what is left is wider. Both halves are reported, and a refusal is
  never counted as a pass.
- **Every number here has been wrong at least once, and the corrections are in the history.** A
  reported zero was withdrawn as self-agreement. A patch was refused over a TypeScript declaration
  file, which hid a real false green behind a wrong refusal. Two mutation operators were producing
  changes that changed nothing until an audit read every refusal by hand. The pattern is the same
  each time: read what a check names before believing it.
- **Twelve tasks reported as unjudgeable were the agent having written nothing at all**, which
  is a model failure and is recorded as one. An earlier 0-of-18 was withdrawn as arithmetic rather
  than corrected quietly: the same test was handed to the tool and then used as the ground truth
  it was scored against, so it agreed with itself:
  [`false-green-measurement.md`](evidence/2026-09-05/false-green-measurement.md).
- **Six known gaps ship open**, and none is claimed closed. Four have detections built against
  them, each attacked once, by one person, in one pass, so what is claimed is a detection and not
  a closure. Each is a permanent case in the adversarial suite asserting the gap as it stands:
  [`build-guide.md`](build-guide.md#71-accepted-residuals).
- **A signature does not make the machine honest.** It proves the bundle was not altered after it
  left the machine that produced it.

Gates prove mechanical quality, not design quality. What a bundle buys you is that reviewing the
change is fast and its claims are checkable, not that review is unnecessary.
