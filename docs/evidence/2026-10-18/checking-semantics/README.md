# Checking semantics, 2026-10-18

Follow-up to [generated-check-control](../generated-check-control/README.md) on draft PR #89,
reviewed at `c69e14d4a`. Every record here is a **development record on an exposed task** (mime,
with node-tar for structure): the tasks, their faulty and deletion-based patches, launch 4's space
normalization and every evaluator are known to the people developing Swarm. Declared files and
amendments: [scope.md](scope.md).

## Three findings, reproduced

| | finding | reproduction | root cause |
| --- | --- | --- | --- |
| A | Checking changed the project's behaviour. | Through the runner, `"input" in Object("hello")`, `"expected"` and `"throws"` were true for string, number and boolean inputs, and `Object.getOwnPropertyNames(String.prototype)` held `input` for every input, objects included; ordinary execution said false and nothing. Properties the prototypes already had (`length`, `toUpperCase`, `toFixed`) agreed ([reproductions/prior-implementation.json](reproductions/prior-implementation.json), `findingA`). | The runner put getters for the three names on the String, Number and Boolean prototypes, to catch a program reading `case_.input` off a string, inside the very run whose answers decide the check. |
| B | A constant base answer can be the defect. | `isPositive` returning false for every input; the change check -1 → false, 0 → false, 1 → true, admitted through `admitPlannedChecks` with the real base verifier on a git checkout: refused as `no-control`. The same sealed check, run by the same verifier, rejects the broken base and accepts the correct implementation (same file, `findingB`). | Admission required the base's answers to vary, and a defect that answers one value cannot. Variation was neither necessary nor sufficient. |
| C | Launch 4's evaluator-passing patch has a behaviour gap. | With `application/x-newline` registered for `pn\ng` and `application/x-space` for `pn g` through `new Mime(...)`, `getType("file.pn\ng")` gives `application/x-newline` on the base and the upstream fix and `application/x-space` on launch 4's exact patch ([expanded-audit-validation.json](expanded-audit-validation.json)). | The patch turns line terminators into spaces before stripping. The relation that found the omission is bounded by its fixture: where a space and a terminator are both registered, a correct implementation breaks it and the normalization keeps it. |

C is supported by the task ("from the extension after the last dot of the last segment,
whatever characters precede it"; "treat every line terminator like any other character";
`define` "stays as it is") and by the public API (`define` lowercases and accepts any characters).
The frozen evaluator's `pass` for launch 4 stands as recorded; a correction is appended to
[the 2026-10-18 README](../generated-check-control/README.md) and
[launch ledger](../generated-check-control/launches.md). No retained benchmark patch was repaired
by hand.

## What changed, and why

- **The check's own run adds nothing to the language environment.** The prototype getters moved
  to a separate argument probe (`plannedCheckProbe`), run beside admission and beside `run_check`'s
  own programs. Its answers are never compared; it reports reads, labelled with what it is and the
  limitation that a program testing for those properties behaves differently there. Admission
  refuses a program as `argument-shape` only where the probe saw the read **and** every answer was
  one value, so a program coping with both shapes (`case_.input ?? case_`) is admitted with a note.
  Nothing unwraps or replaces an input.
- **Admission keeps what a base control cannot decide, and says so.** A check whose base answers
  are one value is kept as `unestablished-control`, not refused, unless something shows the program
  broken (did not load, did not complete, the probe's reading above). Each case of a change check
  declares `changed`; a kept case must agree with the base through the same program, which is how
  launch 4's `foo.txt` → `text/html` case (its planner's own reasoning called it "preserved") is
  now refused with the base's answer. A control is kept cases agreeing through the same program
  and kind of input, or another planned check's that runs the identical program. Every decision
  records `establishes` and `unknown`; no decision claims a varying answer proves the intended API
  was called.
- **A model-asserted case the repair was told and left as it was is held.** Launch 4's wrong case
  gave the identical line on attempts 1, 2 and 3. Now the second identical reading holds it, a
  diagnostics gate whose every failure is held stops repair (the existing `instrument` class), the
  gate keeps failing so the run stays `unresolved`, and the candidate that passed everything else
  is what remains. A kept case and a case without a declared role are never held.
- **Coverage review is a planning step.** `declare_coverage_review` per behaviour: what changes,
  what stays, a plausible wrong implementation the cases pass, what tells it apart, what stays
  untested, and either a relation (sealed and enumerated over a named check's program, so it runs
  without a further tool choice) or why none applies. A planner that finishes without reviewing
  every requirement gets one bounded round; the outcome (`not-needed`, `ran`, `withheld`) and the
  limitation are recorded on the planning chain (`planned-coverage-review-v1`). The harness checks
  that a review exists and resolves, never that its words are right. It replaces the relation
  reminder that launch 5's planner saw six times.

## Validated with no model

- **The prior implementation, on the new scenarios** ([regressions/](regressions/prior-implementation-scenarios.json)):
  the launch-4-shaped hold spends all 3 repairs there (1 now); the constant defect is dropped there
  (kept and accepted on the fix now). Regression tests for each change sit beside the sources.
- **The review workflow on two fixtures** ([review-workflow-validation.json](review-workflow-validation.json)):
  a scripted planner stops without a review on mime and on node-tar; on both the round is asked for
  and runs. On mime the review's relation is enumerated: the examples accept the faulty candidate,
  the relation rejects it and accepts the upstream fix. On node-tar no relation is forced (the rule
  is numeric); the size check rejects the base and passes upstream, and the preserve check rejects
  the faulty candidate, which refuses other fields' negative values too. Developer-scripted: this
  shows the mechanism, not that a model writes such reviews.
- **The expanded audit** ([expanded-audit.mjs](expanded-audit.mjs), [validation](expanded-audit-validation.json)),
  each tree apart; the frozen evaluator's column is the verdict recorded at the time:

| tree | frozen evaluator (recorded) | original development contract | custom extension | development relation under custom types |
| --- | --- | --- | --- | --- |
| base | not scored | fails | passes | breaks |
| upstream fix | the evaluator's reference | passes | passes | breaks |
| retained faulty candidate | fail | fails | fails | breaks |
| deletion repair, 2026-10-17 launch 1 | fail | fails | fails | breaks |
| deletion repair, 2026-10-17 launch 2 | fail | fails | fails | breaks |
| space normalization, 2026-10-18 launch 4 | pass | passes | **fails** | **holds** |
| supplied-check repair, 2026-10-18 launch 1 | pass | passes | passes | breaks |

The custom-extension case is new exposed development material. The last column is a reading of
the relation, not a requirement: a correct implementation breaks it under those types.

## Live launches

Registered in [protocol.md](protocol.md) before the first launch; every launch is in
[launches.md](launches.md).

## Reproduction

```sh
node reproduce.mjs --out <file>            # SWARM_REPRODUCE_CASE_ROLES=1 on this implementation
node validate-review-workflow.mjs --out <file>
node validate-expanded-audit.mjs --out <file> [--patch <final.patch> --name <label>]
```
