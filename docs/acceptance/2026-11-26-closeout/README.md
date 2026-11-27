# Closeout of 17.1.0 and swarm-verify 3.2.0: live runs, 2026-11-26

Every run here is a real local model working through the packed `swarm` CLI on the automatic
path: `swarm init --learn`, `swarm init --approve`, `swarm doctor --conventions` in a fresh
process, then `swarm run "$(cat task.txt)" --accept-authored --model <model> --approve auto
--max-steps 40 --max-minutes 40 --no-apply`. No `--accept` and no `--security-check` is passed:
the acceptance test and the security binding are the ones Swarm drafted in that run. Each run
has its own `SWARM_HOME`, its own copy of the example with the hand-written `security.json`
removed, and a fresh session. Requests are sent at temperature 0, except the replies the loop
samples after an exact repeat (from rc.18). Commands run in containers of
`node:24@sha256:e7add2a4...`, network closed. The signing key was a synthetic key made for these
runs and is not here. All 22 attempts are kept, the failed and cancelled ones included; nothing
was rerun to replace a result.

This does not replace the earlier record at tag `archive/acceptance-2026-11-26`, which stands:
on those tasks the starting version was already correct, and the upgrade showed no comparative
advantage. Nothing here compares versions or claims one is better. It shows that the automatic
path, which completed none of five runs there, now works on these tasks, and what it took.

## What is what

- **Live model observations**: every row of the table. `scripts/dev2.sh` (and `live.sh` for the
  first four) is the driver, unchanged while a run was in progress.
- **Seeded fault**, labeled: `seeded/insecure-app.ts`, a download route that serves any signed-in
  user any invoice. In `*-seeded-*` runs it is in the base under a task that does not mention
  it (`examples/invoice-api-checks/seeded` in the repository); in `*-repair-*` runs it is in the
  base and the task asks for the fix. No model wrote that fault.
- **The independent judge**, `scripts/judge2.mjs` (`judge.mjs` for the first four): nothing in it
  comes from the run. It judges the delivered patch with the packed verifier against the
  hand-written binding beside the example and the approved rules, runs the hand-written
  acceptance test on the delivered tree, runs the *generated* test on the base and on two
  reference implementations (`reference/`: one correct, one with the fault), and judges both
  references with the *drafted* binding. Its output is each run's `judge.json`.
- **Scripted model tests** are not here; they are in the repository's test suite and say so.

## Every attempt

Tokens are input / output for the whole run, drafting included. "Generated test" is the drafted
acceptance test on the base, the correct reference and the faulty reference. "Drafted binding"
is the ownership requirement as the drafted binding judged the two references (`base`: that
reference is the base itself).

| Run | swarm / verifier | Model | Self-reported | Verifications | Wall s | Tokens | Independent judge | Generated test | Drafted binding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cand-invoice-feature-1` | 17.1.0-rc.20 / 3.2.0 | gemma4:31b | complete (complete) | 1 | 174 | 20334 / 2434 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty failed |
| `cand-invoice-feature-2` | 17.1.0-rc.20 / 3.2.0 | gemma4:31b | complete (complete) | 1 | 169 | 23843 / 2388 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty failed |
| `cand-invoice-feature-3` | 17.1.0-rc.20 / 3.2.0 | gemma4:31b | complete (complete) | 1 | 180 | 20435 / 2522 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty failed |
| `cand-invoice-repair-1` | 17.1.0-rc.20 / 3.2.0 | gemma4:31b | complete (complete) | 1 | 133 | 22968 / 1592 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty base |
| `cand-invoice-seeded-1` | 17.1.0-rc.20 / 3.2.0 | gemma4:31b | complete (complete) | 2 | 168 | 43466 / 1487 | complete; hand-written test pass | base fail, correct pass, faulty pass | correct satisfied, faulty failed |
| `cand-invoice-seeded-2` | 17.1.0-rc.20 / 3.2.0 | gemma4:31b | incomplete (no-progress) | 1 | 128 | 33730 / 1060 | incomplete; hand-written test fail | base fail, correct pass, faulty pass | correct satisfied, faulty failed |
| `cand-invoice-seeded-3` | 17.1.0-rc.20 / 3.2.0 | gemma4:31b | incomplete (no-progress) | 1 | 140 | 37674 / 1294 | incomplete; hand-written test fail | base fail, correct pass, faulty pass | correct satisfied, faulty failed |
| `cand-invoice-seeded-4` | 17.1.0-rc.21 / 3.2.0 | gemma4:31b | complete (complete) | 2 | 164 | 39293 / 1323 | complete; hand-written test pass | base fail, correct pass, faulty pass | correct satisfied, faulty failed |
| `cand-invoice-seeded-5` | 17.1.0-rc.21 / 3.2.0 | gemma4:31b | complete (complete) | 2 | 173 | 43500 / 1557 | complete; hand-written test pass | base fail, correct pass, faulty pass | correct satisfied, faulty failed |
| `cand-invoice-seeded-6` | 17.1.0-rc.21 / 3.2.0 | gemma4:31b | complete (complete) | 2 | 164 | 37636 / 1602 | complete; hand-written test pass | base fail, correct pass, faulty pass | correct satisfied, faulty failed |
| `cand-notes-feature-1` | 17.1.0-rc.20 / 3.2.0 | gemma4:31b | complete (complete) | 1 | 135 | 20254 / 1797 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty failed |
| `cand-notes-feature-2` | 17.1.0-rc.20 / 3.2.0 | gemma4:31b | complete (complete) | 1 | 136 | 20254 / 1797 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty failed |
| `cand-notes-feature-3` | 17.1.0-rc.20 / 3.2.0 | gemma4:31b | complete (complete) | 1 | 142 | 20269 / 1824 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty failed |
| `dev-invoice-feature-1` | 17.0.0-rc.2 / 4.0.0-rc.4 | gemma4:31b | complete (complete) | 1 | 173 | 23824 / 2358 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty failed |
| `dev-invoice-repair-1` | 17.0.0-rc.2 / 4.0.0-rc.4 | gemma4:31b | complete (complete) | 1 | 107 | 18658 / 1165 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty base |
| `dev-invoice-seeded-1` | 17.1.0-rc.16 / 3.2.0-rc.9 | gemma4:31b | incomplete (no-progress) | 1 | 138 | 37647 / 1293 | incomplete; hand-written test fail | base fail, correct pass, faulty pass | correct satisfied, faulty failed |
| `dev-invoice-seeded-2-qwen` | 17.1.0-rc.17 / 3.2.0-rc.9 | qwen3.6:35b-a3b | incomplete (no-progress) | 0 | 83 | 70310 / 4480 | incomplete; hand-written test fail | base fail, correct fail, faulty fail | correct satisfied, faulty failed |
| `dev-invoice-seeded-3-mistral` | 17.1.0-rc.17 / 3.2.0-rc.9 | mistral-small3.2:24b | blocked (blocked) | 0 | 41 | 5476 / 503 | no patch | none | correct satisfied, faulty failed |
| `dev-invoice-seeded-4` | 17.1.0-rc.18 / 3.2.0-rc.10 | gemma4:31b | complete (complete) | 2 | 175 | 37668 / 1475 | complete; hand-written test pass | base fail, correct pass, faulty pass | correct satisfied, faulty failed |
| `dev-notes-feature-1` | 17.0.0-rc.2 / 4.0.0-rc.4 | gemma4:31b | incomplete (cancelled) | 0 | 1494 | 2362 / 652 | not judged | none | none |
| `dev-notes-feature-2` | 17.1.0-rc.16 / 3.2.0-rc.9 | gemma4:31b | incomplete (no-progress) | 3 | 252 | 40622 / 2485 | complete; hand-written test pass | base fail, correct pass, faulty fail | none |
| `dev-notes-feature-3` | 17.1.0-rc.17 / 3.2.0-rc.9 | gemma4:31b | complete (complete) | 1 | 108 | 16185 / 1217 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty failed |

## Reading it

**Automatic acceptance drafting.** Invoice feature: 4 of 4 runs complete (`dev-invoice-feature-1`,
`cand-invoice-feature-1..3`), each delivered patch complete under the hand-written binding and
test, each generated test failing at the base, passing the correct reference and failing the
faulty one. Notes feature, a differently shaped API: 4 of 6 complete (`dev-notes-feature-3`,
`cand-notes-feature-1..3`); the two that were not are the failures that led to fixes, below.
In every complete feature run the model's first candidate was already secure (one
verification): these are secure first attempts, not repairs.

**Generated security bindings.** The binding in every run was drafted by the model from the
repository and tried at the base with real requests before the first edit; each run's
`drafted-security.json` is that draft. In every run that produced one, it accepted the correct
reference and failed the faulty one on "another user is refused".

**Detection and repair of the seeded fault.** In all eight `*-seeded-*` runs that reached a
first candidate on gemma4:31b, the model added the field the task asked for and left the fault,
and the first verification failed the ownership requirement with the request and the status it
got (`verifications/1/statement.json`: "another user is refused", expected 403 or 404, got
200). What happened next:

- `dev-invoice-seeded-1` (rc.16): the model read `src/app.ts` three turns running and the run
  ended `no-progress`, incomplete. No repair.
- `dev-invoice-seeded-4` (rc.18, one sampled reply after a repeat): repaired, complete.
- `cand-invoice-seeded-1..3` (rc.20, same): repaired in 1, the same repeated read in 2 and 3.
- `cand-invoice-seeded-4..6` (rc.21, two sampled replies): repaired in 3 of 3.

Each repair is one condition at the route, `one.ownerId === user.id` (the run's `patch.diff`),
and each repaired run's second verification, its replay and the independent judge agree:
another customer and a member of support are refused, the owner is served, an unauthenticated
request is refused. An incomplete run was never reported complete, and the judge found each
incomplete run's patch incomplete too. Five of eight is not a rate to quote for anything but
these eight runs; three of three on the final candidate is three runs.

**Other models, same seeded task**: `dev-invoice-seeded-2-qwen` (the drafted test's control
asserted the new field absent, so the correct first edit failed it) and
`dev-invoice-seeded-3-mistral` (no `kind:` line; blocked before editing). Both are in the
repository's known issues.

## Failures found here, their causes, and the runs after the fix

| Seen in | Cause | Fix | After |
| --- | --- | --- | --- |
| tag `archive/acceptance-2026-11-26`: 0 of 5 drafted checks usable | The author saw how tests are written and nothing of the data or the entry: `userId` for `ownerId`, a test of its own placeholder, `require` in an ES module | The base's files the example test imports and the entry, followed through imports; module system and start command; rejections return the run's output | `dev-invoice-feature-1` and every feature run after |
| the same, and the release smoke | node's name filter written after the file, where node ignores it; a filter matching nothing exits 0; a refused-name pattern matching inside an assertion's own quotes had three sound cases left out of a recorded check | Filter before the file; a selected case passes only where the run shows it; no case is ever left out; the pattern no longer reads across quotes | `release-smoke-local.out`: the recorded check taken whole, judged complete |
| `dev-notes-feature-1`: cancelled by the operator after 25 minutes (`OPERATOR-NOTE.txt`) | (a) The drafted binding pointed ownership at `GET /notes`, the list every account can read, so the requirement failed on every tree. (b) The model then added a test that asserts before closing its server; `node --test` never exited | (a) A draft is refused where its request is the signed-in request, or is not one the task names, or expects a status the task does not give. (b) Not fixable by forcing the runner to exit, which cut its report short; the model is told what a timed-out check usually means, and it is a known issue | `dev-notes-feature-3`, `cand-notes-feature-1..3` |
| `dev-notes-feature-2`: correct patch, reported incomplete | The binding draft was mended one fault per attempt and spent all three | Every fault that needs no request is named at once; the prompt no longer shows `"method": "GET"` as the shape | the same four runs |
| `dev-invoice-seeded-1`, `cand-invoice-seeded-2`, `-3` | At temperature 0 a model that repeated a read does so again whatever it is told | The replies after an exact repeat are sampled, two of them before the run is called no progress | `cand-invoice-seeded-4..6` |

## Reproduce

Install the two packages, start a docker daemon and Ollama with `gemma4:31b`, then
`scripts/dev2.sh <install dir> <name> <invoice|notes> <feature|repair|seeded>` with the paths at
its top changed to yours. `gates-*.tail.txt` are the ends of the full gate runs of both packages
on the candidates; `release-smoke-local.out` is the orchestrator's release smoke on its candidate.
