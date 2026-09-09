# Getting to a working result on gate 3

Gate 3 asks for zero false greens over at least four hundred held-out tasks. The measured rate is
**2 in 22, 9.1% [2.5, 27.8]**. This is what would have to be true for that number to be both
trustworthy and better, separated into the two different problems it actually is.

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

An oracle that never runs the changed lines cannot have judged them. Coverage of changed lines is
already measured for the ratchet; pointing it at the oracle answers a different question with the
same instrument.

### 4. Carry the declared environment into the regression check

`swarm ci` runs the project's own suite with no regard for what that suite needs. dayjs sets a
timezone per invocation, so the same base commit answered `pass` in one run and `unmeasured` in
another. A measurement that is not reproducible cannot support a rate.

### 5. Corpus filters that raise the yield per task

- Require at least two cases in each half. 42% of splits have a single-case half, and a lone
  assertion is thin evidence either way.
- Require the base suite to pass. Three of seventy-three tasks can never produce an opportunity
  because the repository is already red at the base.

Both shrink the corpus and raise the fraction of tasks that can actually resolve a question.

### 6. Scale

Twenty-two opportunities is not four hundred tasks. The pipeline is unattended and resumable, so
this is machine time rather than authoring, and it is the last thing to do rather than the first:
mining more tasks through filters that admit vacuous oracles would produce a bigger wrong number.

## What is not achievable, and should stop being implied

Zero false greens is not reachable by a verifier that can only check what it was given. A tool
handed a weak oracle will certify weak work, and no amount of internal rigour changes that.

What is reachable is a tool that refuses to certify on an oracle it can show to be inadequate, and
that reports what its oracle did and did not establish. Gate 3 should be restated against that,
because the current wording asks for something no verifier can promise.
