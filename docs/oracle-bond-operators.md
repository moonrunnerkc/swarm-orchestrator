# The operators an oracle bond is built from, and how a vacuous verdict is adjudicated

Written before the operators below were implemented and before anything was measured with them.
The rule at the bottom does not change after the table is seen. If the measurement shows the rule
was wrong, that is what the report says.

## The measured problem

The bond changes a line the patch added into something that behaves differently and runs the
oracle again. It has five operators, in [`src/gates/oracle-mutants.ts`](../src/gates/oracle-mutants.ts):
invert a comparison, swap the operands of a non-commutative arithmetic operator, replace a
returned expression with a sentinel, swap the two arguments of a call, drop a no-argument call
whose result the chain uses.

Every one of them needs a particular token on the line. Ordinary code does not carry those tokens.
A guard clause, an assignment, a `require`, a callback: none of them offers these five operators a
target, `mutantOfLine` returns null, and the bond reports `not-bonded`, which is the fourth word
and is never read as `held`.

Reproduced against the built tree before anything here was written:

```
npm run build && node -e "
import('./dist/gates/oracle-mutants.js').then(m => {
  for (const text of ['    if (!this.isValid()) {', '      return this',
                      \"const v8 = require('v8')\", '      this.ctxStorage = null']) {
    const got = m.mutantsOfChangedLines({ changed: [{ path:'src/a.js', addedLines:[{line:10,text}] }] });
    console.log(got.length ? 'MUTANT ' + got[0].operator : 'none', '|', text.trim());
  }
});"

none | if (!this.isValid()) {
none | return this
none | const v8 = require('v8')
none | this.ctxStorage = null
```

Both adversarial false greens are that shape. Run through the harness's own diff parser and mutant
planner, `iamkun/dayjs#3180` and `koajs/koa#1946` produce zero mutants between them across every
line they add. `not bonded` there is not the tool finding a strong oracle. It is the tool having
nothing to ask.

## Where the operators come from

Not from those two patches. Fitting operators to the cases that motivated them is how the current
3-of-3 on gate 3b became partly in-sample, and it buys a number that describes the fitting.

The design reads the `Statement` and `Declaration` productions of the language instead, and asks of
each shape what change to one line of it a test could observe. The left column is what the grammar
allows on a line; the right is what covers it.

| Statement shape | a line of it | covered by |
| --- | --- | --- |
| ExpressionStatement, call | `emit(name)` | nothing, until `delete-statement` |
| ExpressionStatement, assignment | `this.zone = zone` | nothing, until `replace-assigned-value` |
| ExpressionStatement, compound assignment | `total += one` | `swap-arithmetic-operands`, only for `-`, `/`, `%` |
| ExpressionStatement, update | `at += 1` | nothing, until `delete-statement` |
| LexicalDeclaration with initializer | `const v8 = require('v8')` | nothing, until `replace-assigned-value` |
| IfStatement head | `if (!this.isValid()) {` | nothing, until `negate-condition` |
| IfStatement head with a comparison | `if (at === last) {` | `invert-comparison` |
| IterationStatement head, `while` | `while (queue.length) {` | nothing, until `negate-condition` |
| IterationStatement head, `for` | `for (const one of all) {` | nothing, and nothing here changes that |
| ReturnStatement with a semicolon | `return merged;` | `return-sentinel` |
| ReturnStatement without one | `return this` | nothing, until `delete-statement` |
| ThrowStatement | `throw new RangeError(at)` | nothing, until `delete-statement` |
| BreakStatement, ContinueStatement | `continue` | nothing, until `delete-statement` |
| ImportDeclaration | `import fs from 'node:fs'` | nothing, until `delete-statement` |
| Call in a chain | `parents(this).reverse().forEach(cb)` | `drop-chained-call` |
| Call with two arguments | `assign(target, source)` | `swap-call-arguments` |
| FunctionDeclaration, ClassDeclaration head | `function merge(one, other) {` | nothing, and a line-level change is the wrong instrument |
| SwitchCase label | `case 'utc':` | nothing, and a line-level change is the wrong instrument |
| Object property | `zone: name,` | nothing, and a line-level change is the wrong instrument |
| Brace or bracket punctuation | `}`, `});`, `],` | nothing, and there is no behaviour on the line to change |

Three shapes account for most of what is uncovered, and three operators cover them.

### `negate-condition`

An `if` or `while` condition wrapped in `!( ... )`. The keyword is read at a word boundary that is
not a property access, its condition is the balanced parenthesis after it, and the whole condition
is wrapped rather than a token inside it edited, so `} else if (a && b) {` and
`while (queue.length) {` are both one rule.

Equivalence residual: a condition whose two branches do the same thing. That is rare enough, and
the reason condition negation is the second operator every mutation tool carries.

### `replace-assigned-value`

The right-hand side of a plain assignment or a declaration with an initializer, replaced by a
sentinel no caller asked for. Plain means a single `=` that is not part of `==`, `===`, `!=`,
`!==`, `<=`, `>=`, `=>` or a compound assignment.

The sentinel is chosen the way `return-sentinel` chooses it, and for the reason that operator was
narrowed: `undefined` for anything, and a truthy string where the replaced expression is a literal
whose falsiness is known from its spelling, so `this.zone = null` does not become
`this.zone = undefined` and get called a change.

Equivalence residual: an assignment nothing reads.

### `delete-statement`

The line replaced by an empty line. The most general operator there is, and the classic: almost
any complete statement can be removed, and a test that asserts on what the statement did will
notice.

An empty line rather than a removed line, so every line after it keeps its number. The coverage
hit map the bond reads is keyed by line, and a mutant that renumbers the file is a mutant nothing
can be shown to have run.

Applies where the line reads as a complete statement, and the reading is lexical: brackets balance
across it and never go negative, it does not end in a position that continues (`{`, an infix
operator, `,`, `=>`), and it does not begin in one (`.`, `?.`, `)`, `]`, `}`, `:`, an infix
operator) or with a keyword that needs the block it heads (`else`, `case`, `default`, `catch`,
`finally`, `do`, `try`).

Equivalence residual: a statement with no observable effect. This is the operator that carries most
of it, which is why it is last in the ordering and first to be cut by the mutant bound.

## A deletion that does not parse is not a mutant

The lexical reading above is not a parser and cannot be. A line can be balanced, start and end on
a token that looks final, and still be the middle of an expression the line before it opened.
Deleting it then leaves a file that does not compile, the oracle refuses it, and the bond credits
the oracle with a refusal it never made. A syntax error is not evidence about anybody's tests.

So a `delete-statement` mutant is confirmed to parse before it is used, and confirmed
differentially: `node --check` is run over the file as the patch left it and over the file with the
line blanked.

- The original parses and the mutant parses: the mutant is used.
- The original parses and the mutant does not: the mutant is discarded, and no observation is
  recorded for it.
- The original does not parse: `node --check` cannot read this dialect, so it cannot tell a syntax
  error from a mutant, and `delete-statement` proposes nothing for that file.

The third case is the residual, named rather than implied away: `node --check` reads JavaScript,
including ES module syntax in a `.js` file, and refuses TypeScript and JSX. In a TypeScript or JSX
file the other seven operators still apply and statement deletion does not. Nothing else here
needs the check, because no other operator can produce a file that does not parse: each of them
replaces a token with a token of the same shape, wraps a balanced region, or removes a balanced
one.

## What makes a bond vacuous, and what abstains

`vacuous` means the oracle ran a line the patch added and then accepted a change to that same
line, so running it established nothing about that line. Two facts have to be shown for that, and
until now only one of them was.

Shown already: the oracle executed the mutated line, read from the coverage of the oracle's own
run, which is the same reading reach takes. Absent that, the answer is `unshown`.

Not shown, and the reason this document exists: that the mutant changes behaviour at all. A mutant
that changes nothing is indistinguishable from an oracle that failed to notice one that did, and
the audit that separated them was a person reading each mutated line. That audit found two
equivalent mutants and narrowed two operators. Broadening the operators makes the problem worse,
because the general operators are the ones that produce equivalent mutants, and a hand audit does
not scale and is not evidence.

So a second detector adjudicates every mutant the oracle accepted on a line it ran, and `vacuous`
requires that detector to have seen a difference. Two detectors, cheapest first, and the first one
that witnesses a difference decides it:

1. **Coverage.** The oracle is run again over the mutant with the same instrumentation reach used,
   and the hit map is compared with the unmutated one. A line other than the mutated line that ran
   in one and not in the other is a demonstrated difference in what the program did. The mutated
   line is excluded because a deleted statement stops running by construction and that is not a
   finding. Presence and absence only, never a change in hit count: a count that moves is the
   weaker signal and a flaky one, and the direction this can be wrong in is a refusal, which is
   the direction that must not be wrong.

2. **The repository's own suite.** The gates that passed with the patch applied are run again over
   the mutant. One that now fails is a demonstrated difference. A gate that failed with the patch
   applied witnesses nothing and is not read.

If neither witnesses a difference the verdict is `unshown` and never `vacuous`. That is an
abstention, it does not refuse certification, and it is not flattened into `held`.

What each detector can and cannot see, stated because the pair is not a proof of equivalence:

- Coverage sees a mutant that changes control flow or stops reaching code. It does not see one that
  changes a value along a path that runs either way, which includes changing the order of a
  sequence every element of which is visited.
- The repository's own suite sees a mutant that breaks behaviour the project already had. It cannot
  see one that only affects behaviour the patch is adding, because the suite was written before
  that behaviour existed. On a patch that adds a feature, this detector is silent by construction.
- So a mutant that changes only a value, on a path that runs either way, in code the project did
  not have before, is witnessed by neither and lands in `unshown`. That is the accepted residual.

The cost is bounded by where it is spent. Only a mutant the oracle accepted on a line it ran can be
vacuous, so only those are adjudicated, and the first witnessed difference ends the adjudication
for that patch because one vacuous mutant decides the bond. Detector 1 is another oracle run.
Detector 2 is another suite run and is capped per patch, with anything past the cap recorded as not
adjudicated rather than as either answer.

## Ordering, and the bound

The operator list is ordered by how often an operator produces a mutant that behaves exactly as
the original did, because the bound on mutants per patch cuts the tail of that list first and each
mutant is another oracle run. One mutant per line, by the first operator in this order that fires,
so two rules never compete for one line.

```
invert-comparison         a flipped comparison changes the predicate whatever the operands are
negate-condition          a negated condition changes which branch runs
swap-arithmetic-operands  equivalent where the operands are equal, or the operation commutes
return-sentinel           equivalent where the caller reads only truthiness
replace-assigned-value    equivalent where nothing reads what was assigned
swap-call-arguments       equivalent where the callee does not care about order
drop-chained-call         equivalent where the dropped call was the identity on its input
delete-statement          equivalent where the statement had no observable effect
```

The bound stays at six mutants per patch and two per operator, unchanged, so the oracle runs a
certified patch pays for do not move with this change. Six slots against eight operators is a real
constraint and it is a knob: raising it buys a stronger bond and costs oracle runs.

## In sample and out of sample, declared now

The two adversarial false greens were read before this was written, because reproducing the
zero-mutant result required reading them. Neither is out-of-sample evidence for these operators and
neither will be reported as though it were.

- **In sample.** `iamkun/dayjs#3180` and `koajs/koa#1946`, the two adversarial false greens, and
  `tj/commander.js#1671`, which the existing five operators were chosen knowing about.
- **Out of sample.** Every other patch in both corpora, none of which motivated anything here, and
  the adversarial tasks run after these operators are committed. Adversarial rows produced after
  the freeze are the only out-of-sample adversarial evidence there is, and they are reported
  separately from the three names above.

No operator or threshold above is changed in response to what any of these produce. A finding that
argues for a change is reported as a finding, and the change is a later commit with its own
measurement.

## The decision rule, pre-registered

The broadened operators and the adjudication ship together, blocking, if both hold:

1. **Zero false refusals across both corpora.** A false refusal is a `vacuous` verdict on a patch
   both oracles accept whose mutant does not change behaviour, or whose refusal comes from an
   artifact of the check. This is the condition that vetoes, because it is the one where the tool
   gets worse.
2. **The known-answer smoke is unchanged.** `koajs/koa#1946` true-red, `koajs/koa#1999` and
   `koajs/koa#1904` certified.

If either fails, the broadened operators go in report-only, and the report names the condition and
the lines responsible.

**`tj/commander.js#1671` staying refused is reported, and is deliberately not a condition.** The
adjudication may demote it from `vacuous` to `unshown`, because its mutant drops a `.reverse()`
and neither detector can witness that: coverage sees the same lines run the same number of times
in a different order, and commander's own suite never had the precedence this patch adds. If that
happens, the tool has stopped refusing the one false green bonding was built to catch, and the
reason is worth as much as the catch was: that refusal rested on a person reading the mutated line
and calling it behaviour-changing. Invariant 16 says a verdict nothing can re-derive is named as
not re-derived rather than agreed with. Keeping the refusal by making the hand judgement a
condition would be keeping a number by keeping the audit that produced it, which is the practice
this replaces. It is reported either way, with the detector output that decided it.

## What the measurement said, and the one thing it argues for

The rule above ran unchanged over both corpora. This section is what the table showed, written
after seeing it and marked as such.

**The operators do what they were built to do.** All eight fire on the mined corpus, and the three
new ones account for 25 of the 34 mutants built: `replace-assigned-value` 11, `negate-condition` 8,
`delete-statement` 6. Every certified patch now carries a `held` bond. `koa#1999`, the patch the
plan called untouchable by any operator here and the one the rejected stricter option would have
cost, certifies on `held`. The known-answer smoke is unchanged: `koa#1946` true-red, `koa#1999` and
`koa#1904` certified.

**The adjudication fired, and it fired correctly.** One `vacuous` verdict across the corpus, on
`iamkun/dayjs#3180` in the ordinary arm, witnessed by coverage: negating a guard that returns early
on an invalid date stops the lines after it from running, the sealed oracle accepted that, and the
patch was already refused on reach. Behaviour-changing, demonstrated by an instrument, and not an
artifact.

**And it cost the refusal of `tj/commander.js#1671`, which the pre-registration said it might.**
Its `drop-chained-call` mutant reads `unshown` with `witness: none`: both detectors were asked and
neither answered. So the bond is `held` on the other three mutants, the patch certifies, and it is
a false green again. The mined arm goes from 0 false greens in 4 certified to 1 in 5, and 3b from
3 of 3 to 2 of 3.

**Here is the finding.** Across the whole corpus the witness requirement changed exactly one
verdict, and that one was a true catch. It prevented zero false refusals, because the aggressive
operators produced no accepted-and-seen mutant that was equivalent: only two mutants in the corpus
were ever adjudicated at all, one witnessed by coverage and one by nothing. The insurance the
requirement exists to provide has not paid out once, and its premium is the one false green this
corpus still holds.

That is derivable from the record rather than from this paragraph, because a mutant's witness is
recorded beside its verdict: a mutant carrying any witness other than `not-adjudicated` was
accepted on a line the oracle ran, which is the whole of what the earlier rule needed.
`node scripts/bond-cost.mjs` prints both regimes off the same rows.

### The third regime, stated before it is measured

Not a blind pre-registration, and not presented as one: it is proposed because the table above
argues for it. What is fixed here before the numbers are read is the rule and the conditions, and
nothing below moves once the third column is seen.

**Refuse on a mutant the oracle ran and accepted, and record the witness rather than requiring
it.** Two facts, kept as two: that the oracle accepted a change to a line it ran, which is what
`vacuous` has always meant and is true whatever a detector saw, and whether anything showed the
mutant changed the program, which is recorded beside it. A refusal carrying `witness: none` says
what backs it, so the audit that used to read every vacuous verdict now reads only those, and the
count is published rather than lived with.

Its cost is the one the witness requirement was built to avoid: a refusal on a mutant that changes
nothing is a false red. What makes that answerable rather than invisible is the field, which names
exactly which refusals could be one.

The switch is one exported boolean beside the one that already decides whether a vacuous bond
refuses at all, so either regime is one line and the evidence beside it.

**It becomes the default if all three hold:**

1. **Zero false refusals across both corpora**, where a false refusal is a patch both oracles
   accept, certified under report-only, that this regime refuses on a mutant which does not change
   behaviour. Every refusal carrying `witness: none` is read by hand once, which is now a named
   and countable set rather than every vacuous verdict.
2. **The known-answer smoke unchanged**: `koa#1946` true-red, `koa#1999` and `koa#1904` certified.
3. **`tj/commander.js#1671` refused**, which is the catch this exists to recover.

If any of them fails, the witness requirement stays the default and the report names the condition.
Whichever way it goes, both regimes are published side by side, because the choice between them is
the finding rather than the number either one produces.
