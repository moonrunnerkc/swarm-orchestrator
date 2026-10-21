# Development trial on the exposed accessor task: protocol, registered before any inference

Registered after the deterministic work of this follow-up was committed and verified: the
checking distinction fixed and proven through the final assessment and the standalone verifier
(`src/gates/instrument-identity.ts`, commit `beca24223`), the comparison record's completion
account and the deliverables named in the prompt (`156219bf3`), the portable rescorer
(`60789814a`), the task registered again with the spy surface named and a hidden API check
(`d2437c430`), and the audit that established the requirement
([../accessor-audit/README.md](../accessor-audit/README.md)). No model was involved in any of
that. Every launch goes in [launches.md](launches.md), entered before it starts, failed starts
included. This file is not edited after the first launch; a change of plan is an amendment
appended below the line at the end, dated, before the launch it affects.

## The question

Whether ordinary Swarm, given the task with every deliverable stated and the permissions the task
needs, produces a complete implementation and meaningful tests on
`sinon-bugfix-stub-accessor-calls-v2`, satisfies the independently audited API requirement, and
finishes with the correct product verdict. The task is exposed development material: its first
form was launched on 2026-10-21, and its upstream change, the published patch and the audit are in
this repository. A success here is a development result about a delivery path, not a comparison
and not evidence of general superiority. Only after it succeeds is the product frozen and run
against OpenCode on tasks neither has seen ([fresh pairs](#after-a-success-the-fresh-pairs)).

## Task

`sinon-bugfix-stub-accessor-calls-v2` (`scripts/comparison/tasks.mjs` at `d2437c430`),
sinonjs/sinon base `8c663edec`, upstream `002ee82bc`. What changed from the first form, and
nothing else: the task text says what "mirroring the spy.get and spy.set surface" requires (the
whole sinon spy API on `stub.getter` and `stub.setter`, with `withArgs` among the named
examples), and the hidden material carries, beside the sealed upstream test file, the audit's
API check (`docs/evidence/2026-10-21/accessor-audit/api-check.mjs`), written into the scoring
checkout under `acceptance/hidden/` and run there, never in the worker's workspace. The worker
is given the task text, the visible check, the test command, the deliverables and the
allowed-change policy, in the same words OpenCode would receive (`taskPrompt`). It is given
nothing of the upstream patch, the published patch, the audit, the hidden test file or the API
check. A hand-fixed target patch would be a control, not a Swarm success, and none is used.

## Deliverables, as the worker reads them

The prompt names them (`deliverableLines`, `scripts/comparison/arms.mjs`): the implementation;
regression tests, at least one new case in the project's own test directory and style that
fails on the current code and passes with the change, adding at least one assertion; the visible
check and `npm run test-node` passing on the final tree. The policy forbids changing how the
checks run and weakening existing tests.

## Configuration

| what | value |
| --- | --- |
| model and server | Ollama 0.32.14 at `http://127.0.0.1:11434/v1`, `qwen3.6:35b-a3b`, thinking off, `max_tokens` 8192, as the runner configures it; one model resident, one request at a time, nothing heavy beside the launch |
| Swarm | commit `d2437c430`, cloned into `~/.cache/swarm-comparison/tools/swarm-d2437c430`, built there with `npm ci` and `npm run build` on Node v24.15.0; the `dist/cli.js` digest is pinned in [manifest.json](manifest.json). Ordinary configuration: no workflow flag, no planned checks, the experimental repair handoff off; its planning, repair and final verification inside its wall |
| Node, npm | v24.15.0, 11.12.1 |
| runner | `scripts/comparison/run.mjs` at the registering commit, its harness digest in the manifest |
| checkouts | `~/swarm-comparison-work`, a fresh shallow clone of the base per launch with the visible check committed |

## Limits

| limit | value |
| --- | --- |
| launches | at most two development launches, of at most 10 minutes each (9 minutes and half a second of arm wall, the kill confirmed inside 59.5 s). A second launch requires a named correction or a predeclared control comparison recorded as an amendment here before it, never a retry of the same configuration hoping for a better answer |
| readiness | the runner's own: at most 2 sequences of at most 90 s before dispatch, recorded apart |
| tokens | the common safety bound of 8,000,000 per launch |
| corrections | none; no person interacts with the tool |
| Swarm product limits | its defaults: 40 steps per loop, 3 gate-repair attempts, 8192 output tokens per call. Nothing is raised to obtain a pass |
| this follow-up's whole allowance | at most six live launches and 60 agent-minutes of inference and failed starts, the development launches and the fresh pairs together, counted in [launches.md](launches.md) |
| spend | no paid API, no model download, no configuration tuning, no server restart unless approved |

## Evaluation, frozen, on the exact delivered tree

1. **Artifact correctness**: the runner's hidden verdict: the allowed-change policy by name, the
   sealed `test/src/stub-test.js` overlaid (a file the patch wrote there displaced and named), its
   argv, then the hidden API check (`node acceptance/hidden/api-check.mjs`), then the project's
   test command. The API check is the independently audited requirement; validated before the
   launch ([validation.json](validation.json), the base's checks executed; the check itself read
   three ways in [../accessor-audit/api-check-validation.json](../accessor-audit/api-check-validation.json)).
2. **The visible verdict**: the visible check and `npm run test-node` on the delivered tree, its
   own test files included.
3. **Test quality**: the policy's count of assertions added in test files (at least one), and,
   read from the delivered tree with no model, whether the added cases fail on the base's source
   with the delivered tests overlaid and pass on the delivered source (the differential reading
   the audit made of the first patch).
4. **Product verdict**: Swarm's own report, final verification and exit code; correct where the
   product accepts a tree that passes 1 and 2 and refuses one that does not.
5. **Delivery**: all of 1 to 4, the arm exited 0 inside the deadline with its own verdict
   acceptable, and its completion account reads `claimed`.
6. **Repair**: the first gate cycle's tree against the delivered tree, from the run's ledger:
   whether repair turned a failing candidate into a passing one, preserved it, or damaged it;
   source edits and test edits counted apart.
7. **Time and tokens**: the arm's wall from spawn to exit or kill; readiness, scoring and cleanup
   apart; every token as the server counted them, any call without usage named.

**Decision rule, fixed now.** The delivery path "succeeded" only if item 5 holds. Anything less
is reported as not delivered, item by item, with the earliest actionable failure named from the
trace. Nothing in this trial is a comparison.

## If it fails

The earliest actionable failure is read from the run's ledger and named. A second launch follows
only a concrete correction (a product or harness defect found in the trace, fixed and committed,
with the build re-pinned) or a predeclared control comparison, recorded as an amendment here
before it. A second launch of the same configuration is not made.

## After a success: the fresh pairs

Only if item 5 holds: the product is frozen at the trial's commit and two Swarm/OpenCode pairs
run on tasks neither arm nor this project has launched before, registered in a protocol of their
own before any inference, with every deliverable stated, checks, permissions, model, versions,
budgets and failure handling frozen, evaluator sensitivity and reference feasibility validated,
task-relevant API or behaviour preservation checks beyond the supplied examples, the launch
order counterbalanced, the same local model and equal wall allowances, planning, repair and
verification counted inside Swarm's wall. Tasks validated with no model for that stage so far:
three mochajs/mocha fixes
([candidates.json](candidates.json)); eemeli/yaml's candidates fail the project's own tests at
the base on this host (a test suite submodule) and are not usable.

---

## Amendments
