# Repair value, 2026-10-19

Follow-up to [checking-semantics](../../2026-10-18/checking-semantics/README.md) on draft PR #89.
Every record here is a **development record on an exposed task** (mime). Declared files and
amendments: [scope.md](scope.md). Three kinds of evidence are kept apart throughout:
**deterministic** (no model: tests, replays of recorded transitions, scripted scenarios),
**scripted-model** (the product driven by a scripted endpoint) and **live-model** (the registered
launches, [protocol.md](protocol.md), [launches.md](launches.md)).

## 1. O1, every candidate

Rebuilt from O1's packed ledger with no model ([reconstruct-o1.mjs](reconstruct-o1.mjs)): each
stage's recorded edits applied in order, and repair 3's file from its own recorded `git diff` plus
the formatter command it ran. Every rebuilt tree is the tree O1's own checks pinned, so each row is
bound to the candidate the product judged ([o1/o1-candidates.json](o1/o1-candidates.json)). External
scores were computed afterwards, apart ([score-candidates.mjs](score-candidates.mjs),
[o1/scores/](o1/scores/scores.json)); none reached the product.

| stage | `src/Mime.ts` blob, pinned tree | patch | generated checks (relation A, cases, preserve, relation B) | what the next brief named | ratchet | frozen evaluator | custom extension | model calls, tokens, response time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| first implementation | `54e61a8`, `cde62f18` | `sha256:713e69d5...` | pass, **fail (case 7 only)**, pass, pass | case 7, `"/usr/local/bin/script.js\n"` → `text/html` (a changed case the task does not support) | (first) | **pass** | pass | 14, 117,019, 28 s |
| repair 1 | `a88e54b`, `5a84034e` | `sha256:1ee7f3ef...` | **fail**, fail (case 7), pass, **fail** | both relations, and case 7 held | kept: the gate failed before and after, no parts | **fail** (5 of 113: a terminator after the extension) | pass | 30, 531,188, 120 s |
| repair 2 | `a88e54b`, `5a84034e` (no file changed) | as repair 1 | as repair 1 | as repair 1 | kept: nothing moved | fail | pass | 33, 514,636, 73 s |
| repair 3 | `c66bacc` and 7 formatted files, `ce43b392` | `sha256:807a9d5f...` | pass, fail (case 7), pass, pass | (last) | **rolled back**: the file-set gate failed (7 files outside the set) and the build gate read not-applicable (`tsconfig.json` changed) | fail, on scope | pass | 40 (stopped at max steps), 743,494, 100 s |

Repair 1 is where an evaluator-passing candidate became a failing one. It was told one wrong
changed case, stripped trailing line terminators, and broke both relations that had held. The
product-visible observation that could have prevented it is exactly that: the two relation checks,
accepted on the first implementation and rejected on repair 1, while the case repair 1 was told
gave the same answer. Repair 3's `src/Mime.ts` alone passes both external readings
([o1/diagnostic/](o1/diagnostic/scores.json), never a product candidate), but its candidate also
held seven formatter-rewritten files, so its rollback was correct, and the frozen evaluator refuses
it too. O1's own summary of these repairs was incomplete; the correction is appended to
[its README](../../2026-10-18/checking-semantics/README.md) and [ledger](../../2026-10-18/checking-semantics/launches.md).

## 2. O1's transitions through the controllers (deterministic controller verification)

[replay-o1.mjs](replay-o1.mjs) drives one built product on the real mime project with a scripted
endpoint: O1's 21 planner responses verbatim (the sealed contract's digest comes out as O1's,
`sha256:37ecd701...`, so every candidate meets O1's own checks), then the recorded transitions by
content: the first loop writes `54e61a8`, repair 1 writes `a88e54b`, repair 2 changes nothing,
repair 3 writes `c66bacc` and runs `npx prettier --write .`. Every check runs on the actual tree.
This is not live repair: the scripted transitions do not react to what they are told. The delivered
patch was scored apart ([analyze-replay.mjs](analyze-replay.mjs), [replay/](replay/)).

| build | repair 1 | repair 2 | repair 3 | delivered | stop | result | frozen evaluator on the delivered patch |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `df2e3b619` (O1's) | kept | kept | rolled back | `a88e54b`, raw patch `sha256:4f5a3be4...`, O1's delivered patch byte for byte | attempt cap | `unresolved` | fail |
| `f556b6313` (PR #89's last local commit) | **rolled back**: both relations passed before and failed after | kept (no change), and case 7 held on the restored tree | not asked | `54e61a8`, the first implementation | every failure held (filed as `instrument`) | `unresolved` | **pass** |
| the frozen build of this work | see [replay/](replay/README.md) | | | | | | |

On `f556b6313` the second repair's brief names the rollback ("Attempt 1 was rolled back ... the
rejected change is not in the files you will read"), the kept-candidate record holds repair 1's
file, and the run reports `unresolved` while a generated expectation stays disputed. The current
controller therefore already prevents O1's captured regression; no product change was made for O1.
The rejected candidate's kept record differs from the candidate in one place: the evidence
scrubber redacts `[key: string]` in `src/Mime.ts` as a credential assignment (invariant 9's
known-pattern rule). The pinned tree identifies the candidate exactly; the kept file is not
byte-exact.

## 3. The stopping and protection policies

**The hold rule** ([policy-audit/hold-rule-before.txt](policy-audit/hold-rule-before.txt), then
[after](policy-audit/hold-rule-after.txt); scripted-model). At `f556b6313` a changed case was held
once a repair left its answer unchanged, even where the repair had changed the code, and the stop
was filed as `instrument`, the class of a defect in the checking itself. 2026-10-18 launch 4's
repairs 1 and 2 each edited `src/Mime.ts` and were held on the answer alone. Two tests reproduce it:
a valid expectation (10 small) whose repair takes two changes was stopped after the first, and a
wrong one (13 small) was stopped after one code-changing repair. Now (`10ee69729`) a case is held
only where it is read again on the very tree it was told to a repair on, that is, where the repair
left the code as it was, and the stop is `held-expectation`. The valid two-step repair is accepted
after its second change; the wrong expectation is bounded by the attempt cap (three repairs, one
rolled back for breaking a kept case) and the run is `unresolved`. The four classes stay apart: a
checking-program defect (`instrument`, from the probe or a program that does not load), an
expectation contradicted by the base (refused at admission), an unsuccessful repair (asked again
until the cap), and a stopping decision (`held-expectation`, the cap, the budget). An unchanged
answer is never read as the expectation shown wrong.

**Relations and kept cases** ([policy-audit/relation-limit.mjs](policy-audit/relation-limit.mjs),
scripted-model on the real mime project). With the expanded audit's custom-extension fixture
(`pn\ng` and `pn g` both registered), where newline-to-space equivalence is false for a correct
implementation, a planner's relation asserting it is admitted (it fails on the base, as a change
relation must). At `f556b6313` launch 4's space normalization passes it, and the correct repair,
which restored the kept case `file.pn\ng` → `application/x-newline` that the base gives, was rolled
back for breaking the relation: a claim that passed first outranked behaviour the base showed. Now
(`193bfbe4e`) the diagnostics gate names a relation the base did not hold as a claim part, which
yields to an attempt that turns a failing part the base or a supplied check backs into a pass; it is
held as before against a repair that restores nothing, which is O1's case. The yield and the claims
are on the decision, and the bundled verifier re-derives them; decisions from `df2e3b619` and
`f556b6313` re-derive as they did. The run still reports `unresolved`, since the false relation
keeps failing. Identities are unchanged: a part is a check of the sealed contract, read on a pinned
tree; nothing is promoted to a supplied check's authority (a planned requirement stays `unjudged`),
and no equivalence is applied outside the program and fixture it was sealed with.

**Stopping and rollback cannot make a run accepted.** The final status comes from a fresh
verification of the delivered tree and the blocking diagnostics gate (the replay's chain: the last
`independent-verification` is on the delivered tree, and the assessment is `escalated`). Held,
capped and rolled-back runs above all end `unresolved`.

**The argument probe** (deterministic and scripted-model). It runs in its own Node process, after
the planned checks, and every goal check starts from `git read-tree --reset -u <tree>` with the
checkout restored from a snapshot, so its prototype getters, module state and files never reach the
authoritative run; its answers are never compared, and `run_check`'s use of it is the worker's own
diagnostic, not a gate. A false rejection was reproduced
([policy-audit/probe-before.txt](policy-audit/probe-before.txt)): a valid preservation whose program
falls back (`word.input ?? word`) and whose every answer is legitimately null is refused as
`argument-shape`. A second probe pass with the field given was built and withdrawn before commit:
on the base, launch 5's broken program answers that pass the same way, so it would have admitted the
defect the refusal exists for. Where the project answers the input and `undefined` alike, no answer
tells the two apart; only tracing the project's calls could, which this work does not add. The
refusal stays, its reason now says the fallback is not told apart, and the revision is admitted
([after](policy-audit/probe-after.txt)). The constant-on-base defect remains usable: a check of one
value is kept with its control recorded as unestablished, and that limitation is reported with it.

## 4. Live launches

Registered in [protocol.md](protocol.md) before the first launch; none had run when this was
written.

## Remaining limitations

- A generated changed case's expectation, and a change relation, are the planner's claims; no base
  control judges them. A wrong one that the code can satisfy without breaking a kept case or a
  supplied check is satisfied, and the run reads `accepted`.
- A claim relation yields only where something the base or a supplied check backs improves. Where a
  repair breaks a wrong relation and fixes only another claim, the earlier candidate is kept.
- A passing blocking gate cannot regress (invariant 7): a repair that fixes a supplied check while
  turning a fully passing diagnostics gate to failing is still rolled back.
- The argument probe cannot tell a fallback program from a broken one where the project answers
  both alike; the valid one is refused and must be revised.
- The product records no candidate's bytes. The per-candidate scoring rebuilds them from the chain
  and keeps only exact rebuilds; a candidate changed by a shell command, or whose kept record the
  scrubber touched, is reported as not recovered ([o1/score-launch-validation.json](o1/score-launch-validation.json):
  O1's repair 3).
- Everything is one exposed task; nothing establishes general completion or comparative benefit.
