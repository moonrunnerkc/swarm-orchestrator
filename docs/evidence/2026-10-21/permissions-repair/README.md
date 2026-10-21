# The permissions repair, one development trial and three fresh pairs, 2026-10-21

What this directory holds, in the order it was done, each step with no model until the launches:

1. **Corrections** to the 2026-10-20 ordinary comparison, appended to its README
   ([../../2026-10-20/ordinary-comparison/README.md](../../2026-10-20/ordinary-comparison/README.md),
   "Corrections"): the contract froze `test/` for Swarm alone, both of Swarm's requests to add a
   test were refused, OpenCode was told nothing of the kind, the reference was validated with
   its test changes included and the base's hidden failure was never executed, and the four
   denied diagnostics were refused on comments. The launch records and scores stand.
2. **Reference feasibility** ([reference-feasibility.json](reference-feasibility.json)), read four
   ways on the launch's own host: the upstream source change alone fails the project's coverage
   rule; only with its test does it pass. The claim that a source-only patch could have passed
   is withdrawn.
3. **One allowed-change policy** for both arms (`scripts/comparison/change-policy.mjs`): the same
   sentence in both task texts, Swarm's contract protecting the policy's paths and nothing else,
   every patch held to it by name at scoring, the reference held to it too, hidden material
   overlaid at scoring only and a displaced file named. Regressions in
   `scripts/comparison/change-policy.test.mjs`, `scripts/comparison/checks.test.mjs` and
   `scripts/comparison/arms.test.mjs`.
4. **The reader defect** that refused the diagnostics, fixed in `src/tools/shell-command.ts` and
   replayed verbatim in `src/tools/inline-program-denials.test.ts`.
5. **Development launch 1** on minimatch under the corrected permissions
   ([protocol.md](protocol.md), [launches.md](launches.md)): the obstruction is gone and the task
   was still not delivered; repair damaged the candidate.
6. **Three fresh tasks** from two repositories this project had never used, mined, written and
   validated with no model ([comparison/selection.md](comparison/selection.md),
   [comparison/validation.json](comparison/validation.json)), run as three Swarm/OpenCode pairs
   under one policy ([comparison/protocol.md](comparison/protocol.md),
   [comparison/README.md](comparison/README.md), [comparison/results.md](comparison/results.md)).
7. **A second product defect**, found by the pairs and fixed after their freeze
   (`src/gates/instrument-identity.ts`, `src/gates/auto-resolve.ts`): the instrument closure read
   a project's own source as its test runner's configuration.

Everything a launch produced is in the tree: launch records in `packed-derived/records/` here and
under `comparison/`; OpenCode's output streams, every launch's stderr and verdict details, the
patches, Swarm's four run ledgers, the traces, the reconstructed first implementation and its
probe reading, the mining records and the after-the-fact scoring in
[packed-derived/comparison-streams](packed-derived/comparison-streams/) (restore with
`node scripts/evidence-pack.mjs restore docs/evidence/2026-10-21/permissions-repair/packed-derived/comparison-streams`).
Payload blobs stay in the host's session store (`~/.swarm/sessions/<id>`), bound by the ledgers'
digests, and Swarm's own stdout streams stay in the runner's blob store, bound by the digests
the launch records carry; the tracked tree holds 6.0 MB of headroom and no more.

## Did Swarm deliver better code?

**Not shown.** Under the rule frozen before the pairs, no task is a Swarm win and none is an
OpenCode win ([comparison/README.md](comparison/README.md)). What the pairs put on the table:
Swarm produced two correct source trees and the stage's only complete source-and-test change
(the sinon accessor task, 18 assertions added, every check passing when scored); OpenCode
produced two correct source trees without tests and one empty tree claimed as done. Swarm's
product reported both of its correct sinon trees wrongly (exit 1 and exit 4), for one cause
fixed after the freeze, so neither counted as delivered. One stage on one local model establishes
nothing about either product in general.

## Which obstruction was removed, and what proves it

Three, in the experiment's and the product's handling of a task, none in the model:

- **The contract.** On 2026-10-20 Swarm's sealed contract made the whole `test/` directory
  immutable (chain `20261020T233810-339b33`, record 11), the task's project requires full
  coverage, and the upstream reference needs its own test to pass that rule
  ([reference-feasibility.json](reference-feasibility.json), condition b). Swarm asked for the
  test twice (records 465 and 521) and was refused. In development launch 1 under the policy,
  Swarm declared minimatch's src/index.ts together with a new `test/partial-globstar.js` and the
  declaration was accepted (session `20261021T030431-6350fc`, record 166; the trace is packed).
  In the accessor pair it declared `test/src/stub-test.js`, wrote eighteen assertions there and
  the tree passed.
- **The reader.** Four `node -e` diagnostics were denied on example paths in their comments
  (records 405, 423, 441 and 527). The fixture
  `src/tools/fixtures/inline-program-denials-2026-10-20.json` holds the four verbatim; the test
  shows each denied on a comment word under the old reading and allowed now, with a relative
  path in code still refused. In launch 1, seven inline diagnostics ran and none was denied.
- **The instrument closure.** Found by the pairs: a lint or test command's instrument closure
  followed the project's manifest as a bag of strings (sinon's knip entries name `src/sinon.js`,
  which imports every source file), so a change to one source file withheld a passing lint, the
  cycle never read green and a correct tree exited 1; with the agent's own new tests in the
  tree, restoring the "configuration" made those tests fail, the pass was withheld as unmeasured
  and a complete change exited 4. The manifest is now read by field inside the closure, and an
  escalation names the gate that withheld its pass; `src/gates/instrument-identity.test.ts`
  replays sinon's shape through both the lint and the pre-hooked test command. The comparison
  ran under the defect, and its records stand.

What the removals did not do is make the model's implementations correct, which the next section
says.

## Did repair improve correctness?

No, in four launches. In development launch 1 the first implementation (four edits,
reconstructed from the recorded edit calls and packed as `development/first-implementation.patch`)
loosened non-partial matching: the visible check's non-partial case came back true, sixteen
existing dot-file subtests failed, and the frozen probe differs from the reference on two scored
rows. The repair loop's one attempt was the model running `git checkout HEAD -- src/index.ts` on
its own file ("The current changes are broken. Let me reset to base"), after which its wall ran
out; the ratchet accepted the attempt because the tests gate passed again on the base. A wrong
implementation became no implementation: **repair damaged the candidate.** In the sinon mock
pair repair fixed lint at attempt 1 and then spent two attempts on a tree that was already green
(the defect above). In the dotenv pair one attempt changed nothing the oracle reads. In the
accessor pair the first cycle failed lint and tests and the one attempt fixed both: the only
launch where repair turned a failing candidate into a passing one, which the product then
reported as unmeasured. On 2026-10-20 repair had preserved the first implementation unchanged.

The earliest actionable failure in launch 1 is the model's own implementation inside its first
loop: the product and the harness gave it what it needed and refused nothing that mattered. No
correction is named for it and no second development launch was made ([protocol.md](protocol.md),
"If it fails"). Two product behaviours are worth naming without claiming they would have changed
that outcome: the repair loop accepted an attempt that removed every change while the task was
still not accepted, and `git checkout` of a declared file is an allowed shell command. Neither
is changed here, because the run was out of wall either way and a rule that rejects the empty
attempt would have delivered the wrong implementation instead of nothing.

## What did each competitor deliver?

| task | Swarm | OpenCode 1.14.48 |
| --- | --- | --- |
| minimatch (development, Swarm only) | nothing: a wrong first implementation, reverted by its own repair | not run |
| sinon mock per-call behaviours | a correct fix in `mock.js` and `stub.js`, no test, exit 1 | a correct fix, no test, exit 0 claimed |
| dotenv fast-parser line ends | a partial fix (visible check passes, four project assertions and the sealed cases fail), no test | a partial fix, killed at the wall, visible and sealed cases fail, no test |
| sinon stubbed accessor calls | a correct fix with eighteen new assertions in the project's own test file, every check passing when scored; exit 4, no claim | nothing changed, exit 0, success claimed |

## Time and token costs

| launch | arm wall | tokens (as the server counted them) |
| --- | --- | --- |
| development 1, minimatch, Swarm | 8.2 min | 1,992,179 |
| sinon mock, Swarm / OpenCode | 8.2 min / 2.6 min | 1,773,288 / 904,352 |
| dotenv, OpenCode / Swarm | 9.0 min (killed) / 8.1 min | 2,086,224 / 1,713,835 |
| sinon accessor, Swarm / OpenCode | 5.9 min / 4.4 min | 1,457,785 / 26,376 |
| **total, 7 launches** | **46.4 min** of the 90 allowed; readiness 11.4 s apart | **9,954,039**, every call reporting usage |

No call reported unknown usage. Swarm's figures include its planning, repair and final
verification inside its wall.

## Claims that remain unproven

- That Swarm delivers better code than OpenCode on these tasks, or in general.
- That the instrument fix turns the accessor result into a win: it would have let the product
  accept the tree it had, and the rule needs an exit 0 with a claim; replication under a fresh
  freeze on a fresh task is the next step.
- That the Linux reading of the minimatch reference (coverage failures for the complete
  reference) is right or wrong: not reproduced here, bounded to that platform.
- That the allowed-change policy catches every way of weakening a test suite: it rejects what it
  names (deleted assertions not re-added, skip markers, coverage exclusions, altered test
  scripts and runner configuration) and nothing else; a test rewritten to assert less with the
  same number of assertion calls passes it, which is the judge this project does not build.
- That the instrument closure is now right for every project: it still follows a lint
  configuration's list of linted files as configuration (three of sinon's utility modules and
  one test helper remain in its lint closure), which did not affect these tasks.
- That the fresh tasks are unseen by the model: they are unseen by this project; the upstream
  commits are public and date from May to October 2026.
