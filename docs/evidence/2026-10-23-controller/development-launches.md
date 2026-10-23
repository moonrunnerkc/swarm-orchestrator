# Development study launches

Frozen before the first launch, October 23, 2026, under the
[registered protocol](development-protocol.md).

- Manifest `~/.cache/swarm-study-2026-10-23/dev/manifest.json`, sha256
  `86ba8d1620de3382326c73576172a35c75fe643a78f01655abc087a180c5dc32`.
- `swarm-previous`: `git archive` of `fa190998c`, CLI sha256 `c2d32595e38ad48f0d8a1dc325225cc9c88953069cebe47a15c5d8abfea101ff`.
- `swarm` and `swarm-direct`: `git archive` of `6c054712e`, CLI sha256 `c2d32595e38ad48f0d8a1dc325225cc9c88953069cebe47a15c5d8abfea101ff`; `npm run gates` on
  that source: 486 test files passed, 5 skipped; 4,817 tests passed, 29 skipped.
- Order (sample, task, arm): 1 fastify (swarm-previous, swarm, swarm-direct), 1 p-limit (swarm,
  swarm-direct, swarm-previous), 2 fastify (swarm, swarm-direct, swarm-previous), 2 p-limit
  (swarm-direct, swarm-previous, swarm).

## Preflight, no task inference

11 of 12 configurations pass every check. One, fastify sample 1 `swarm`, stopped at Swarm's gate
plan: the product's `npm test` on the prepared base failed one of 2,129 tests,
`test/issue-4959.test.js` "should handle a socket error" (`plan expected 4 assertions but received
1`). The same base passed for the other three fastify configurations, the revised build included,
and the test passes 15 of 15 times run alone on the base. It destroys a socket on `setTimeout(0)`
and races the request hooks, so under the full suite's load it can fail on the unchanged base. No
harness or build correction follows from it; preflight records sit apart from launches. The same
flake can fail a Swarm arm's gate during a launch (any arm, any candidate), and where a record shows
it, the report says so.

## Corrections after the study, before the fresh block's freeze

All twelve launches ran and were scored with no setup failure or halt. Three defects the records
show were corrected afterwards, each generic and recorded with the evidence that prompted it:

1. **The reassessment's action named a directory outside the workspace.** Fastify sample 2,
   `swarm`: the reassessment at step 25 proposed one command that moved all eleven files, but it
   began `cd /home/user/repos/fastify &&`, a path the model invented (block 1's fastify workers
   invented the same one), and the guard refused it, so nothing was carried out. The
   reassessment's brief now names the workspace root, says every command already runs there, and
   asks for workspace-relative paths and no `cd`. The command is still run as written or not at
   all; nothing rewrites it.
2. **Mechanical work was spent one reference per step.** Fastify sample 1, `swarm`: the task loop
   moved the eleven files in eleven shell calls and updated references one edit per step, and was
   stopped at its forty-step limit; no worker in the study used the batch form. The result of a
   move that leaves references, and the "still occurs in" note after an edit, now say that one
   edit call with `edits` updates several files at once, and the edit tool's description names
   that form for changes repeated across files.
3. Noted, not changed: the rewrite reading never held an edit. Both adaptive arms delegated to
   `pLimit` on their own in all four p-limit launches; the baseline's sample 1 rewrote the queue but
   kept one `pLimit(` call inside it, which the lexical reading does not count as dropping the
   implementation. That is a stated limit of the reading.
