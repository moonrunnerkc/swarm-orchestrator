# Live runs of the invoice example, 2026-11-26

One machine (Apple silicon, 64 GB), one model (gemma4:31b through Ollama 0.32.14, named with
`--model`, 32768-token context), containers from colima. Each run had its own `SWARM_HOME`.
Budgets: 40 steps, 40 minutes. One run per cell: these show what happened, not a rate.

- Upgraded: swarm-orchestrator 17.1.0-rc.15 (cdd01c975) on swarm-verify 3.2.0-rc.7 (5ae8c1a),
  installed from packed tarballs in a fresh prefix. The first run below used rc.14 on rc.6.
- Starting version: swarm-orchestrator 17.1.0-rc.13 (808ea8242, the source of main at f33c6cfc3)
  on swarm-verify 3.1.0.
- Tasks: `feature` is the example's `task.txt`. `repair` starts from a seeded fault, labeled as
  such (`seeded/insecure-app.ts`: the download route serves any signed-in user), with
  `seeded/repair-task.txt`.
- Evaluation, the same for every patch and apart from anything a run generated: `eval.mjs` asks
  the packed 3.2.0-rc.7 verifier to judge the delivered patch against the hand-written ownership
  binding (`seeded/binding.json`) and the conventions in `seeded/rules.json`, in containers.

## Controls, no model (`controls/`)

| Candidate | Evaluation |
| --- | --- |
| Seeded insecure patch | incomplete: ownership failed; another customer and a support user each got 200 |
| The same patch with the owner check | complete |

## With the user's acceptance test (`runs/`)

Both versions were given the same hand-written test for the task with `--accept`. The upgraded
version also learned and approved conventions through `swarm init` first, showed them from a
fresh process (`conventions.out`), and took `--security-check security.json`.

| Run | Swarm's state | Requirements | Steps | Tokens in / out | Wall | Replay | Evaluation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| up-feature | complete | R1 user, R2 profile, R3 security: all satisfied | 6 | 21115 / 1724 | 122 s | agrees | complete |
| up-repair | complete | R1, R2, R3: all satisfied | 6 | 16174 / 778 | 70 s | agrees | complete |
| base-feature | complete | R1 satisfied | 8 | 18671 / 856 | 62 s | agrees | complete |
| base-repair | complete | R1 satisfied | 6 | 12607 / 428 | 39 s | agrees | complete |

Accepted incorrect results: 0 of 4. Rejected correct results: 0 of 4. Convention violations in
delivered patches: 0 of 4. The starting version was already correct on both tasks: the model
wrote the owner check without being asked twice, so no live run shows a first insecure attempt
caught and then repaired. The repair runs show the seeded fault fixed by the loop (the ownership
cases for another customer and another role go from failing at the base to passing); the
catch-then-repair sequence inside one run is shown by the scripted test
`src/agent/workflow.integration.test.ts` and by the controls above, not by a live model.
Wall time includes the upgraded version's container per command; cost is none (local runtime).

## With a drafted check for the task (`runs-authored/`)

The same tasks with `--accept-authored`: a separate call of the same model drafts the test for R1.

| Run | Version | Swarm's state | Evaluation of the patch |
| --- | --- | --- | --- |
| c1-up-feature-1 | upgraded, rc.14 | incomplete (no progress): the drafted test cannot pass | complete |
| up-feature-2 | upgraded, rc.15 | blocked before any edit: three drafts refused | no patch |
| up-repair-1 | upgraded, rc.15 | blocked before any edit: three drafts refused | no patch |
| base-feature-1 | starting | incomplete (no progress) | incomplete: ownership satisfied, conventions failed (`getInvoice` declares no return type) |
| base-repair-1 | starting | incomplete (no progress) | complete |

Rejected correct results here: c1-up-feature-1 and base-repair-1 (correct by the evaluation,
reported incomplete), and base-feature-1 on ownership. The cause is the drafted test, not the
change: rc.14's run led to the `node:test` reader fix in rc.15, which refuses such a draft
before the first edit. See `docs/known-issues.md` in the active tree.
