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
