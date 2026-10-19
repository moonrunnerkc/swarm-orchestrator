Follow-up to #88 (merged at c89a0897b): fixes to the status contract, the repair loop and first runs, found by auditing #88 and by five live development launches; plus a relation check for `--plan-checks`. 31 commits, c89a0897b..e37d43005.

## Problems and changes

**Status contract.** Planned requirements were sealed as goal obligations with no deciding check, so certification (and the bundled verifier mirroring it) could never accept them:
- a complete supplied contract with `--plan-checks` could not end `accepted`;
- `--plan-checks` alone ended `partially-checked` (exit 1), where the same run without it ended `unjudged` (exit 0).

Planned requirements are now hypotheses: no obligation, reported with their generated checks, deciding nothing either way. `verify.mjs` mirrors this, and a planned requirement naming deciding checks is refused at the contract boundary and by the verifier.

| run | status | exit |
| --- | --- | --- |
| acceptable, no supplied requirement (none, or only agreeing hypotheses) | `unjudged` | 0 |
| acceptable, every supplied requirement met | `accepted` | 0 |
| a supplied check, blocking gate, policy or the final verification refused it | `not-accepted` | 1 |
| model or verification environment unavailable | `unverified` (new) | 4 |
| a generated check disagrees, nothing that decides refused | `unresolved` | 1 |
| a supplied requirement decided by no check that ran | `partially-checked` | 1 |

**Repair loop:**
- The rollback brief shows the rejected change as a bounded diff, and every repair brief shows the current change against the base. Both were previously named only by a digest, which no worker can read; in launch 1 every repair took the injected design for the project's own code.
- A supplied command check's refusal carries its own output; it reached the repair as "command exited 1".
- Generated checks run as their own blocking gate, `task-diagnostics`. Sharing `task-acceptance`, a repair that broke a supplied check while chasing a generated one left the gate failing as before, and the ratchet kept it (launch 3). Accepted repairs that only a generated check asked for are named in the outcome (`repairsForGeneratedChecksOnly`).
- A turn the server cut off mid-answer (no tool call, no finish reason) is sampled again, never read as the model finishing. In launch 4, Ollama's "qwen tool call parsing failed" truncation ended planning silently.

**Detection.** `declare_planned_relation`: seed strings, a reference text and variants the task says behave like it. The runner inserts each at every position of every seed and compares results on the same tree. No expected value is written or taken from the base. It is bounded at 2058 calls, controlled by agreement somewhere on the base, and stays a diagnostic. Whitespace can be written as code points: a live planner's space and line terminators arrived empty eleven times.

**Execution:** `run_check`'s program and string inputs answer to the same path policy as `node -e`; a `.env` read through it ran unchecked.

**First run** (found by walking the install routes from GitHub):
- a shallow source build printed the release's version line;
- a misspelt last flag was told it "needs a value";
- a repository with no manifest exited 1 (now 4, as `swarm check`).

**Other:** the verdict no longer says "nothing executed the change" for a gate that executed it and failed. The README separates bundle integrity from code correctness, adds `unverified`, links a troubleshooting section, and names the npm release.

## Compatibility

`outcome.status`, `unverified` and `repairsForGeneratedChecksOnly` are additions in unreleased 14.5.0.

Against 14.4.0:
- a `--plan-checks` run accepted on its own checks now ends `unjudged`, still exit 0;
- `unverified` and no-manifest runs exit 4 where they exited 1;
- goal-contract runs with generated checks seal one more gate, `task-diagnostics`.

Historical bundles verify unchanged: every new verifier rule applies only to contracts with `planned`.

## Validation

`npm run gates` at e37d43005: checks pass (zero doc-path misses, 6.0 MB weight headroom, 94 packs restore, 15 cited bundles verify), typecheck clean, lint with the same 28 warnings as the base, 462 test files passed and 5 skipped, 4432 tests passed and 29 skipped. `npm run build`, `check:packaged` and `fuzz:build` exit 0.

Each defect above has a regression test that fails without its fix. The gate split's test was run against the pre-split commit and fails there.

Install routes walked from GitHub and the registry in a disposable root: `docs/evidence/2026-10-17/repair-detection-live/remote-install.json`.

## Live launches (local qwen3.6:35b-a3b, no paid API): 5 of 8, 44.9 of 120 agent minutes

| # | experiment | minutes | prompt / completion tokens | result |
| --- | --- | --- | --- | --- |
| 1 | repair with a supplied counterexample | 9.8 | 1.96M / 31.7k | product `accepted`; evaluator rejects (repair deleted line terminators) |
| 2 | same, after the diff-in-brief fix | 6.8 | 1.38M / 18.1k | product `accepted`; evaluator rejects (same reading); R not shown |
| 3 | seeded detection and repair | 13.3 | 2.43M / 51.9k | live example check found the omission; repair broke the supplied check; `not-accepted` |
| 4 | same, corrected build | 1.2 | 11.0k / 0.1k | invalid: server truncated a tool call; the product read it as done |
| 5 | replacement (reserve) | 13.8 | 2.33M / 48.3k | live relation found the omission; repair made no effective change amid 3 broken generated checks; `unresolved` |

The ordinary run and the paired comparison were conditional on detection and repair succeeding, and were not run. Records: `docs/evidence/2026-10-17/repair-detection-live/`.

## Limitations

These are development records on an exposed task, not comparative evidence. Supplied-counterexample repair and end-to-end repair are not shown. The next blocker is an admitted generated check whose program never reaches the project's real behaviour (an empty `new Mime()`), which passes its base control when its cases expect the degenerate value.

The evidence trims the stored stdout to its result line and drops the planning-ledger copies to stay within the weight check. Digests and sizes are recorded in `stdout-trimmed.json`.

Pushes to this branch report "Bypassed rule violations ... Cannot update this protected ref": the repository's `restrictdelete` ruleset covers every branch and the owner account is its bypass actor. No override flag was used, and nothing was merged or published.

## Follow-up, 2026-10-18 (e37d43005..c69e14d4a)

**Correction.** The launch-5 explanation above ("an empty `new Mime()`") is wrong. The sealed example checks returned `Mime.getType(case_.input)` for string inputs, so every call passed `undefined`, and their null-expecting cases passed on the base by accident. Changing only `case_.input` to `case_` passes 7/7, 9/9 and 3/3 on the upstream fix, replayed through the product's runner on the real project. The correction is appended to the 2026-10-17 record, whose original text stands.

**Changes**, each with a regression that fails without it:
- The check program's interface now says, everywhere the planner reads it, that the default export receives each case's input value itself.
- The runner exits 4, naming the read, when the program's own code reads a case field (`input`, `expected`, `throws`) off the primitive it was called with. Nothing is unwrapped, and object inputs and the project's own reads are unaffected.
- Admission counts an agreeing case as a control only when the base's answers are not all one value. A program that ignores its input, builds an empty object or calls the wrong method gives one answer everywhere. Each decision now records a finding (argument shape, did not load, did not complete, no control, contradicted expectation, does not detect) and its control. On e37d43005 the key regressions are admitted, and the run spends all three repairs on them.
- `run_check` on a generated check shows its program and what its expectations rest on.
- A generated check the runner shows misreading its input on a candidate is named. Its gate keeps failing, so the run ends `unresolved` rather than `accepted`, and a gate whose every failure is such a check marks itself `unrepairable`, which stops repair.
- Supplied checks are parts of the acceptance gate, and the ratchet holds each one; the bundle's re-deriver applies the same rule. Reproduced first: a repair broke one supplied check while another was already failing, and the ratchet kept it.
- While no relation is declared, the planner's answers name `declare_planned_relation`.
- The local-ollama corpus is packed losslessly (300 files restore byte for byte) to make headroom for the evidence. The planning chains 2026-10-17 dropped were recovered by digest; four stdout streams were not recoverable and are named.

**Development contract.** Developer-authored and exposed: the counterexample, the task's rule as a relation and preserved behaviour. With no model, it fails the base, the faulty candidate and both 2026-10-17 deletion repairs, and passes the upstream fix.

**Live launches** (local `qwen3.6:35b-a3b`, new protocol: 5 of 8, 27.1 of 120 agent-minutes). All are development records on an exposed task.

| # | run | result | evaluator on exact patch |
| --- | --- | --- | --- |
| 1 | Swarm, supplied development checks, injected candidate | `accepted` after 2 repairs (one rolled back) | pass |
| 2 | OpenCode, same tree and checks | ended 34 s in: a mistyped path outside the workspace was auto-rejected and the run stopped; candidate unchanged | fail |
| 3 | Swarm, seeded, `--plan-checks` | examples only, no relation; nothing disagreed; `accepted` | fail |
| 4 | Swarm, seeded, after the relation reminder (retry slot) | planner's relation found the omission; repair 1 fixed it; `unresolved` (one generated check with a wrong expectation) | pass |
| 5 | Swarm, ordinary, `--plan-checks` | no relation; wrong patch reported `accepted` | fail |

Shown on the exposed task: repair against supplied checks (1), and autonomous detection followed by repair, once in two seeded runs (4). Not shown: ordinary completion (5), and comparative benefit; the fresh comparison was conditional and not run. One pair (1 and 2) cannot establish that either product repairs better. Remaining weaknesses: a generated check with a real control and a wrong expectation still consumes repairs, and planners declare the relation unreliably. Records: `docs/evidence/2026-10-18/generated-check-control/README.md`.

**Validation at c69e14d4a.** `npm run gates` exits 0. Checks pass (zero doc-path misses, 15.5 MB headroom, 97 packs restore, cited bundles verify). Typecheck is clean, and lint shows the same 28 warnings, none in a changed file. 462 test files pass and 5 are skipped; 4449 tests pass and 29 are skipped. `npm run build`, `check:packaged` and `fuzz:build` exit 0.

## Follow-up, 2026-10-18 night and 2026-10-19 (c69e14d4a..HEAD)

All records are development records on an exposed task (mime) unless named otherwise. Evidence: `docs/evidence/2026-10-18/checking-semantics/README.md` and `docs/evidence/2026-10-19/repair-value/README.md`.

**Checking semantics (2026-10-18 night, to f556b6313).** A planned check's own run no longer adds prototype getters; a separate argument probe names misreads. Admission keeps one-valued checks with their control recorded as unestablished, and each case declares `changed`. Planning asks for a coverage review. Two pre-registered ordinary runs on df2e3b619: O2 delivered a correct patch; O1 delivered a wrong one, reported `unresolved`, after a repair broke a correct first change. A relation and each check's kept cases became ratchet parts afterwards (6a85f27a9).

**O1, rebuilt.** Every O1 candidate was rebuilt from its packed ledger and bound to the tree O1's checks pinned. Repair 1 is the correct-to-incorrect transition: told one wrong changed case, it broke both relations that had held, and the ratchet kept it. The earlier account omitted two facts. Repair 2 changed no file. Repair 3's `src/Mime.ts` was right, but the candidate also held seven formatter-rewritten files and was rightly rolled back. A correction is appended to that record; the frozen verdicts stand.

**Deterministic controller verification (no model).** O1's 21 planner responses were served verbatim, which reproduces O1's sealed contract digest, and its candidate transitions were scripted by content, all on the real project. Results:

| build | repair 1 | delivered | result | frozen evaluator |
| --- | --- | --- | --- | --- |
| df2e3b619 | kept | O1's patch, byte for byte | `unresolved` | fail |
| f556b6313 | rolled back | the first implementation | `unresolved` | pass |
| e2b0fe77c (frozen build) | rolled back | the first implementation | `unresolved` | pass |

The controller at f556b6313 already prevented O1's regression; no change was made for O1.

**Changes, each reproduced first:**
- **Hold rule.** A changed case was held once a repair left its answer unchanged, even after a repair that changed the code (launch 4's did). The stop was filed as `instrument`, the class for checking defects. A case is now held only when it is read again on the tree it was told to a repair on, and the stop is `held-expectation`. A valid two-step repair now completes; a wrong expectation is bounded by the attempt cap and the run ends `unresolved`.
- **Relation authority.** On real mime with no model: a planner relation false in its own fixture (the expanded audit's custom extensions) passed launch 4's wrong normalization. The correct repair, which restored a kept case the base gives, was rolled back. A relation the base did not hold is now a claim part. It yields to an attempt that restores a part the base or a supplied check backs, and is held otherwise, so O1 stays protected. **Output change:** decisions record `parts.claims` and `yielded`, and the bundled verifier re-derives them. Decisions from df2e3b619 and f556b6313 re-derive as before.
- **Argument probe.** The probe is isolated: own process, checkouts reset between checks, answers never compared. It refuses a valid fallback program (`x.input ?? x`) whose answers are legitimately one value. A fix was built and withdrawn: on the base it admitted launch 5's broken program too, since no answer tells the two apart there. The refusal stays; its reason now says so.

**Live launches (local `qwen3.6:35b-a3b`, Ollama, no paid API).** New protocol on the frozen build e2b0fe77c: 4 of 5 launches, 34.9 of 75 agent-minutes.

| # | run | product | external evaluation |
| --- | --- | --- | --- |
| R1 | ordinary mime | `accepted`, 0 repairs | frozen evaluator and custom extension pass |
| R2 | ordinary mime (repetition) | `unresolved`, 2 repairs | pass; a wrong generated case kept it unresolved |
| C1 | Swarm, marked (fresh paired task) | `not-accepted` | hidden oracle fails: the `text` rule was not changed |
| C2 | OpenCode, same task and limits | success claimed | hidden oracle passes |

The two-run criterion as registered is met: both ordinary patches pass. Only R1 ended `accepted`, and the task is exposed. Comparative benefit is not shown; on the one fresh task OpenCode passed and Swarm did not. Swarm's first concrete failure was in planning: the task calls the scheme rule existing behaviour, the base does not satisfy it, and the check declared as preserved was refused against the base, leaving that part uncovered.

**Repair value (within-run, external scores, never given to the product).** Across O1, R1, R2 and C1, no repair turned an incorrect candidate correct. O1's harmful repair was kept on its build. R2's harmful repair (it reverted the change) was rolled back on the frozen build. R2's repairs cost 1.14 million tokens and about 8.5 minutes for no change in correctness.

**Validation.** `npm run gates` on a1e6c9608 (the product commits; later commits change docs only) exited 0: checks pass, typecheck is clean, lint shows the same 28 warnings, 462 test files pass and 5 are skipped, 4487 tests pass and 29 are skipped. `build`, `check:packaged` and `fuzz:build` exit 0. The final branch head's run is in `docs/evidence/2026-10-19/repair-value/verification-final.md`.

**Remaining limitations.**
- A wrong generated expectation the code can satisfy without breaking a base-backed part still reads `accepted`.
- A task's false claim of existing behaviour leaves a check refused and the behaviour uncovered (C1).
- A run that spends its wall in the worker loop ends with gates unrun.
- The product records no candidate bytes; the per-candidate scoring keeps only exact rebuilds.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
