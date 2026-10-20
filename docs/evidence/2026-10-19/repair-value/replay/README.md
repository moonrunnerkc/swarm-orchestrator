# O1's transitions through each controller

Deterministic controller verification ([../replay-o1.mjs](../replay-o1.mjs)): O1's recorded planner
responses and candidate transitions, scripted, through one built product on the real mime project.
No model is called and this is not live repair. Each directory holds the run's settings
(`run.json`), the product's own record of what it decided ([../analyze-replay.mjs](../analyze-replay.mjs):
`analysis.json`), the delivered patch, and, gzipped for lossless packing, the brief each stage was
sent (`transcript.json`), stdout, stderr and every ledger and blob of both sessions. The delivered
patches were scored afterwards, apart ([scores/](scores/scores.json)).

| directory | build | sealed contract | repair 1 | repair 2 | repair 3 | delivered | outcome | frozen evaluator, custom extension |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [df2e3b619/](df2e3b619/analysis.json) | O1's | O1's digest | kept | kept | rolled back | O1's patch, byte for byte | `unresolved`, 3 repairs | fail, pass |
| [f556b6313/](f556b6313/analysis.json) | PR #89's last local commit | O1's digest | rolled back | kept, case 7 held | not asked | the first implementation | `unresolved`, 2 repairs, stop filed as `instrument` | pass, pass |
| [e2b0fe77c/](e2b0fe77c/analysis.json) | the frozen build of this work, run before any live launch | O1's digest | rolled back | kept, case 7 held on the restored tree it was told on | not asked | the first implementation | `unresolved`, 2 repairs, stop `held-expectation` | pass, pass ([scores](e2b0fe77c/scores/scores-with-relation-limit.json)) |

On every build the kept-candidate record holds the rolled-back file and the bundled verifier
re-derives every ratchet decision in agreement (`rederive.mjs` in each run's bundle).
