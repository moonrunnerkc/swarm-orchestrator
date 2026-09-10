# Getting to a working result on gate 3

Gate 3 asks for zero false greens over at least four hundred held-out tasks. The measured rate is
**1 in 16, 95% CI [1.1, 28.3]**, down from 2 in 22 when this was written. This is what would have
to be true for that number to be both trustworthy and better, separated into the two different
problems it actually is.

Five of the six items below are done. What is left is the one that was always the hard one, scale.

## The distinction that matters

**Measurement hygiene** makes the number believable. **Product work** makes the number smaller.
Most of what has been done so far is the first, and the first cannot improve the tool.

## A false green is a product defect, not only a measurement artifact

`swarm ci --oracle X` certifies when the suite still passes and X accepts. It never asks whether X
is capable of rejecting anything. Four of fifteen certified tasks turned out to have an oracle that
passes on the base commit: it would have accepted a patch that changed nothing, and the tool said
`task: accepted` anyway.

That is the tool's failure, not the corpus's. A verifier handed a check that cannot fail should
say so rather than pass the check along as evidence. The same reasoning already runs elsewhere in
this codebase: a gate that passes over a bond it demonstrably saw is recorded vacuous, and a
failing check that also fails at the base is recorded inherited rather than charged to the patch.
The task oracle is the one input that gets no such treatment.

## The work

### 1. Refuse to certify on an oracle that cannot fail

Run the supplied oracle against the base commit as well. An oracle that accepts the unpatched base
establishes nothing about the patch, so `task` becomes `vacuous` rather than `accepted` and
`verified` is false with the reason given.

The cost is one extra oracle run, spent only where the oracle accepted, exactly as the inherited
attribution spends one extra check run only where something failed.

This would have caught four of the fifteen. It is the single change that most directly reduces
false greens rather than measuring them.

### 2. Bond the oracle

**Built, report-only.** After the oracle accepts, the lines the patch added are changed into
something that behaves differently and the oracle is run again. One that still accepts did not
test what it appeared to test. This is the bond machinery the gates already use, one layer up, and
it carries the same four words: `held`, `vacuous`, `unshown`, `not-bonded`.

The operators are in [`src/gates/oracle-mutants.ts`](../src/gates/oracle-mutants.ts), and every one
of them is a syntactic rule over a line rather than a rule about a repository, a patch or a task: a
check whose sensitivity can be tuned per subject measures the tuning. Invert a comparison; swap the
operands of a non-commutative arithmetic operator; replace a returned expression with a sentinel;
swap the two arguments of a call; drop a no-argument call whose result the chain uses. Six mutants
per patch at most, two per operator, ordered by how often each operator produces a mutant that
changes nothing, because each mutant is another oracle run.

`vacuous` needs the oracle to have demonstrably run the mutated line, which is the coverage reach
already read of the same run. Where nothing was measured the answer is `unshown`, not `vacuous`:
absence of evidence about the oracle is not evidence against it.

**The residual, stated rather than solved.** A mutant that changes nothing observable is
indistinguishable here from an oracle that failed to notice one that did. That is the equivalent
mutant problem and this does not solve it. What it does instead is keep the operators few and
mechanical and audit every `vacuous` verdict by hand before any of them refuses anything. Beside
it: a patch with no line these operators can change gets no bond at all, which is
`not-bonded` and is never read as `held`.

#### The decision rule, pre-registered

Written here, and committed, before the measurement over the sixteen certified patches ran. It
does not change after the table is seen. If the table shows the rule was wrong, that is what the
report says.

Bonding blocks on `vacuous`, and only on `vacuous`, if all three hold after the audit:

1. zero false refusals across the sixteen, where a false refusal is a `vacuous` verdict whose
   mutant is equivalent or whose refusal comes from an artifact of the check;
2. `tj/commander.js#1671` is refused;
3. the known-answer smoke still gives koa#1946 true-red, and if koa#1999 or koa#1904 changes, the
   change is a refusal whose mutant the audit confirmed behaviour-changing.

If any condition fails, bonding stays report-only, and the report names the condition and the lines
responsible.

Every `vacuous` verdict is read by hand before it is counted, the same check the reach refusals
got, and split three ways by what the held-back oracle does with the same mutant:

- **real gap:** the held-back oracle refuses the same mutant. A user who supplied the whole suite
  would get `held` here, so this refusal is a product of splitting one suite in two rather than
  something users would meet.
- **unconfirmed:** both oracles accept the mutant, and reading the mutated line confirms it changes
  behaviour an oracle could execute. This is the refusal a whole-suite user would actually see.
- **false refusal:** the mutant is equivalent, or the refusal comes from an artifact. This is the
  one that vetoes.

`unshown` and `not-bonded` never block. They are absences of evidence about the oracle rather than
evidence against it, and blocking on them would make the certify rate a function of how many
mutation operators this build happens to carry. They are also never flattened into `held`: `swarm
ci` prints the bond state beside the verdict and gate 3c splits the certify rate by it, so
`verified` reads as "no regression, the oracle accepted, it ran the change, and no mutant of the
change got past it", with a `held` bond shown as the stronger claim.

**Why `vacuous` is the one that blocks.** An oracle that accepted a behaviour-changing mutant of
the change has not verified the change, and the standing principle here is to abstain rather than
certify on evidence known to be empty. Real gaps and unconfirmed refusals are the price of that,
and they are reported rather than treated as a veto: each one is the tool being right about its
oracle.

The switch is one exported boolean,
[`bondRefusesCertification`](../src/gates/certification.ts), so turning it on or off is one line
and the evidence beside it.

#### What the measurement produced, and what the rule did with it

Bonding ran over all sixteen patches the tool had certified. `node scripts/bond-cost.mjs` derives
this from the recorded rows, in both regimes, whichever one is currently on.

| bond | count |
| --- | --- |
| held | 14 |
| vacuous | 1 |
| unshown | 0 |
| not bonded | 1 |

**The audit found two mutants that changed nothing, and both narrowed an operator.** Reading every
`vacuous` verdict by hand is the check that found all three reach artifacts, and it earned its
place again here. `tj/commander.js#1711` adds `return false;` inside a `filter` predicate, and
`return undefined;` there is the same predicate, because `filter` reads truthiness and both are
falsy. A darkreader patch computes `Math.min(i + size, len)`, and swapping the arguments of a
commutative call is not a change. Neither was excused as a special case: the sentinel now has to
differ from the returned expression wherever that expression's truthiness is known from its
spelling, and the argument swap now leaves JavaScript's commutative operations alone. Re-measured
after the narrowing, both came back `held`.

**One `vacuous` verdict stands, and it is the false green.** `tj/commander.js#1671`, mutant
`lib/command.js:1473:drop-chained-call`:

```
-     getCommandAndParents(this).reverse().forEach((cmd) => {
+     getCommandAndParents(this).forEach((cmd) => {
```

Dropping `.reverse()` inverts the merge precedence the patch exists to set, on a line the sealed
half runs on every case. Behaviour-changing, and not an artifact. Its held-back oracle never judged
the mutant, because it refuses the unmutated patch, so it falls in none of the three buckets: it is
the tool being right about the patch as well as about the oracle.

So the split over the sixteen is **0 real gaps, 0 unconfirmed refusals, 0 false refusals**, with
the one `vacuous` verdict on a patch whose held-back oracle was never in a position to judge the
mutant.

**All three conditions held, so bonding blocks.** Zero false refusals; commander#1671 refused; the
known-answer smoke unchanged at koa#1946 true-red, koa#1999 true-green, koa#1904 true-green. The
switch went true in one commit, `343ae4740`, whose revert restores report-only.

| regime | certified | false greens |
| --- | --- | --- |
| report-only | 16 of 97, 16.5% [10.4, 25.1] | 1: 6.3% [1.1, 28.3] |
| blocking on vacuous | 15 of 97, 15.5% [9.6, 24.0] | 0: 0.0% [0.0, 20.4] |

#### The stricter option that was rejected, with its counts

**Require `held`.** Under that rule a certified patch would need its oracle to have refused a
mutant, and `not bonded` would refuse as well. It costs one more patch of the sixteen:
`koajs/koa#1999`, whose added lines are a regular-expression test, two `new URL(...)` calls and a
template literal, and which no operator here can change into something that behaves differently.
Both oracles accept that patch. Refusing it would be the tool reporting a property of its own
operator table as a property of somebody else's oracle, which is reason 4 in
[`beta-gates.md`](beta-gates.md) with a different knob: the certify rate would become a function of
how many mutation operators this build happens to carry, and every operator added would move a
published number.

Counts, so the choice can be reopened from numbers rather than from this paragraph: requiring
`held` certifies **14 of 97** rather than 15, with the same **0** false greens, and the one patch
it costs is one both oracles accept.

### 3. Report whether the oracle executed the change

**Done, and then done properly.** An oracle that never runs the changed lines cannot have judged
them, so `oracleReach` reports `reached`, `unreached` or `unmeasured` and `unreached` refuses to
certify, naming the lines.

Pointing the ratchet's own instrument at it was the first attempt and it was the wrong instrument.
The ratchet reads a coverage artifact only from an invocation the harness assembled itself with no
shell in between, because there the workspace can inflate a number a retry is judged against.
Reach only ever turns a green into a refusal, so a workspace that forged its coverage would land on
`reached`, which is exactly what an oracle nobody could measure already gets. Holding reach to that
bar left it blind on thirteen of the seventeen repositories in the mined corpus.

It now reads whichever coverage the oracle's own runner can be made to write: node's lcov reporter,
V8's own coverage for a runner that loads the file as written, or jest's and vitest's own reports
under flags the harness appends. A transforming runner is caught where it shows, by offsets past
the end of the file, and abstains the whole reading rather than dropping a file.

The residual is named rather than closed: those reports are written by the workspace's own
processes and nothing detects a forged one. That is safe only while the check can do nothing but
refuse, and it must not be reused anywhere a number can buy something.

**And it is not free.** A patch that restructures one assignment into an `if` and an `else`, judged
by an oracle whose cases all take the `if`, is refused with the `else` named. Those refusals are
recorded as `refused-on-reach`: not the tool being wrong about the patch, and not a pass either.
They leave the certified set, so the interval over what remains is wider.

### 4. Carry the declared environment into the regression check

**Done.** The zone the project's own test script declares travels to `swarm ci` as an environment
name, so the repository's checks and the oracle both run under it.

It had been travelling as a shell prefix on the oracle command, `TZ=x mkdir … && cp … && npx jest
…`, which sets the zone for the `mkdir` and nothing else. So the oracle ran under whatever zone the
machine was in while the viability filter that admitted the task ran under the project's own, and
one dayjs task changes verdict between the two.

### 5. Corpus filters that raise the yield per task

**Done, and one of the two proposals here was wrong.**

Each half is now run against the base source before a task is kept, and a half that passes is
re-dealt in larger blocks before the task is given up on. The halves are what the oracles run and
the whole file is not: 21 of the first 73 mined tasks came back unjudgeable because one half or the
other accepts the base, every one of them after a model run had been spent. Fourteen candidates
left the corpus on this rule and on the one beside it, that a test file which does not finish on
the base source was being read as one that fails there.

**Requiring at least two cases in each half is not a filter on the instrument.** dayjs#3181, the
one false green that stands, has a 1+1 split and would be excluded by it. A filter that removes the
finding is denominator management wearing a tightening's clothes. What each half is held to instead
is the property that matters, that it can refuse the base, which belongs to the half rather than to
how many cases are in it.

### 6. Scale

**Not done, and now the only thing between this gate and an answer.** Fourteen opportunities is not
four hundred tasks. The pipeline is unattended and resumable, so this is machine time rather than
authoring, and it was right to leave until last: mining more tasks through filters that admit
vacuous oracles would have produced a bigger wrong number, and the filters are only now correct.

What the arithmetic actually says, measured rather than assumed. 192 candidates are mined, all of them checked, and 79 are viable, so mining and viability are cheap. The expensive ratio is the one
after that: 5 of 79 scored tasks became an opportunity, because an opportunity needs the tool to
certify a patch and the local model fails most of these tasks outright. At that rate four hundred
opportunities is roughly eight thousand tasks, which is not machine time, it is a different plan.

Two things would change it, and both are decisions rather than code. A stronger model would certify
more, which costs money this project has declined to spend. Shaping the corpus toward tasks a local
model can do would raise the ratio and narrow what the resulting rate describes, which has to be
said next to the number if it is done.

## What is not achievable, and should stop being implied

Zero false greens is not reachable by a verifier that can only check what it was given. A tool
handed a weak oracle will certify weak work, and no amount of internal rigour changes that.

What is reachable is a tool that refuses to certify on an oracle it can show to be inadequate, and
that reports what its oracle did and did not establish. Gate 3 should be restated against that,
because the current wording asks for something no verifier can promise.
