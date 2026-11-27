# The packed 17.1.0 with swarm-verify 3.2.0 from the registry, 2026-11-27

The last validation before the merge: `swarm-orchestrator-17.1.0.tgz`, packed from commit
e8e4ff8a7 (the head of pull request 108), installed into an empty prefix with an empty npm
cache, so that swarm-verify 3.2.0 came from the registry (`consumer-package-lock.json`:
`sha512-tEs+lbIwvPj1/uPWkZOQT2L2fXRI+i45+91VNKm6BbghV0nJ3HNdbM+Ohkyvk6qgAEC1MgzUNHGUxp18+aQ0CQ==`,
the integrity the registry serves). This is a local pack of the orchestrator, not its published
release: 17.1.0 was not on npm when these ran.

One fresh session of each task with gemma4:31b on the automatic path (`--accept-authored`, no
`--accept`, no `--security-check`), driven by `scripts/final.sh` and judged by
`scripts/judge2.mjs` exactly as at tag `archive/acceptance-2026-11-26-closeout`, whose README
says what each column means and which fault is seeded.

| Run | Self-reported | Verifications | Wall s | Tokens in / out | Independent judge | Generated test | Drafted binding | Patch sha256 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `packed-invoice-feature-1` | complete | 1 | 175 | 23811 / 2378 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty failed | 548f6ea75d1ba54e |
| `packed-invoice-seeded-1` | complete | 2 | 170 | 43378 / 1557 | complete; hand-written test pass | base fail, correct pass, faulty pass | correct satisfied, faulty failed | 3bc46437bbaba999 |
| `packed-notes-feature-1` | complete | 1 | 166 | 26018 / 2357 | complete; hand-written test pass | base fail, correct pass, faulty fail | correct satisfied, faulty failed | 61cb73be9bec815e |

`packed-invoice-seeded-1` is the labeled seeded fault: its first verification failed ownership
with another customer and a member of support served (`verifications/1/statement.json`), and
its second passed after the model's change. The two feature runs were secure on the first
candidate. Each run's `replay.out` ends `exit 0`. `gates-orchestrator.tail.txt` is the end of
`npm run gates` at that commit after `npm ci` from the registry, and `release-smoke.out` the
release smoke on the same pack. Three runs are three runs, not a rate.
