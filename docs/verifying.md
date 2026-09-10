# Verifying work, yours or somebody else's

Every gate a run executes runs in the workspace that run was editing, with the tests that run may
have changed, reading reports that run's own processes wrote. The sealed criteria and the ratchet
close most of that. What they cannot close is the shape of it: a subject grading its own paper.

`swarm ci` is the separate opinion, and it does not need this tool's agent to have produced the
patch.

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
one that now fails is a demonstrated difference. Neither seeing anything is `unshown`, and a suite
run that was never spent is recorded as not adjudicated rather than as either answer.

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
mutant, which is what `held` says; what it does not say is that the assertions would have.

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
