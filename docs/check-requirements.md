# Check requirements: absolute pass and no new regression

Policy `check-requirement-v1`, defined on October 24, 2026 before its implementation. It changes
what a blocking check requires of a delivered tree. It is versioned: a record written before it
keeps its meaning, and the standalone verifier re-derives each record by the rule that wrote it.

## The two requirements

Every gate in the sealed gate set names one requirement. Both block acceptance.

- **`absolute-pass`.** The check must pass on the delivered tree.
- **`no-new-regression`.** The check must pass, or fail only in ways the base already fails. The
  harness runs the same check, with the same command and instrument, over the base tree in the same
  workspace. It then compares the two runs failure by failure (`failure-identity-v4`, below).

  The requirement is met where the harness proves every failure inherited:
  - each failing identity fails on the base at least as many times;
  - each fails for the same cause;
  - both runs reported completely.

  Fixing an inherited failure is allowed. Fixing one failure never offsets another: any identity
  whose count rises is a new failure.

Under `no-new-regression` a check whose inheritance cannot be established stays blocking. It is
reported as unmeasured, never as met. That covers:
- a missing base run;
- a run cut short, timed out or cancelled (recorded exit 128);
- output that names no failures the reader can hold to;
- a cause that changed;
- a command chain that stopped before its last command.

A configuration change is handled as before (`instrument-identity-v1`, `rename-transport-v1`):
- a check whose instrument the change edited is withheld and read again under the base's
  instrument;
- a pass that exists only under the change's own configuration is not a pass;
- so removed tests, a disabled rule or a narrowed glob cannot make inherited failures disappear.

## Which gate gets which requirement

Sealed before the first model call, on the `gate-set-sealed` record:

| Gate | Requirement |
| --- | --- |
| Static repository checks assembled from the project or `swarm.toml` (build, typecheck, lint, format, and added gates not declared dynamic) | `no-new-regression` |
| The tests gate and any other check that executes the code | `absolute-pass` |
| A gate the task contract lists in `requiredChecks` | `absolute-pass` |
| A `swarm.toml` gate with `requirement = "..."` | as named |
| Policy and inspection gates (file set, placeholders, secrets, diff budget), task acceptance, task diagnostics | `absolute-pass` |

**Amendment, October 24, 2026, before any run under this policy.** The first version made every
repository check, tests included, `no-new-regression` by default. The engine's own acceptance
test showed the hazard: where the base already fails a test, that test is often the task's own
subject ("fix the failing test"). As inherited, it would settle green before any repair, and a run
that changed nothing would be accepted. So a check that executes the code keeps the absolute
requirement by default. A project whose base carries an unrelated failing test can name
`requirement = "no-new-regression"` for its tests gate in `swarm.toml`, and that choice is sealed
and shown like any other.

A seal without the field is read as `absolute-pass` for every gate, which is what every earlier
run meant.

`swarm check` and `swarm gates` report on a tree as a CI job would. They have no change of their
own to attribute a failure to, so they seal every gate `absolute-pass`, as before.

## Failure identity v4

`failure-identity-v4` is v3 with two additions:
- **Diagnostic identities.** Static checks now have identities as well as test runners (TAP, spec,
  Vitest, structured).
  - ESLint's stylish report: file, rule and message, without line and column, since an edit
    moves them.
  - Prettier's `--check` report: the file.
  - TypeScript's compiler: file, code and message.
  - A file is named relative to the root both runs share.
  - A report whose own summary disagrees with what it names is incomplete.
- **Chains and stops.**
  - A run that ended at exit 128 (timed out or cancelled) is incomplete.
  - Where npm echoes a script chained with `&&`, a failure in any command but the last left the
    later commands unobserved, so the run is incomplete.
  - A script using any other shell operator is not read as a chain, and its failures are
    attributed only by whole-output equality, as before.

The implementation is `src/gates/failure-attribution.ts`. `src/evidence/verifier/status.mjs`
reimplements it independently, and parity tests hold the two together.

## Failure identity v5

Written on October 24, 2026, before its implementation. Two cases read as inherited under v4
when they were not:
- **The chain.** `eslint src && eslint test` failed in its first command. The second command never
  ran. v4 called the chain complete, because the failing tool was the tool of the last command.
- **The occurrence.** A change fixed the base's ESLint error and added one with the same rule and
  message elsewhere in the same file. v4 names ESLint problems without a location, so the counts
  matched, and the new problem read as the base's.

`failure-identity-v5` is v4 with these changes:
- **A tool name does not show which command ran.** An echoed `&&` chain is complete only where the
  failing tool's report can only have come from the chain's last command: that command runs the
  tool, and no earlier command does. Otherwise the run is incomplete, and nothing is inherited.
- **Equal counts do not show that an occurrence stayed.** A located diagnostic (ESLint, tsc) is
  inherited only where it is shown to be one of the base's occurrences:
  - The harness records the change's zero-context hunks for every file a failing diagnostic
    names, beside the attribution (`sourceChanges`). A file with no hunks is unchanged.
  - A base occurrence on a line the change did not touch moves to the line the hunks give it.
  - A candidate occurrence is the base's only where it has the same identity, the same column,
    and that moved line. Each base occurrence is matched once.
  - A rising count is still new, as in v4.
  - Any candidate occurrence left unmatched is unattributed. That includes one on a line the
    change wrote, and one whose file's hunks the harness could not read. The harness abstains
    rather than guess at a move.
- **A file-level finding** (Prettier's `--check`) is inherited only where the file is unchanged.
  A finding in a file the change edited cannot be told apart from a new one, so it is
  unattributed.
- **Where nothing was recorded.** A record without `sourceChanges` matches no located diagnostic.

Records name the rule they were written under, and the verifier reads each by that rule. A v4
record keeps its v4 reading.

**A static check the task asks to fix.** No new regression would excuse leaving the task's own
subject undone, where that subject is a static failure. So a static gate is sealed
`absolute-pass` where one sentence of the task asks for its failure to be fixed. Such a sentence
has a repair verb (fix, resolve, repair, correct, clean up, make ... pass) and names the gate or
its tool (lint, ESLint, Prettier, formatting, tsc, type errors, typecheck, build), with no negation
before the verb. This is a lexical reading, and the seal records the sentence that triggered it.
A task that asks for a static repair in other words is not detected. A `swarm.toml` requirement
or the contract's `requiredChecks` still decides over it.

## Records and verdicts

- **`gate-run`.** A failed `no-new-regression` gate carries `requirement` and
  `inheritance`:
  - the rule;
  - the digest of the `gate-baseline` record it was compared with;
  - the attribution (`inherited`, `new` or `unattributed`);
  - the new and the inherited identities.
- **`run-assessment` `run-acceptance-v6`.** Acceptance is v5, except that a blocking gate which
  failed under `no-new-regression` with an `inherited` attribution does not refuse. The verifier
  re-derives that attribution from the two records, and a recorded value it does not reproduce
  fails verification.
- **`run-acceptance-v7`.** v6, under the run's declared `known-violation-completion-v1`: a
  validated counterexample of the task's own code, open on the delivered candidate, refuses
  ([known violations](candidate-review.md#known-violations-decide-completion-every-run)).
- **The verdict says which of two results it is:**
  - "all required checks pass";
  - "no new failures established; these inherited failures remain", with each check and the
    identities that remain.

  Both are acceptances, and both exit 0.

The same reading decides every stage of the run:
- **Repair.** An inherited failure is not handed to a repair attempt as the change's to fix.
- **Escalation and the run's verdict.** Both refuse on the same failures.
- **Final independent verification.** It already reads regressions this way.
- **The standalone verifier.** It re-derives the same reading from the records.

## What this does not do

It does not repair the base. An inherited failure stays named in the result until someone fixes
it. It does not make a failing check advisory. It does not apply to a check the task contract
requires, and it does not reinterpret an earlier record.
