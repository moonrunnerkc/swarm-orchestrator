# Getting to a working result on the false-green rate

Written when gate 3 asked for zero false greens over at least four hundred held-out tasks. That
wording is retired, for four measured reasons in [`beta-gates.md`](beta-gates.md), and what replaced
it is three statements about three different questions. The work below is unaffected by that: it is
what would have to be true for the rate to be both trustworthy and better, separated into the two
different problems it actually is, and every item is still open or closed on its own terms.

Five of the six items are done. What is left is the one that was always the hard one, scale, and
the shape of it has changed: mining more is measured and does not help, while the arm that grows
the denominator gate 3b is short of is the adversarial one.

Where the rate stands, from `node scripts/false-green-rate.mjs` rather than from this sentence:
**0 false greens in 15 certified over 97 judgements, 0.0% [0.0, 20.4]**, with 0 false reds. The
report-only comparison over the same rows is 1 in 16, so the one patch bonding refuses is the one
the rate would otherwise carry.

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
check whose sensitivity can be tuned per subject measures the tuning. Six mutants per patch at
most, two per operator, ordered by how often each operator produces a mutant that changes nothing,
because each mutant is another oracle run.

**There are eight of them, and the first five were silent on ordinary code.** Invert a comparison;
swap the operands of a non-commutative arithmetic operator; replace a returned expression with a
sentinel; swap the two arguments of a call; drop a no-argument call whose result the chain uses.
Each needs a particular token on the line, and a guard clause, an assignment, a `require` and a
callback carry none of them, so `mutantOfLine` returned null and the bond said `not-bonded` because
it had nothing to ask. Both adversarial false greens are that shape and produced zero mutants
between them across every line they add.

Three more cover the statement shapes that went uncovered: an `if` or `while` condition negated
whole, the value a plain assignment or declaration writes replaced by a sentinel, and the statement
removed. Read off the language's own `Statement` productions rather than off the patches that
exposed the gap, since operators fitted to the cases that motivated them measure the fitting. The
derivation, the ordering, and which tasks were in sample when it was written are in
[`oracle-bond-operators.md`](oracle-bond-operators.md), committed before any of it was implemented.

Statement deletion is the one operator that can leave a file that does not compile, and every
oracle refuses one of those, so a bond counting that refusal would credit the oracle with a
rejection it never made. It is held to `node --check` over the file the patch left and over the
file with the line blanked. Where the original does not parse, node cannot read the dialect and so
cannot tell a syntax error from a mutant, and the operator proposes nothing for that file:
TypeScript and JSX keep the other seven.

**`vacuous` takes two facts, and it used to assert the second without evidence.** The first is that
the oracle demonstrably ran the mutated line, read from the coverage reach already took of the same
run; absent that the answer is `unshown`. The second is that the mutant changed anything at all. A
mutant that changes nothing is indistinguishable from an oracle that failed to notice one that did,
and what told them apart was a person reading each mutated line. That audit found two equivalent
mutants and narrowed two operators. It does not scale, and it is not evidence anybody else can
re-derive.

So a second detector adjudicates every mutant the oracle accepted on a line it ran, and `vacuous`
requires it to have seen a difference. Cheapest first, and the first that answers decides it. The
oracle is run again over the mutant under the same instrumentation reach used, and a line other
than the mutated one that ran in one reading and not the other is a demonstrated difference in what
the program did; the mutated line is excluded, because a deleted statement stops running by
construction. Failing that, the repository's own gates that passed with the patch applied are run
again, and one that now fails is a demonstrated difference. Neither seeing anything is `unshown`,
never `vacuous` under that reading, and the two absences are kept apart: `none` where everything
that could be asked was asked and nothing showed a difference, which includes a patch whose own
checks leave nothing to ask of the second detector, and `not adjudicated` where no detector was
asked at all.

What the pair cannot see is named rather than implied away. Coverage sees a mutant that changes
control flow or stops reaching code, and not one that changes a value on a path that runs either
way, which includes reordering a sequence every element of which is visited. The repository's own
suite sees a mutant that breaks behaviour the project already had, and on a patch that adds a
feature it is silent by construction, because the suite was written before that behaviour existed.
A mutant that changes only a value, on a path that runs either way, in code the project did not
have before, is witnessed by neither and lands in `unshown`.

**That costs the refusal of commander#1671, and the reason is worth as much as the catch was.** Its
mutant drops a `.reverse()`: coverage sees the same lines run the same number of times in a
different order, and commander's own suite never had the precedence the patch adds. Neither
detector can witness it, so the verdict is `unshown`. That refusal rested on a person reading the
mutated line and calling it behaviour-changing, and invariant 16 says a verdict nothing can
re-derive is named as not re-derived rather than agreed with. Keeping it by making the hand
judgement a condition would be keeping a number by keeping the audit that produced it.

Beside all of it: a patch with no line these operators can change gets no bond at all, which is
`not-bonded` and is never read as `held`. It is much rarer now. koa#1999 is the patch the rejected
stricter option below called untouchable by any operator here, and it certifies on `held`.

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
this from the recorded rows, in every regime, whichever one is currently on.

| bond | count, five operators | count, eight operators |
| --- | --- | --- |
| held | 14 | 16 |
| vacuous | 1 | 0 |
| unshown | 0 | 0 |
| not bonded | 1 | 0 |

The right-hand column is what the three general operators bought, and it is the whole of what they
bought here: every certified patch is now bonded, where one of the sixteen had nothing any operator
could change and one was refused. `not bonded` has not disappeared from the tool, only from the
certified set of this corpus, and it is still never read as `held`.

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
| witness required | 16 of 97, 16.5% [10.4, 25.1] | 1: 6.3% [1.1, 28.3] |
| blocking on vacuous, witness recorded | 15 of 97, 15.5% [9.6, 24.0] | 0: 0.0% [0.0, 20.4] |

`node scripts/bond-cost.mjs` prints all three off the same rows. The middle one is what requiring
a witness of a vacuous verdict would do, and it is the first row to the digit: a bond that refuses
nothing. That is why the witness is recorded beside a refusal rather than required of it, decided
against conditions written down before the column was computed, in
[`oracle-bond-operators.md`](oracle-bond-operators.md).

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

What the arithmetic actually says, measured rather than assumed. 192 candidates are mined, all of
them checked, and 79 are viable, so mining and viability are cheap. The expensive ratio is the one
after that: an opportunity needs the tool to certify a patch, and the local model solves 11 of 79
of these tasks at all (`node scripts/task-difficulty.mjs`). At that rate four hundred opportunities
is roughly eight thousand tasks, which is not machine time, it is a different plan.

**Mining more repositories is measured now, and it is not the answer.** Two further passes over the
same fifty-repository selection, one at four pages per repository and one at ten, added **zero new
candidates**: the same 192, because the pulls the miner reaches are the same pulls. Going deeper
needs a higher per-repository cap, which costs one API call per pull examined, and going wider
needs repositories nobody has chosen yet. Either is machine time spent on the cheap half of the
pipeline while the expensive half is untouched.

**What grows 3b's denominator is the adversarial arm, by twenty to one.** That denominator is
oracles a held-back oracle proves inadequate, which means a patch the sealed half accepts and the
held-back half refuses. The ordinary arm produced 3 of those in 97 judgements, because it has to
wait for a model that is trying to do the task to happen to satisfy one half and not the other. The
adversarial arm produces them on purpose: it showed the model the oracle it would be judged by and
got 2 in 9. Per model run that is roughly twenty times the yield, on the one number this gate is
short of.

The two rates can never be added, and the reason is the same reason the yield differs: a model shown
its acceptance test is a stronger adversary than a contributor who cannot see it, so its rate is an
upper bound on the tool's blindness rather than a rate of anything in the wild.
`separateAdversarialRows` enforces that by reading what a row records about its own prompt, so a row
in the wrong file is still not pooled.

One thing would change the ordinary arm's ratio and it is a decision rather than code. A stronger
model would certify more, which costs money this project has declined to spend. Shaping the corpus
toward tasks a local model can do would raise the ratio and narrow what the resulting rate
describes, which has to be said next to the number if it is done.

## What is not achievable, and should stop being implied

Zero false greens is not reachable by a verifier that can only check what it was given. A tool
handed a weak oracle will certify weak work, and no amount of internal rigour changes that.

What is reachable is a tool that refuses to certify on an oracle it can show to be inadequate, and
that reports what its oracle did and did not establish. Gate 3 should be restated against that,
because the current wording asks for something no verifier can promise.
