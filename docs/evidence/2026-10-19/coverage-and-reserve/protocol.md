# Coverage, output and reserve: one development trial and one fresh comparison, protocol

Registered before the first model-powered launch of this work. Every launch, in order, goes in
[launches.md](launches.md), entered before it starts, failed starts and accidental launches
included. This file is not edited after the first launch; a change of plan is an amendment
appended below the line at the end, dated, before the launches it affects. The closed protocols of
[../repair-value/](../repair-value/protocol.md) and the ones before it, and their results, stand
unchanged; nothing here reinterprets or rescores them.

## Status of what this can show

- **D1** is a development trial on `marked-bugfix-www-case`, the task whose C1 launch this work's
  diagnosis read. Its failure, its records and the upstream change are known to the people
  developing Swarm, and the change is public. A pass is a development result, never comparative
  evidence.
- **The comparison** is three arms on one task from `scripts/comparison/tasks.mjs`, chosen by the
  rule below. Planned-check Swarm against ordinary Swarm reads the observed contribution of
  `--plan-checks` on that task; each Swarm arm against OpenCode reads a task-specific difference.
  One task cannot show general superiority of anything.

## Allowance and accounting

- **At most five model-powered launches, 15 minutes each end to end, and 75 agent-minutes in
  all**, whichever comes first. Agent minutes are the arm's own process wall, from spawn to exit
  or kill. Workspace preparation, builds and scoring are reported apart.
- One launch owner (the session that registered this protocol), one launch at a time, one model
  resident, and no test suite or other heavy job running beside a launch. A launch started by
  mistake and a launch attempt that fails before reaching a model are counted and entered.
- Local only: Ollama 0.32.14 at `http://127.0.0.1:11434/v1` serving `qwen3.6:35b-a3b` (digest
  `096fdbd02fe6`), already on the machine. No paid API and no model download. Both products are
  configured by the comparison runner (`writeArmConfiguration`), as in C1 and C2.

| launches | purpose | condition |
| --- | --- | --- |
| 1 | D1: Swarm, `--plan-checks`, on `marked-bugfix-www-case` | none |
| 3 | the comparison on one fresh task: Swarm `--plan-checks`, Swarm without it, OpenCode | registered by amendment after D1, before any arm |
| 1 | infrastructure replacement | a launch invalid for an infrastructure reason (the endpoint died, the runner halted on its own failure, a workspace could not be prepared), investigated and entered first |

These are ceilings. A valid failure is never replaced and nothing is rerun to look for a better
result. The comparison runs all three arms whatever the first gives.

## The product build

The commit that registers this protocol, whose `src/`, `scripts/` and lockfile are those of
`4e6c4e510`, the commit the deterministic verification ran on (recorded in
[verification.md](verification.md)). It is cloned
into `~/.cache/swarm-comparison/tools/swarm-<commit>` and built there with `npm ci` and
`npm run build`, Node 24.15.0, and the built `dist/cli.js` is digested into each manifest. **No
product code changes from the registration to the end of the comparison.** If D1 shows a product
defect, it is recorded, the comparison still runs on this build, and any repair is later work.

## Launch mechanics

Every launch goes through the comparison runner unchanged (`scripts/comparison/run.mjs
--manifest`, its harness digest in the manifest), on a fresh clone of the task's frozen base with
the visible check committed, the supplied contract holding the visible check only
(`swarmContract`), no scripted correction (`maxCorrections: 0`), and nothing else given to the
model. Each manifest is frozen by [freeze.mjs](freeze.mjs) before its launches.

- **Matched end-to-end limits:** every invocation 14 minutes and half a second, killed at 15
  minutes by the runner's grace (59.5 s). The half second makes Swarm's whole minutes come to
  `--max-wall-minutes 14` however many milliseconds pass between the runner's deadline and the
  spawn; the manifest's `swarmVerificationReserveMs` is 0, since the product now holds its final
  verification's reserve inside its own total. OpenCode runs to the same deadline. Swarm's 8,000,000-token bound is a safety bound; OpenCode has none.
- **Model-visible inputs:** the task text, the repository at its base with the visible check, and
  what each product itself says. No hidden test, reference change, evaluator file, earlier
  candidate or score is in a workspace or a request.

## D1

`marked-bugfix-www-case` at its frozen base, Swarm with `--plan-checks`, one launch. Scored after
it ends, apart, by the task's frozen hidden oracle through the runner's own `hiddenVerdict` on a
fresh checkout with the exact delivered patch. Recorded beside the score, from the launch's own
chains: which requested behaviours the sealed contract covered and which it reported uncovered and
why, whether the revision reclassified anything, whether the worker's brief named the uncovered
ones, and whether the final build, lint, tests and acceptance gates completed on the delivered tree.

## The comparison

**Selection rule, fixed here before the product is frozen and before the rule is applied.** The
first task in `scripts/comparison/tasks.mjs` file order that:

1. is not from markedjs/marked (D1's repository) and is not mime (this line of work's development
   task);
2. is a `bugfix` or `feature` task, whose hidden oracle judges a requested outcome (an `upgrade` or
   `refactor` oracle judges preserved behaviour, which `--plan-checks` has little to plan for);
3. states every requested outcome in its text as a change, not as behaviour the base already has
   (read before any launch; where a sentence describes as existing something the visible check or
   a fresh base run shows the base does not do, the task is skipped and the reason recorded);
4. has a visible check that fails on the base and an environment the runner prepares.

Every task in that file was launched in the 2026-10-11 to 2026-10-15 comparisons, so none is
unseen; none was used to develop these changes. The selected task, the reading of its wording and
the base run of its visible check are recorded by amendment before the first arm.

**Arms, in this order, all three run:** (1) Swarm with `--plan-checks`, (2) Swarm without it,
(3) OpenCode. Each arm has a manifest of its own, numbered with this order and identical to the
others but for its arm and Swarm's workflow flags; all three are frozen before the first arm, and
the order above is the order of launches whatever the runner's own order rule would give.

**Evaluation, frozen with the task:** the task's hidden oracle (its sealed commit and files, as the
runner freezes them) through `hiddenVerdict`, on a fresh checkout, on each arm's exact delivered
patch. Where a Swarm arm repairs and its candidates can be rebuilt exactly from its records, each
recovered candidate is scored the same way; that is a within-run reading of repair, not part of the
comparison.

**Reported, in this order:** correctness on the hidden oracle; the product's own status and exit
code; whether final verification completed; wall; tokens; repair contribution. Planned against
ordinary Swarm, and each Swarm arm against OpenCode, are reported as separate readings of one task.

If Swarm loses, the first concrete failure in its trace is identified and recorded, and the
campaign stops at this protocol's boundary.

---

## Amendments

### 1. 2026-10-19, after D1 and before any arm of the comparison: the task and the manifests

D1 ran and is recorded ([launches.md](launches.md), [d1/README.md](d1/README.md)): the hidden
oracle fails its accepted patch, and two product defects are recorded. As registered, the product is
not changed and the comparison runs on `9a5052750`.

**The rule applied, in `scripts/comparison/tasks.mjs` order.** The four `marked-*` tasks are skipped
(D1's repository). The next task, `fxp-bugfix-uint8array-utf8` (NaturalIntelligence/fast-xml-parser,
`bugfix`), meets the rest:

- **Wording.** Its one statement of kept behaviour is "Node.js Buffer input must keep working exactly
  as before"; on a fresh checkout of its base `3617550a` with `npm ci --ignore-scripts`,
  `new XMLParser().parse(Buffer.from("<a>café 😀</a>"))` gives `{"a":"café 😀"}`, so the base does
  have it. Every other requirement (decoding a Uint8Array as UTF-8, multi-byte round trips, the bytes
  of a subarray only, a preserved byte order mark with matching `startIndex`, the validator accepting
  the same bytes) is stated as a change.
- **Visible check.** On that checkout `node acceptance/visible/check.mjs` exits 1 (`undefined`
  where `café 😀` is expected).

It was launched in the 2026-10-11 comparison cohorts (three records per arm), so it is not unseen;
it was not used to develop this work.

**Evaluator, frozen with the task:** its hidden tests (`spec/inputType_spec.js` from the upstream
commit `bb2ec6ce`, run with jasmine) through `hiddenVerdict`, as the runner freezes them.

**Manifests,** frozen by [freeze.mjs](freeze.mjs) after this amendment, one per arm, launched in
this order: (1) [comparison/arm1-swarm-planned.json](comparison/arm1-swarm-planned.json), Swarm
with `--plan-checks`; (2) [comparison/arm2-swarm-ordinary.json](comparison/arm2-swarm-ordinary.json),
Swarm with no workflow flag; (3) [comparison/arm3-opencode.json](comparison/arm3-opencode.json),
OpenCode 1.14.48. Their digests are entered in [launches.md](launches.md) with each launch.

### 2. 2026-10-19, after launch 2 halted before reaching a model: the rule applied again

Launch 2 (arm 1 on `fxp-bugfix-uint8array-utf8`) halted in the runner's gate-plan preflight, before
any model call: the frozen build's `swarm check`, run by the preflight without `--lockfile`, refuses
a repository with both `package-lock.json` and `yarn.lock`. PR #89's build refuses it the same way,
and the runner's own `swarmGatePlanVerdict`, called directly with no model, reproduces it; it is
deterministic and independent of the model and of this work. So the task does not have "an
environment the runner prepares" (criterion 4), which amendment 1 had checked by hand rather than
through the runner's preparation. Recorded, with the halt records, in [launches.md](launches.md) and
[comparison/halted-fxp/](comparison/halted-fxp/).

**Accounting.** Launch 2 is counted, with 0.0 agent minutes, and takes the infrastructure-
replacement slot. Three launches remain, exactly the three arms; there is no replacement left. The
product and the runner are not changed.

**The rule, continued in file order.** Every `fxp-*` task is from the same repository and carries
the same two lockfiles; the `fxp-feature-strict-reserved-names` and `fxp-refactor-unpaired-set`
entries that follow are skipped for that reason (and the second is a refactor), as is
`fxp-upgrade-strnum` (an upgrade). The next task, `yargs-parser-bugfix-count-sentinel`
(yargs/yargs-parser, `bugfix`), meets every criterion, each checked on a fresh checkout of its base
`b82ba0f9` with no model:

- **Wording.** The task states two outcomes as existing: `parser("-x 3 -x 2")` "correctly returns
  `{ x: [3, 2] }`", and options declared under `count` "keep incrementing" (`"-v -v -v"` with
  `count: ["v"]` gives 3). After `npm ci --ignore-scripts` and `npx tsc -p tsconfig.test.json`, the
  base gives `{"_":[],"x":[3,2]}` and `{"_":[],"v":3}`: both hold. The requested outcomes
  (`"-x 3 -x 1"` gives `[3, 1]`, `"-x 1 -x 1"` gives `[1, 1]`, `"-x 1 -x 3"` gives `[1, 3]`) are stated
  as what must hold; the base already gives `[1, 3]` for the last.
- **Visible check.** `node acceptance/visible/check.mjs` exits 1 (the base gives `{ x: 4 }`).
- **The runner's preparation.** Its `swarmGatePlanVerdict`, called directly: ok, the product runs
  `npm test` as its blocking tests gate and it passes on the base.

It was launched in the 2026-10-11 comparison cohorts (three records per arm); it was not used to
develop this work. **Evaluator, frozen with the task:** its hidden tests from the upstream commit,
through `hiddenVerdict`, as the runner freezes them.

**Manifests,** frozen by [freeze.mjs](freeze.mjs) after this amendment, one per arm, in the
registered order: [comparison/yargs-arm1-swarm-planned.json](comparison/yargs-arm1-swarm-planned.json),
[comparison/yargs-arm2-swarm-ordinary.json](comparison/yargs-arm2-swarm-ordinary.json),
[comparison/yargs-arm3-opencode.json](comparison/yargs-arm3-opencode.json). The three
`fxp-bugfix-uint8array-utf8` manifests of amendment 1 stay as frozen; only arm 1's was launched.

### 3. 2026-10-19, after the comparison's third arm: closed

Five launches, 20.3 agent-minutes, no allowance left. D1 failed the hidden oracle with the product
reporting `accepted`; the first comparison start halted before any model call; on
`yargs-parser-bugfix-count-sentinel` all three arms passed the hidden oracle with the same patch, byte
for byte. Nothing else will be launched under this protocol; see [launches.md](launches.md),
[d1/README.md](d1/README.md) and [comparison/README.md](comparison/README.md).
