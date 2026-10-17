# Planned checks, live: development results of 2026-10-17

Registered before the first launch in [protocol.md](protocol.md). Every launch, in order, is in
[launches.md](launches.md). These are **development records on two exposed tasks** (mime's
line-terminator fix, node-tar's negative sizes), not comparative evidence. Both are public
historical changes that may be in the model's training data, and the product changes below were
made after reading these launches' traces.

## What was established

| question | answer |
| --- | --- |
| Did a live model independently produce useful checks? | **Once.** In launch 11 (mime) the planner generated `get-type-line-terminators-at-extension-boundary` (`file\n.png`, `file\r.png`, U+2028 and U+2029 before `.png`). The product admitted it on the base. The evaluator found that it accepts the upstream control and **rejects the retained faulty patch**, on a family the planner was never shown ([checks.json](seeded/mime-5/checks.json), [verify-checks.json](seeded/mime-5/verify-checks.json)). In node-tar, launch 8's planner wrote a check of the omitted rule (negative `uid` and `gid` keep parsing), but the check never held its base control before the planning wall: its pax records had wrong length prefixes. |
| Did a live model repair a seeded faulty candidate from those checks? | **No.** In launch 11 the discovered check refused the seeded candidate, and three live repair attempts followed, each brief naming the failing lines. Attempt 2 wrote a version that **passed every planned check but failed 7 of the project's 15 tests**, and the ratchet refused it. Attempt 3 reverted the file. The final patch is the seeded one and fails the audit ([repair-trace.json](seeded/mime-5/repair-trace.json)). |
| Did ordinary runs with checking enabled improve results enough to justify the cost? | **Not measured.** The ablation was not run: the brief makes it conditional on the live capability working, and it never worked end to end. |

## The launches (11, 87.7 of the 120 agent minutes)

| case | launches | outcome on the seeded candidate |
| --- | --- | --- |
| mime | 1, 2, 9, 10, 11 | 1: killed at the deadline (planning unbounded in flight). 2 and 9: right checks that only covered the task's own examples; the faulty candidate was accepted. 10: checks with right expectations but self-broken programs refused it, and the repair wrote a task-compliant patch that Swarm then refused. 11: discovery, and a failed repair. |
| node-tar | 3 to 8 | 3, 4, 5: no check admitted (imports outside the repository, then refused declarations); the faulty candidate was accepted. 6: two right checks that miss the omission; accepted. 7, 8: wrong checks admitted; the repairs moved the size decoding away from the task; not accepted. |

Each launch directory under [seeded/](seeded/) holds:
- `summary.json`: the outcome, the result line's `plannedChecks`, the time and the tokens;
- `checks.json`: the generated checks and what the evaluator made of each;
- `verify-checks.json` and `final-verdict.json`: the evaluator's readings;
- `exposure.json`: the request scan;
- `final.patch` and `seeded.patch`;
- `repair-trace.json`, for launches 7, 8, 10 and 11.

## Harm observed

In launches 7, 8 and 10 admitted planned checks were wrong, and Swarm acted on them.
- **Launches 7 and 8** refused a candidate on expectations the task contradicts, and the
  repairs then rewrote correct code to meet them.
- **Launch 10** refused a task-compliant patch that its own repair had written, because the
  checks could never pass.

The base control cannot tell a wrong expectation for a change from a right one. That limitation
is stated in the product's own wording and was observed here. The control-case rule below
removes launch 10's class (programs that cannot observe the project). A wrong but callable
expectation remains possible, as in launches 7 and 8.

## Product changes, each from a demonstrated failure, each with a regression test

| change | from |
| --- | --- |
| The planner's model calls are cut at the planning allowance even in flight; the run's own signal is untouched | 1 |
| The declaration's answer echoes each input as read and warns where a line feed was escaped twice | 1 |
| The proxy driver opens a fresh upstream connection per request (driver, not product) | 1 |
| A refusal says why a field sent as a JSON string could not be read | 2 |
| Imports that leave the repository, or name a `.js` path where only TypeScript exists, are refused at declaration | 2, 3 |
| The declaration's answer lists the task sentences no requirement quotes; coverage is reported | 2, 3 |
| One check per call, every field top level, the program as its own string | 2, 3, 4 |
| Elided quotes are accepted; surrounding quotation marks are stripped | 4, 5 |
| `requirementId` and `requirement` (the words), with field descriptions | 6 |
| `run_planned_checks_on_base` inside the planner's loop, and admission reuses its last run | 1 to 6 |
| The runner reads `undefined` as `null` at every depth, as the tool says | 7 |
| One check per requirement holding all its cases | 7 |
| Planning may use up to two fifths of the run (a cap, not a reservation) | 3 to 8 |
| The in-loop answer asks what the cases do not yet exercise | 9 |
| A change check must get one case right on the base | 10 |

The changes above the live work: the program-and-cases interface, admission feedback,
budgeting and reporting, built and tested before launch 1, are in the branch's earlier commits.

## Isolation

- **Planner requests:** in all 11 launches, none carried the retained patch, the upstream
  change, the audits or the evaluator's identifiers (`exposure.json`, by role).
- **Repair requests:** they carried the seeded candidate by design, since the workspace holds it.
- **No supplied code:** no replacement code and no scripted repair answer reached a live model.
  The proxy answered only the first implementation loop, with the seeded write.

## Cost

| | agent minutes | prompt tokens | completion tokens |
| --- | --- | --- | --- |
| all 11 launches | 87.7 | 12,291,693 | 175,984 |

Five calls reported no usage. Every planning round, admission, revision, implementation, repair
and final verification is inside these figures. Deterministic development (builds, tests,
validation, rehearsals) is not.

## Scripted and deterministic work, labelled as such

- **[validation/](validation/):** the evaluator, with no model. The base fails, upstream passes,
  and the retained faulty patch fails for the audit's reason. The extra node-tar controls pass:
  [tar-controls-expanded-audit.txt](validation/tar-controls-expanded-audit.txt).
- **[rehearsals/](rehearsals/):** the seeded path on the real repositories and the installed
  build, with a **scripted endpoint** for the planner and the repair
  ([seeded/rehearse.mjs](seeded/rehearse.mjs)). They show the integration path, not discovery or
  repair.
- **The public-CLI integration tests** in `src/cli-planned-checks.integration.test.ts`: also
  scripted.

## Reproduce

```sh
node seeded/run.mjs --swarm-cli <dist/cli.js> --task mime|tar --out <empty dir>
node verify-checks.mjs --task mime|tar --generated <generated-checks.json> --out <file>
node scan-exposure.mjs --task mime|tar --record <launch dir> --out <file>
```

Run them from this directory. The full records are packed in
[seeded/packed-derived/seeded-runs](seeded/packed-derived/seeded-runs/inventory.json):
- every request verbatim, with each response assembled from its stream
  ([exchange-record.mjs](seeded/exchange-record.mjs));
- the planning chain;
- stderr;
- the full check capture, `generated-checks.json`.

`node scripts/evidence-pack.mjs restore docs/evidence/2026-10-17/planned-check-live/seeded/packed-derived/seeded-runs`
gives them back.
