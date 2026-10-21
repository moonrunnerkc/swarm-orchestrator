# The accessor result audited beyond its frozen examples, and the checking distinction completed, 2026-10-21

A separate audit of the one complete source-and-test tree of the 2026-10-21 comparison
([../permissions-repair/README.md](../permissions-repair/README.md)), published apart from that
stage's frozen scores, which stand. No model was involved in anything here. Everything was run
from the pinned commits and the published patch, and every script in this directory runs from
a clone on another machine: a mirror is taken from GitHub where the machine has none.

| file | what it is |
| --- | --- |
| [api-audit.mjs](api-audit.mjs), [api-audit.json](api-audit.json) | the published patch's exposed spies against sinon's own accessor spies and the upstream fix, and the authored test file run on the patch's source and on the base's |
| [api-check.mjs](api-check.mjs), [validate-api-check.mjs](validate-api-check.mjs), [api-check-validation.json](api-check-validation.json) | the requirement the audit established, as a check written for a scoring checkout, and its sensitivity read three ways |
| [rescore-swarm.json](rescore-swarm.json) | the published patch scored again from the pinned commits by `scripts/comparison/rescore.mjs`, the delivered tree and the hidden overlay apart |
| [verifier-readings.json](verifier-readings.json), [controls/](controls/) | nine readings of `swarm-verify ci` over the real sinon tree, three implementations by three patches, and the two control patches |
| [payloads-inventory.json](payloads-inventory.json), [packed-derived/payloads](packed-derived/payloads/) | the Swarm accessor launch's 438 session payload blobs by digest, its stdout and stderr streams by the launch record's digests, and the nine readings' whole outputs |

## 1. The exposed spies are not sinon spies

The frozen task said: wrap the replacement getter and setter in a spy and expose the spies as
`stub.getter` and `stub.setter`, "mirroring the spy.get and spy.set surface that
sinon.spy(obj, "prop", ["get"]) produces". The published patch
(`sha256:aa75e95d8470ef44d32d80c46f8c3cf7e8a6e071cbea5562ef21e7f83832f396`, restored byte for
byte from the stage's scored pack and held to that digest) wraps each replacement with
`createProxy(fn, fn)` from `src/sinon/proxy.js`. A proxy counts calls and records arguments;
sinon's spies are proxies with the spy API added over them (`createSpy` in `src/sinon/spy.js`:
`extend.nonEnum(proxy, spyApi)`), and that API is what the accessor spies of `sinon.spy(obj,
"prop", ["set"])` carry.

Reproduced on the patch applied to the base ([api-audit.json](api-audit.json), `trees.patched.probe`):

| probe | published patch | upstream fix `002ee82bc` |
| --- | --- | --- |
| `stub.setter.callCount` after one write; `calledWith("bar")` | 1; true | 1; true |
| `stub.setter.withArgs("bar")` | **throws** `TypeError: stub.setter.withArgs is not a function` | ok |
| `stub.getter.withArgs()` | **throws** `TypeError: getterStub.getter.withArgs is not a function` | ok |
| `sinon.spy(obj, "prop", ["set"]).set.withArgs("bar")`, the surface the task named | ok | ok |
| functions of that surface missing from `stub.setter` | 14: `callArg`, `callArgOn`, `callArgOnWith`, `callArgWith`, `instantiateFake`, `invokeCallback`, `restore`, `throwArg`, `withArgs`, `wrappedMethod`, `yield`, `yieldOn`, `yieldTo`, `yieldToOn` | 2: `restore`, `wrappedMethod`, which belong to the wrapping of an existing accessor and are not asked of a replacement |
| spy shape (`id`, `displayName`, `fakes`) | none | `spy#N`, `"spy"`, `[]` |

So the patch meets the task's own examples and the sealed upstream test file, and does not
meet the surface the task named. **It is not fully correct against the task as written**, and
this directory stops describing it as such. The oracle pass is kept as recorded: the stage's
frozen score ([../permissions-repair/comparison/scored/](../permissions-repair/comparison/scored/))
is unchanged, and [rescore-swarm.json](rescore-swarm.json) reproduces it from the pinned commits
on this host: the delivered tree passes the visible check and `npm run test-node` (its own test
file included); the hidden overlay passes the sealed `test/src/stub-test.js` with the policy
satisfied, 18 assertions added and 0 removed, the patch's own `test/src/stub-test.js` displaced by
the overlay and named as such.

The positive evidence is preserved as what it is: the authored test file passes 324 of 324
focused tests on the patch's source and 315 of 324 on the base's source, the nine failures being
exactly the nine cases the patch added (`trees.testsOnlyOnBase.authoredTests.failed`). Nine
cases that fail on the base and pass with the change are a real regression test; 324 passing
tests say nothing about `withArgs`, which none of them calls.

## 2. Why the worker chose `createProxy`, from its full trace

The run's ledger and every payload are published ([packed-derived/payloads](packed-derived/payloads/);
the ledger itself is in the stage's streams pack, session `20261021T035234-702463`). The model's
own words at each step (`model-call` payloads, `response.text`):

| step | record | what it did and said |
| --- | --- | --- |
| 7 | 51 | read `src/sinon/spy.js` whole |
| 14 | 104 | "check how `spy(obj, "prop", ["get"])` works to understand the spy.get/set surface": a search of the tests for that form, then `test/src/sandbox-test.js` 2035 to 2080 |
| 16 | 116 | "We need to wrap each replacement function in a spy and expose it on the stub as `.getter` / `.setter`. Let me see how `spy()` for getters/setters works": read `src/sinon/util/core/wrap-method.js` |
| 17 | 122 | "check what `createSpy` returns to understand its structure better - specifically how the spy for a getter/setter works": read **`src/sinon/proxy.js`** |
| 19 | 134 | the plan: "wrap the user's getter in a spy (createProxy), install the spy as the accessor, and store the spy on the stub as `.getter`" |
| 21 | 147 | "I need to import `createProxy` into `default-behaviors.js` to create spy-like wrappers" |
| 25 to 27 | 171 to 183 | the visible check, then `npm run test-node`: "All 1557 tests pass" |
| 28 to 40 | 189 to 265 | the regression tests: `callCount`, `calledThrice`, `calledWith`, `resetBehavior`, nothing beyond the task's examples |
| 57 | 399 | the repair loop's summary: "the implementation code itself (in `default-behaviors.js`, `stub.js`, and `proxy.js`) was already correct from the previous attempt", `proxy.js` being a file it never changed |

The trace supports one reading: at step 17 the model went to `proxy.js` for "what `createSpy`
returns", took `createProxy` for the spy constructor, and never returned to `spy.js`, where
`createSpy` is `createProxy` plus the spy API. From step 19 on it treated the surface as settled
and tested only the examples the task gave. Nothing in the product or the harness asked for
more: the visible check reads `callCount`, the project's suite has no test of `stub.getter`,
and the sealed upstream test file asserts `callCount`, `calledThrice`, `calledWith` and
`resetBehavior` only. The pass was complete against every check that existed and incomplete
against the sentence that named the requirement.

What follows from that, and what does not:

- **The evaluator now holds the surface.** [api-check.mjs](api-check.mjs) is the requirement as
  the audit established it: every function of an accessor spy's surface present on `stub.getter`
  and `stub.setter` (43 of them), `withArgs` filtering, `getCall`, `firstCall`, `returnValues`,
  `resetHistory`, and the preserved behaviours (chainable, configurable, `restore`,
  `resetBehavior`). Read three ways before it judges anything
  ([api-check-validation.json](api-check-validation.json)): it fails on the base, fails on the
  published patch, passes on the upstream reference. The registered task
  `sinon-bugfix-stub-accessor-calls-v2` (`scripts/comparison/tasks.mjs`) names the surface in
  its text and carries this check as hidden material written into the scoring checkout only.
- **No product change is made from this trace.** The improvement the trace points at is a step
  that reads "mirroring the X surface" in a task and compares the produced object with X. That
  is a model judgement over prose, which this project does not build as a blocking stage
  (`CLAUDE.md`, no blocking LLM judge), and an untested mandatory model stage is excluded here
  by the follow-up's own terms. It is recorded as a hypothesis, unmeasured. No Sinon-specific
  instruction, hardcoded API check or blanket planning rule was added to the product.

## 3. The subject of a check is not its instrument

The product withheld this run's passing tests as "unmeasured" ([../permissions-repair/README.md](../permissions-repair/README.md),
launch 6). The cause, reduced to its minimal case and fixed on this branch
(`src/gates/instrument-identity.ts`):

- `package.json` runs eslint; `eslint.config.js` lists `src/sum.js` by literal path among the
  files it lints (`files: ["src/sum.js"]`); the configuration is unchanged; only `src/sum.js`
  changes; lint passes. The instrument reader followed every string in a configuration that
  named a file in the tree as something the tool loads, so `src/sum.js` was read as checking
  machinery, the pass was withheld, and the base-configuration rerun put the source back to
  the base's before measuring the tests.
- In sinon the chain is the same with more links: `eslint.config.js` lists `build.cjs`, two
  utility modules and four test helpers by literal path; the pinned build then followed
  `build.cjs` into `package.json` and `rollup.config.mjs` and from there into every source
  file. The fix of 2026-10-21 morning (`f6e13ca2f`) stopped the manifest part of that walk;
  the literal entries remained, which the stage's README named as a residual.

The fix: a string under a key that selects what a tool checks (`files`, `ignores`, `spec`,
`include`, `exclude`, `roots`, `testMatch`, `collectCoverageFrom`, `testDir`, `extension`,
`all` and the rest, by exact spelling) names the subject of the check and is not followed;
the configuration itself, and every string under a key that names what the tool loads
(`parser`, `processor`, `plugins`, `reporter`, `require`, `setupFiles`, `file`, `extends`,
`ignorePath`), is followed as before. The reading is attributed by the key a string sits under,
array entries and the values of quoted keys included. The files left out are named on the
observation as a residual ("names 7 file(s) in the tree as what its tool checks"), so the
record says what was not followed and why.

Proven on both sides:

- **Reader**: `src/gates/instrument-identity.test.ts`, "what a configuration lists as the files
  it checks": the minimal case; literal entries and patterns for eslint, mocha, vitest, jest,
  tsc and nyc; parsers, processors, plugins, reporters, setup files and the configuration itself
  still detected; and sinon's `eslint.config.js` at `8c663edec` verbatim, where a source change
  leaves the lint instrument alone and an edit to the configuration or to `build.cjs` does not.
- **Final assessment**: `src/gates/independent-verification.test.ts`, "a configuration that
  lists the files it checks": through `verifyIndependently` on a real git repository with a
  lint program that reads the listed files, a source-only change leaves the pass standing with
  the regression dimension passing; a patch that passes only by rewriting the configuration, or
  only by rewriting the program that performs the check, is read with the base's instrument
  restored and withheld.
- **The standalone verifier**: `src/cli-ci-checked-files.integration.test.ts`, the same two
  cases through `swarm-verify ci`.
- **Reproduced on PR #92's head** before the fix: the same test files copied into that
  worktree fail there, 6 of 6 (four reader cases, both verifier cases).
- **The real sinon tree**, nine readings ([verifier-readings.json](verifier-readings.json);
  whole outputs in the payload pack): `swarm-verify ci` over a clone at `8c663edec` with the
  visible check and the tests gate committed on top, installed from the base's lockfile, run by
  three implementations against three patches.

| patch | pinned build `96b20a89c` (the comparison's) | PR #92 head `df9926215` | this branch |
| --- | --- | --- | --- |
| the published accessor patch | regression **unmeasured**: "passes only with this patch's changes to the runner configuration (src/sinon/default-behaviors.js, src/sinon/stub.js)", the launch's reading reproduced | lint and tests pass, regression pass; the source files are out of the closure since `f6e13ca2f` | lint and tests pass, regression pass; the lint instrument names 7 listed files as the check's subject and follows none |
| [controls/walk-comment.patch](controls/walk-comment.patch): a comment added to `src/sinon/util/core/walk.js`, a file the configuration lists by literal path | lint passes only after a rerun with `walk.js` put back to the base's; regression pass, with the advice wrongly saying a check passed only under the patch's configuration | the same | lint passes as run; no rerun |
| [controls/walk-weakened.patch](controls/walk-weakened.patch): `walk.js` gains a dangling-underscore export the lint rules forbid, and `eslint.config.js` adds `walk.js` to its ignores | regression **pass**: the rerun restored `walk.js` together with the configuration, which removed the violation it was meant to find | the same false pass | lint withheld (`configurationFiles: ["eslint.config.js"]`, base configuration fails), regression **unmeasured** |

The third row is the other side of the same defect: reading the source as configuration not
only withheld honest passes, it restored the source along with a weakened configuration and
let the weakening pass. One advice string was wrong in the first two columns' second row
(`src/gates/independent-verification.ts`): checks absent by their own account (`typecheck`,
`format`) carried the restored files too and were read as "a check passes only with this
patch's changes"; the advice now asks for a check whose reported pass the base's configuration
did not give.

The pinned build's reading is the original failure reproduced with the exact bytes (`exit 1`,
regression `unmeasured`, the two source files named). What this does not change: the stage's
records, which ran under the defect, and the decision rule's reading of launch 6 (exit 4, no
claim).

## Reproduce

```sh
node docs/evidence/2026-10-21/accessor-audit/api-audit.mjs --patch <the published patch> --out api-audit.json
node docs/evidence/2026-10-21/accessor-audit/validate-api-check.mjs --patch <the published patch> --out api-check-validation.json
node scripts/comparison/rescore.mjs --stage docs/evidence/2026-10-21/permissions-repair/comparison --task sinon-bugfix-stub-accessor-calls --arm swarm
node scripts/evidence-pack.mjs restore docs/evidence/2026-10-21/accessor-audit/packed-derived/payloads
```

The published patch is `scored/sinon-bugfix-stub-accessor-calls.swarm.patch` in the stage's
streams pack (`node scripts/evidence-pack.mjs restore docs/evidence/2026-10-21/permissions-repair/packed-derived/comparison-streams`);
`rescore.mjs` reads it from there itself and refuses any bytes whose digest no record carries.
The verifier readings were made with `swarm-verify ci --workspace <clone> --patch <file>
--install --lockfile package-lock.json --json` from each implementation's entry, the pinned
build's being `dist/swarm-verify.js` of `~/.cache/swarm-comparison/tools/swarm-96b20a89c`.

## What remains open

- The subject keys are a list by exact spelling over the supported tools; a tool that selects
  its files under another key is read as before, following the string. A configuration that
  computes its file list is a residual as before.
- The surface requirement is the audit's reading of one sentence of one task. The hidden check
  holds the delivered tree to it; whether a worker meets it unaided is the development trial's
  question ([../delivery-trial/protocol.md](../delivery-trial/protocol.md)), not this audit's.
