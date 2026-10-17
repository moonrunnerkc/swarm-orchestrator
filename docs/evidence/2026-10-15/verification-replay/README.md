# Verification replay of the chai feature patch, 2026-10-15

A replay of a known patch through the product's final verification, not a new autonomous task
delivery. The retained Swarm patch for `chai-feature-deep-contain-oneof-dev` (the development
launch of 2026-10-15, correct by the amended oracle, refused that day by a verifier defect
repaired since) is applied byte for byte to the recorded base in a fresh checkout and judged by
an ordinary `swarm run` under a scripted model that declares the file set and claims
completion, generating nothing. The run's own gates, its sealed acceptance gate and its final
independent verification are what judge the tree, wired from the workspace's `swarm.toml`
through the command line as a normal run is. Beside it, three controls.

Produced by `node scripts/pilot/replay-feature-verification.mjs` (its own commit on this
branch); every number below is derived from [manifest.json](manifest.json) and the per-scenario
records under [scenarios/](../packed-derived/gzip/) (packed in place; `node scripts/evidence-pack.mjs restore <that directory>` gives the files back) (each run's ledger and the payloads of its envelope,
sealed gate set, goal contract and last independent verification), all gzip of the exact bytes.
The runs' stdout and stderr streams and the harness's own command log are not published, to
keep the repository under its weight ceiling; the manifest carries each stream's digest and
the command count, and the ledgers hold every record the streams were derived from.

## Inputs, each checked against the record that names it

| input | value | checked |
| --- | --- | --- |
| retained patch | `docs/evidence/2026-10-14/real-task-pilot/development/dev/patches/chai-feature-deep-contain-oneof-dev.swarm.patch` | digest `sha256:0ab5fd540f1b...` and 1,311 bytes, equal to the record's `finalPatchDigest` and `finalPatchBytes` |
| sealed contract | regenerated from the frozen task by the harness's own `swarmContract` | digest `sha256:75653490dba3...`, equal to the sealed goal the retained session's gate runs name |
| base | the mirror's `comparison/chai-feature-deep-contain-oneof-dev/base` tag (`f178cfb2...`) with the visible check committed on top, as the launch had it | the checkout is verified at the tag before the commit is made |
| product | the dist tree built from this branch, `sha256:de556a30c546...`, the same bytes as the pinned build `~/.cache/swarm-comparison/tools/swarm-811ef7c54` the live launches use | tree digest over every file |
| effective gates | `swarm.toml` written by the harness's `swarmConfigurationText` for the task: `[gates] tests = "npm run test-node"` | read back from each run's sealed gate set |

## Result

| scenario | exit | product verdict | final verification | goal check | sealed `tests` gate | hidden oracle (amended) | reading |
| --- | --- | --- | --- | --- | --- | --- | --- |
| retained patch | 0 | acceptable | verified: regression pass, task accepted, not unmeasured; build, lint, format, tests passed | visible-check accepted | `npm run test-node` | pass | the correct patch passes the task's declared node checks and the product's final verification |
| unchanged base | 1 | not acceptable | regression pass, task rejected | visible-check rejected | `npm run test-node` | not run (empty patch) | the sealed criteria reject the base |
| wrong candidate | 1 | not acceptable | regression fail (lint fails on the candidate and not at the base), task rejected | visible-check rejected | `npm run test-node` | fail | a candidate whose deep form accepts everything is rejected by the negative case, and its unused variable by lint |
| override withheld | 1 | not acceptable | regression unmeasured, task accepted; tests gate failed on the candidate and at the base with differing output | visible-check accepted | `npm run --loglevel=error test` (the manifest's script, which runs the browser suite) | pass | a required check that cannot run in a clean HOME renders unmeasured, never a pass; the same tree is accepted only under the criteria the run sealed |

Every run had a private child HOME of its own (`mode: private`, `origin: created`, named after
the run id, under the system scratch), held no browser cache before or after, and shared only
npm's content-addressed store. Each run's goal-contract record carries the sealed digest above,
so the verification judged under the same sealed criteria that judged the development launch,
not criteria the candidate chose. The fourth scenario's `tests` gate is what the development
launch's verifier assembled on 2026-10-15 before the override was carried across; here it is
the control that shows what withholding the override does.

Wall per scenario, clone to verdict: 0.7, 1.4, 1.6 and 1.2 minutes, dependencies from the
shared store. The scripted endpoint answered two requests per run.

## What this establishes, and what it does not

The final-verification path of a goal-contract run accepts the retained correct patch under the
run's sealed gates and rejects the base, a wrong candidate, and a tree whose required check is
unavailable. It says nothing about whether a model produces such a patch: that is the live
question the development launches and the diagnosis protocol address separately.
