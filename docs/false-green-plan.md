# Getting to a working result on gate 3

Gate 3 asks for zero false greens over at least four hundred held-out tasks. The measured rate is
**0 in 14, 95% CI [0.0, 21.5]**, down from 2 in 22 when this was written. This is what would have
to be true for that number to be both trustworthy and better, separated into the two different
problems it actually is.

Four of the six items below are done. What is left is the one that was always the hard one, scale,
and one that turned out to be the wrong idea.

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

After an oracle accepts, hand it a mutation of the changed lines that it should refuse. An oracle
that accepts the mutant did not test what it appeared to test. This extends the bond machinery
already applied to gates, which is the same idea one layer up.

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

What the arithmetic actually says, measured rather than assumed. 192 candidates are mined and 66 of
the 142 checked so far are viable, so mining and viability are cheap. The expensive ratio is the one
after that: 3 of 66 scored tasks became an opportunity, because an opportunity needs the tool to
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
