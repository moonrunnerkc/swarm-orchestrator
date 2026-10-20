# Generated-check control and repair, 2026-10-18

Follow-up to [2026-10-17's repair and detection runs](../../2026-10-17/repair-detection-live/README.md).
Registered in [protocol.md](protocol.md) before the first launch, with two amendments; every
launch is in [launches.md](launches.md). Launches 1 to 5 are **development records on an exposed
task** (mime): the task, its retained faulty patch and the evaluator's audit are known to the
people developing Swarm. None is fresh or comparative benchmark evidence.

## What was established

| question | answer |
| --- | --- |
| Why did 2026-10-17 launch 5's example checks reject every implementation? | **Their program misread its input**, not an empty `new Mime()` as first recorded. The sealed program returned `Mime.getType(case_.input)` for string inputs, so every call passed `undefined`; their `null`-expecting cases held on the base by accident and admission took them as the control. Changing only `case_.input` to `case_` passes 7/7, 9/9 and 3/3 on the upstream fix ([launch-5-replay.json](launch-5-replay.json)). The correction is appended to the 2026-10-17 record. |
| Supplied-check repair (A, launch 1) | **Shown.** With the development checks supplied, Swarm repaired the injected candidate; the evaluator accepts the exact patch. |
| Matched OpenCode arm (A, launch 2) | **Not repaired.** OpenCode ended 34 s in, when its non-interactive run auto-rejected a read outside the workspace (a mistyped path); the delivered tree is the injected candidate. One pair on an exposed task: it suggests where the arms differ, it does not show which product repairs better. |
| Autonomous detection and repair (B, launches 3 and 4) | **Shown once in two.** Launch 3's planner wrote example checks the candidate also passes and no relation; nothing disagreed and the candidate was delivered. Launch 4's planner declared a relation that rejects the candidate; the first repair fixed it and the evaluator accepts the exact patch. A generated check with a wrong expectation took the other two repairs and the product reported `unresolved`. |
| Ordinary completion (C, launch 5) | **Not shown.** No relation was declared; the example checks agreed with a patch that treats line terminators as separators, the product reported `accepted`, and the evaluator rejects it. |
| Comparative benefit (D) | **Not run**: conditional on C. |

Five of eight launches, 27.1 of 120 agent-minutes; the infrastructure slot was not needed.

## Product changes, each with a regression that fails without it

- **The program's interface.** The default export is called with each case's input value itself,
  never with the case; every description the planner reads says so.
- **The runner exposes the argument mistake.** A read of a case's own field (`input`, `expected`,
  `throws`) made by the program's code on the string, number or boolean it was called with exits 4
  and names the read. Nothing is unwrapped; object inputs and the project's own reads are untouched.
- **Admission needs a real control.** An agreeing case counts only where the base's answers are not
  all one value: a program that ignores its input, builds an empty object or calls the wrong method
  answers one value for everything. Each decision names its finding (argument shape, did not load,
  did not complete, no control, contradicted expectation, does not detect) and the control it rests
  on. A check with no control is an unestablished control, not a project failure.
- **What a repair sees.** `run_check` on a generated check shows its program and what its expected
  results rest on.
- **A check shown broken stops consuming repair.** A generated check the runner shows misreading
  its input on a candidate is named; its gate keeps failing (the run cannot read as accepted), and a
  gate whose every failure is such a check stops repair, as setup failures do.
- **Each supplied check is held by the ratchet.** A repair that broke one supplied check while
  another was already failing was kept ([regressions/aggregation-before-fix.result.json](regressions/aggregation-before-fix.result.json));
  supplied checks are now parts of the acceptance gate, each held to the no-regression rule, and the
  bundle's re-deriver applies the same rule.
- **The relation tool is named** to a planner that has declared no relation (after launch 3). Launch 4
  declared one and launch 5 did not: nothing here shows it raised the rate.

The key admission regressions fail on the prior implementation `e37d43005`, where each broken check
is admitted and the run spends all three repairs on it
([regressions/admission-on-prior-implementation.json](regressions/admission-on-prior-implementation.json)).

## The development contract

[development-checks.mjs](development-checks.mjs): 2026-10-17's counterexample, the task's rule as a
relation through the product's own runner, and a check of the behaviour the task keeps. Validated
with no model ([development-contract-validation.json](development-contract-validation.json)): it fails
the base, the faulty candidate and both 2026-10-17 deletion repairs, and passes the upstream fix.
Written by developers who knew all of them; engineered coverage, never discovery.

## Remaining weakness

A generated check with a correct control and a wrong expectation (launch 4's `foo.txt` → `text/html`
over a fixture without `txt`) is admitted and drives repair until the attempt cap. A base control
cannot see it, and nothing here judges an expectation. Detection still depends on the planner
declaring the relation, which it did in one of the three seeded or ordinary runs here.

## Records and reproduction

The launches' streams, ledger copies and every blob of their sessions are in one pack,
[packed-derived/launch-streams](packed-derived/launch-streams/inventory.json); summaries, contracts,
patches, verdicts and readings are beside each launch. 2026-10-17's dropped planning chains (launches
3 to 5, with their blobs) and launch 4's stdout were recovered by digest into
[recovered-2026-10-17/packed-derived/recovered-originals](recovered-2026-10-17/packed-derived/recovered-originals/inventory.json);
the stdout of its launches 1, 2, 3 and 5 is not on this machine or in history, so their event streams
cannot be checked beyond the exchanges and ledgers kept ([recovery-2026-10-17.json](recovery-2026-10-17.json)).

```sh
node scripts/evidence-pack.mjs restore docs/evidence/2026-10-18/generated-check-control/packed-derived/launch-streams
node replay-launch-5.mjs --generated <restored 2026-10-17 launch-5/generated-checks.json> --out <file>
node validate-development-contract.mjs --out <file> [--patch <final.patch> --name <label>]
node run.mjs --swarm-cli <dist/cli.js> --arm swarm|opencode --mode development|seeded|ordinary --out <empty dir>
node ../../2026-10-17/repair-trust-live/score.mjs --task mime --patch <final.patch> --out <file>
```

Declared files for this work, with amendments: [scope.md](scope.md).

---

## Correction appended 2026-10-18: launch 4's repair is not correct in full

Appended by the [checking-semantics follow-up](../checking-semantics/README.md); everything above
stands as written, and the frozen evaluator's verdict on launch 4 stays `pass`
([launch-4/final-verdict.json](launch-4/final-verdict.json)).

Launch 4's exact final patch (`sha256:6a51acbda267...`) turns every line terminator into a space
before it strips the directory part and the extension's prefix. Through the public constructor,
with `application/x-newline` registered for the extension `pn\ng` and `application/x-space` for
`pn g`, `getType("file.pn\ng")` gives `application/x-newline` on the unchanged base and on the
upstream fix, and `application/x-space` on launch 4's patch. The task supports the case: a type
comes "from the extension after the last dot of the last segment, whatever characters precede
it", getType treats "every line terminator like any other character", and `define` and the rest
of the class "stay as they are". So where this record says launch 4's repair was correct ("the
first repair fixed it", "autonomous detection and a correct repair", "repair made the correct
change"), that holds for the frozen evaluator's cases and the development contract, not for this
one. Launch 1's supplied-check repair passes it.

The relation that found the omission is bounded by its fixture: under the default types a line
terminator and a space give one answer, which stops holding where both are registered extensions,
and there a correct implementation breaks the relation while the space normalization keeps it.
The expanded audit and its readings on every tree are in
[../checking-semantics/](../checking-semantics/README.md); it is exposed development material.
