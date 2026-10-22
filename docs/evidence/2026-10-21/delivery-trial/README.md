# The development trial on the exposed accessor task: not delivered in two launches, 2026-10-21

Registered in [protocol.md](protocol.md) before any inference, every launch in
[launches.md](launches.md), the task's validation in [validation.json](validation.json), the
records in [records/](packed-derived/records/) and [launch-2/records/](launch-2/packed-derived/records/), every payload in
[packed-derived/payloads](packed-derived/payloads/). The question was whether ordinary Swarm,
with every deliverable stated and the audited API requirement held by a hidden check, produces
a complete implementation and meaningful tests on `sinon-bugfix-stub-accessor-calls-v2`,
satisfies that requirement, and finishes with the correct product verdict. Two launches were
allowed; both were used; neither delivered. The fresh Swarm/OpenCode pairs the protocol
conditions on a success were not run.

## The two launches, item by item

| item ([protocol.md](protocol.md), "Evaluation") | launch 1 (`d2437c430`) | launch 2 (`643b9ef4c`, after amendment 1) |
| --- | --- | --- |
| 1 artifact correctness: sealed tests, hidden API check, project suite on the overlaid tree | **pass** (all three) | **fail**: one sealed case, `.resetBehavior cleans stubbed getter and setter spies`; the API check, run apart on the tree, passes |
| 2 the delivered tree's own reading: visible check, `npm run test-node` | visible passes; **suite fails** (7 of the run's own 9 new cases) | both pass |
| 3 test quality: assertions added; added cases fail on the base's source and pass on the delivered | 17 added; of the 9 cases, 7 fail on the delivered source on their own errors, so the differential reading is not made | **0 added: no test written** |
| 4 product verdict | exit 1, not accepted: **correct** (the tree fails its own suite) | exit 0, accepted: **wrong against the task** (a stated deliverable missing, a sealed case failing); correct against every check the product sealed |
| 5 delivery | **no** | **no** |
| 6 repair | attempts 1 and 2 turned lint and tests green and were **rejected by a wrong measure** (the assertion count did not include referee's `refute`); the first tree was delivered: repair did not change the artifact | one attempt fixed the lint error and returned; it did not resume the unwritten test: repair preserved the artifact's incompleteness |
| 7 arm wall, tokens | 455.9 s; 2,197,049, one call without usage (a lower bound) | 216.4 s; 912,945, every call reporting |

Costs of the trial: 11.2 of the 60 agent-minutes, 2 of the 6 launches; readiness 8.3 s and
1,506 tokens apart; no relaunch, no scripted correction, no server restart.

## What each launch showed, and what was corrected

**Launch 1** wrote a correct implementation on its first loop: `stub.getter` and `stub.setter`
are spies made by `spy(fn)` from `src/sinon/spy.js`, and the tree passes the sealed upstream
tests, the audit's API check and the project's suite when the sealed test file is overlaid.
Its own nine new test cases carried four lint errors and three runtime errors (a method referee
does not have, `assert.isNotUndefined`; `obj` for `myObj`; an unassigned `stub`; a bare
expression). Both repair attempts fixed every one of them, lint and tests turned green, the
independent verification read `regression pass`, and the ratchet rejected both as "assertions in
the touched test files fell from 558 to 557": the repair had replaced the two
`assert.isNotUndefined` calls with referee's `refute.isUndefined`, and the product's assertion
measure (`src/gates/measures.ts`) counted `assert`, `expect` and `should` and not `refute`,
which the comparison's own policy counter already counted. The run delivered its first tree
and the product refused it, rightly, for failing its own suite. The measure is corrected in
`643b9ef4c`, with a regression test replaying the two versions of the test; the trace shows the
rejection is the earliest actionable failure, and amendment 1 names it as the correction that
licensed the second launch.

**Launch 2**, on the corrected build, ran out of steps before the test. The first loop's 40
steps went to reading (steps 1 to 22), the implementation (23 to 35), the visible check and the
suite (36 to 37) and locating where to put the regression test (38 to 40), where the cap fell.
The repair loop fixed the one lint error in seven steps and returned; the product's gates then
had nothing to object to (lint and tests pass, the ratchet's floor for assertions is the base's
count, the visible check passes), the independent verification read `regression pass`, and the
product accepted the tree with exit 0. The tree has no regression test, and its `resetBehavior`
clears the exposed spies only under a condition the sealed test's stub does not meet, which the
sealed test catches and no check the product ran could. The step cap and the repair loop's
scope are product behaviour as designed: a loop that ends at its cap is followed by repair of
failing checks, not by a resumption of unfinished work, and a deliverable stated in prose is not
a sealed check. Neither is changed here; both are named below as what the next correction
would have to address, and neither licenses a third launch under this protocol.

## Plain answers

- **Did Swarm produce a complete correct change?** No. Launch 1's source is correct and its
  tests are broken; launch 2's tests are absent and its source fails one sealed case.
- **Did it correctly accept that change?** Launch 1: it correctly refused a tree that fails its
  own suite. Launch 2: it accepted a tree that meets every check it sealed and not the task,
  which is a wrong verdict against the task and a verdict the product could not have made
  otherwise without a check it does not have.
- **Did repair improve the delivered artifact?** No. In launch 1 it produced a better tree twice
  and a wrong measure threw it away; in launch 2 it fixed a lint error and left the deliverable
  unwritten.
- **Did it outperform the comparator under the frozen conditions?** Not measured: the fresh
  pairs were conditioned on a delivery that did not happen. The stage of the morning
  ([../permissions-repair/comparison/README.md](../permissions-repair/comparison/README.md))
  stands as the latest comparison: no Swarm win, no OpenCode win.
- **What remains unproven?** That ordinary Swarm delivers a complete source-and-test change on
  this task at all; that the corrected assertion measure is sufficient (launch 2 never reached
  a ratchet decision on a repair); that a step cap of 40 is enough for a task whose
  implementation takes 35 steps of a 40-step loop; and that a deliverable stated in the prompt
  can be held by the product, which has no sealed check for "a regression test was added".

## Hypotheses, recorded and unmeasured

- The repair loop could resume a first loop that ended at its step cap with the task's
  deliverables unmet, rather than only repairing failing checks. That is a change to the loop's
  contract; it is not made here and it is not tested.
- A sealed check for the regression-test deliverable (assertions added in test files, as the
  comparison's policy counts them, held at acceptance) would have refused launch 2's tree. The
  product's planned-checks workflow is the place such a check would come from; the ordinary
  configuration has none. Not made here.
- The step cap is a product default the protocol froze at 40. Raising it to obtain a pass is
  excluded by the protocol; whether 40 is right for tasks of this size is a question for a
  protocol that varies it on purpose.
