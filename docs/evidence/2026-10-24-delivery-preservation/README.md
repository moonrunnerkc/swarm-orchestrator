# Delivery and preservation stage, October 24, 2026

This stage closes the delivery and preservation workflow PR #101 left open. It adds no new
controller or planning layer. It started from PR #101's head, `40e3f17a5`. Before editing, it
reproduced that stage's reported inconsistencies from the published records, from isolated calls
and from the code path ([decision note](decision-note.md)). It sealed the requirement policy
before implementing it ([check requirements](../../check-requirements.md)) and declared the files
it would touch ([intended files](intended-files.md)).

## What changed in the product

1. **One reading of inherited failures** (`check-requirement-v1`, `failure-identity-v4`,
   `run-acceptance-v6`).
   - Every sealed gate is `absolute-pass` or `no-new-regression`. Both block.
   - Static repository checks default to the second, and the tests gate to the first.
   - The loop's green, repair, escalation and verdict, the result line, the exit status and the
     bundle's verifier all read a failure through `attributeFailure`, against the same gate run
     over the base. The separate whole-output signature the loop used is gone.
   - Identities now include ESLint, Prettier and tsc diagnostics. A killed run or a `&&` chain
     that stopped early proves no inheritance.
   - A changed instrument stops it as well.
2. **Review once the candidate runs.** It no longer waits for green: a static failure no longer
   withholds it.
   - **Authority.** A finding needs an obligation the task states, and a base that answered.
   - **Expectations.** A model's expected answer, a base that raised, and an unprotected
     difference are reported, never acted on.
   - **Errors and trials.** A load error keeps its message. The reviewer can try a probe on a copy
     of the candidate before answering.
3. **Preservation accounting v2.**
   - Requested, explicit-preserve, observed and proposed obligations are kept apart.
   - No count limit; unclassified task text is retained.
   - Examples are `exercised`, never the whole statement.
   - Each status carries its measurements and the delivered patch's digest.

## Deterministic qualification

Scripted model responses, so this shows controller behaviour, not model capability. Each case runs
the ordinary command line through the real gates, ratchet, final verification and the bundle's own
`verify.mjs`:
- [`src/cli-check-requirements.integration.test.ts`](../../../src/cli-check-requirements.integration.test.ts),
  the requirement policy:
  - a failing base with exactly the same failure;
  - an added failure;
  - the same count of different failures;
  - a fixed inherited failure;
  - an incomplete chain;
  - an absolute pass.
- [`src/cli-review.integration.test.ts`](../../../src/cli-review.integration.test.ts), review and
  preservation:
  - review despite inherited lint, and despite the change's own lint;
  - a false accusation that costs no attempt;
  - an authorized change kept;
  - a counterexample repaired on the exact delivered tree;
  - more than twelve obligations kept visible, with new behaviour reported apart.

The two development false accusations of October 23 are unit cases in
[`src/agent-review.test.ts`](../../../src/agent-review.test.ts).

## Appended audit of the October 23 studies

The frozen scores stand. The [audit](audit/README.md) applies one stricter reading to every arm
with its own implementation, which imports nothing from the product. In the fresh block, every
launch the frozen scorer counted complete, in all four arms (Swarm, its control, aider, OpenCode),
adds an ESLint or Prettier finding the base does not have. The frozen rule could not see these,
because the base already fails lint. Under this reading, Swarm's eight refusals there were
correct, though for the wrong reason. The one strictly complete candidate in the confirmation
rounds is the `swarm` ufo bug fix of round 2, which Swarm refused.

## Live: a development launch, the mechanism study, and a delivery confirmation

All on `qwen3.6:35b-a3b` through local Ollama, one sequence at a time, under the October 23
budgets (720.5 s wall per launch, 8M tokens). Paid inference was $0. No launch was a setup failure
or was replaced. The implementer watched liveness only until each block had ended.

- **[Development launch](development-launch/)**, p-limit bug fix, before registration. The review
  was asked, and four probes named stated obligations. Three loaded and kept the base's answer.
  Nothing was established, and no change followed.
- **[Mechanism study](mechanism-protocol.md)**, registered at `814c6d8c7` on build `19840bdaa`.
  It ran two exposed ufo tasks, two samples, with `swarm` (`--review executable`) against
  `swarm-control`. Records are in [mechanism/](mechanism/).

  | Task, arm | Hidden pass | Strictly complete (audit) | Product accepted | Verdict | Wall | Tokens |
  | --- | --- | --- | --- | --- | --- | --- |
  | bug fix, `swarm` | 2 / 2 | 2 / 2 | 2 / 2 | 2 correct accepts | 553 s | 1.74M |
  | bug fix, `swarm-control` | 2 / 2 | 2 / 2 | 2 / 2 | 2 correct accepts | 337 s | 0.97M |
  | feature, `swarm` | 2 / 2 | 0 / 2 | 0 / 2 | 2 correct refusals | 912 s | 2.95M |
  | feature, `swarm-control` | 1 / 2 | 0 / 2 | 0 / 2 | 2 correct refusals | 866 s | 4.10M |

  Every candidate kept the behaviour the task requires kept (hidden kept check 8 / 8). One
  `swarm-control` launch made two calls of unknown usage.
- **[Delivery confirmation](delivery-confirmation-protocol.md)**, registered at `3b5cc2ae0` on
  build `d5a666588`, the feature task, one launch per arm. Records are in
  [delivery-confirmation/](delivery-confirmation/).
  - `swarm-control` was accepted and correct (280 s, 1.46M tokens).
  - `swarm` was accepted while its hidden behaviour check fails (350 s, 1.53M tokens), a false
    accept. It rebuilt `file:///C:/x?...` as given, not as `withQuery` rebuilds it, and nothing
    in the run covered that case: the supplied contract's one visible example passes.

### What the mechanism study showed

- **The chain never formed.** No launch shows the registered chain from counterexample to
  verified artifact. The review established no finding in four launches, made no false
  accusation, and the assessor found no differing case
  ([findings](mechanism/findings.json)).
- **There was nothing to find.** No candidate regressed behaviour the task requires kept.
- **First concrete failure, bug-fix task:** the probes did not load.
  - The reviewer's one trial showed `Cannot find module …/src/encoding`, from an extensionless
    TypeScript import.
  - It then submitted untried programs importing `./src/utils`, which failed the same way.
- **First concrete failure, feature task:** the probes loaded, and each case kept the base's
  answer.
- **Cost.** The review cost 158k to 220k tokens and 54 to 109 s per launch.
- **The stop rule applies.** There is no expansion and no held-out comparison.

### What the study found instead, and what was corrected

- **A check that writes to the workspace** (commit `d5a666588`).
  - **The cause.** The `build` gate runs ufo's `automd && unbuild`, and automd writes the new
    function's documentation into `README.md`. That write became part of every later candidate,
    outside the declared file set.
  - **The effect.** The ratchet rolled back seven repairs, in three of the four feature launches.
    Each had brought lint down to the base's own finding, and each had passed task acceptance.
  - **The fix.** A check's own writes are now put back, and named on its record.
  - **Confirmed.** In the confirmation, both launches delivered: one correct, one a false accept
    of requested behaviour no check covered.
- **A record the verifier could not hold** (commit `fb1c417bc`).
  - **The cause.** A reviewer's probe id, `preserves-task-keep-1-…`, matched the credential
    scrubber's `sk-…` pattern. The recorded probe contract no longer matched its digest, and that
    one bundle of eleven failed its own verification.
  - **The fix.** Admission now judges each probe by the recorder's own scrub: it renames the id,
    or does not run the probe.
  - **The same commit** also reads a `null` optional field as absent, which had dropped two live
    probes.
  - **Live status.** Neither correction has run live.

### Offline verification

Every accepted run's bundle re-derives its acceptance with its own embedded verifier. That
includes the four bug-fix acceptances that rest on the base's own Prettier finding
(`run-acceptance-v6`, `inheritance` re-derived from the `gate-baseline` record). Ten of the
eleven bundles verify, and the eleventh is the scrubber case above.

## Answers

1. **What complete behaviour now works end to end?**
   - On a project whose static check already fails on the base, a change that adds no new failure
     is accepted and says so: "no new failures established; these inherited failures remain". It
     is re-derived offline.
   - Live: four of four correct ufo bug fixes, and one ufo feature after the gate side-effect
     correction.
   - A change that adds a finding is sent back to repair with the new findings named, and the
     base's own findings marked as not the change's. A check's own writes no longer roll back a
     repair.
2. **What new behaviour was produced?** The ufo base-prefix boundary fix (four deliveries) and
   `filterQuery` (one correct delivery, one false accept). Each was measured by the hidden
   behaviour check and by tests shown sensitive against a control.
3. **What existing behaviour was verified as preserved?**
   - The base suite: no new test failure in nine of the ten delivered trees. The tenth, a refused
     feature candidate (`swarm-control`, sample 1), added two.
   - The hidden kept checks pass on all ten live candidates.
   - The review exercised stated obligations by example where its probes loaded. Those cases are
     `exercised`, not proof of the whole statement.
4. **Which observation caused which retained improvement?**
   - The review: none.
   - Product corrections:
     - The round-2 record (inherited lint refused) led to the requirement policy, and so to four
       live bug-fix acceptances.
     - The mechanism study's rolled-back repairs (`README.md` outside the file set) led to the
       side-effect correction, and so to the confirmation's deliveries.
     - The failing bundle led to the admission correction.
5. **Did that improvement repeat or transfer?** The delivery correction held in both arms on the
   bug-fix task (four of four), and on the feature task after the side-effect fix (two of two
   delivered, one correctly). The review's mechanism produced nothing to repeat.
6. **Did Swarm beat its control or a competitor, and at what cost?**
   - Against its control: no.
     - In the mechanism study the arms tied on correctness, and `swarm` spent 0.38M fewer tokens
       (4.69M against 5.07M) and 262 s more wall (1,465 s against 1,203 s).
     - In the confirmation, the control's delivery was correct and the review arm's was not.
   - No external agent was run this stage.
7. **What remains unmeasured or unsupported?**
   - **The review.** Whether it improves code: it found no real counterexample live, and its
     probes failed to load on one task.
   - **Requested behaviour no check covers.** The confirmation's false accept is one.
   - **The admission correction**, live.
   - **Held-out tasks**, refactors and other repositories under the new policy.
   - **Anything at scale.** These are counts of two to eight launches on exposed tasks with one
     model.

## Reproduce

```sh
# deterministic qualification
npx vitest run src/cli-check-requirements.integration.test.ts src/cli-review.integration.test.ts \
  src/gates/gate-side-effects.test.ts src/agent-review.test.ts
# a study, from its archived stage directory (see sessions branch)
node docs/evidence/2026-10-23-preservation-review/score-study.mjs --manifest <manifest> \
  --revealed <runs/revealed.json> --out scores.json
node docs/evidence/2026-10-24-delivery-preservation/audit/audit-study.mjs --study <stage> --out audit.json
npx tsx docs/evidence/2026-10-24-delivery-preservation/assess-review.mjs --manifest <manifest> \
  --revealed <runs/revealed.json> --out findings.json
# packed records, byte for byte
node scripts/evidence-pack.mjs restore docs/evidence/2026-10-24-delivery-preservation/mechanism/packed-derived/records
```

The session ledgers, manifests and configurations of all eleven launches are archived on the branch
`evidence/2026-10-24-delivery-preservation-sessions`
(`delivery-preservation-sessions.tar.xz`, sha256
`3456a92a0fa43306b55a8190a4065754d956859846a1b338a17ebb57f149c023`).
