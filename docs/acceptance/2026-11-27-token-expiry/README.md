# Token expiry that was never exercised: reproduction, fix, controls and live runs

Recorded 2026-11-27. Nothing here claims an advantage over any other tool; the earlier finding
that none was shown stands. Users, tokens and keys in these files are synthetic fixtures. Paths
under `/Users/` are the machine the runs were made on.

## What was wrong

swarm-verify 3.2.0 made the cases of a `single-use-token` check from a binding. With no
`expiresAfterMs` it made four cases and left out "an expired token is refused", while the
requirement the cases witness still said an expired token is refused.

Two things were observed, and they are different:

- **The omission in check generation.** Reproduced first by an outside probe against the
  published package (schema accepted, four cases, requirement text unchanged).
- **A false verdict of the verifier.** `reproduction/repro-320.integration.test.ts`, run on a
  checkout of tag `v3.2.0` (commit in `reproduction/v3.2.0-commit.txt`), verifies an application
  that redeems once, refuses reuse and unknown tokens, and never expires a token. Its two
  assertions pass (`v3.2.0-false-complete.out`): the token requirement is `satisfied` and the
  verification `complete`. `v3.2.0-verdict.out` is the regression test that now ships, failing
  there with `expected 'satisfied' to be 'unverified'`.

No orchestrator run was observed completing on an expiry-blind application. In a run, the
acceptance test drafted from a task that names expiry is a gate in front of the security check
and stops such a change (`src/agent/token-expiry.integration.test.ts`, second test). A binding
passed with `--security-check` for a task that does not spell out expiry had no such gate.

## What changed

- swarm-verify 3.3.0 (main `66422b40dd5a701cc249f12aba643d48aac507c4`, npm integrity
  `sha512-v1+QGzvbjew4CwdYe3iy48WQgoayLldLSkSa0EmPPpWmwNbLPZEWQ7f8P6xgv7qMMxEH05QvoRnhzVH4m5UF9g==`):
  the expiry case is always made. Without `expiresAfterMs` it is `unobserved`, never sent,
  recorded with no result, and the requirement is `unverified` with what to supply.
- swarm-orchestrator 17.1.1 (this commit's parent): pins 3.3.0; the binding author is told how to
  make expiry observable; a handler of up to 6,000 characters is shown whole.

Controls, all in the gates (`gates-verifier.tail.txt`, `gates-orchestrator.tail.txt`): omitted
expiry leaves the requirement unverified for a correct and for an expiry-blind application; with
a lifetime of 150 ms and a wait of 400 ms the blind one fails on the expiry case alone and the
correct one is satisfied; reuse, unknown tokens and concurrent redemption are judged as before.

## Live runs

gemma4:31b through the `swarm` CLI, isolated, fresh workspace and `SWARM_HOME` each time. Flags:
`--accept-authored --no-security ownership --approve auto --max-steps 40 --max-minutes 40
--no-apply`. No `--accept`, no `--security-check`: the acceptance test and the binding are the
run's own drafts. The base is `examples/invites-api` without its hand-written binding and README;
its missing expiry enforcement is a **seeded, labeled fault**, not something a model wrote.

| Run | Build | Result | Independent judgment | Kind |
| --- | --- | --- | --- | --- |
| `dev1-1` | first development packs | incomplete, 312 s | delivered application correct; drafted binding unsound | drafting failure |
| `dev2-1` | second development packs | complete, 318 s, replay agrees | correct; binding sound | completion |
| `final-1` | packed 17.1.1 at `dbbd2da2b` with swarm-verify 3.3.0 from the registry | complete, 409 s, replay agrees | correct; binding sound | completion |

- **`dev1-1`.** The draft issued tokens at `POST /invites`, a route that does not exist, and
  redeemed with no body. Cause: the 3.2 KB handler was shown to the author as an outline, which
  drops the bodies its routes are in. The model's repair was right and the run still ended
  incomplete, a false refusal. Fixed before the next run (whole files up to 6,000 characters; a
  legitimate request the base answers 400 or 422 is sent back). Not rerun unchanged.
- **`dev2-1` and `final-1`.** The drafted binding sets `INVITE_TTL_MS` to `1000`, a variable
  `src/config.ts` reads, and waits 1500 ms. At the base: valid, reused, unknown and concurrent
  pass, expired **fails**. On the model's change: all five pass. `final-1` took three
  verifications; the first two were incomplete on the task's own requirement (the tests the task
  asks for), not on the token check.
- **The repair** in both is one condition at the route, before the used check:
  `Date.now() - invite.issuedAt > settings.inviteTtlMs` answers 410. `final-1` also made the
  setting read its variable on each use. Patches: `runs/*/patch.diff`
  (sha256 `955dbeae…69db` and `aaf9c083…4bdd`).

## Independent judgment

`judge/` holds the code, kept outside the agent's workspace: `drive.mjs` starts the delivered
tree in a container with no network and sends the requests; `judge.mjs` also tries the drafted
binding on the faulty base and on a reference repair (`reference-app.ts.txt`). The judge is
checked each time: the base must fail on expiry alone and the reference on nothing.

What `final-1`'s delivered application answered (`runs/final-1/judge-delivered.json`), with
invites lasting 700 ms: valid 200 and one member added; reused 409, nobody added; unknown 404,
nobody added; redeemed after 1100 ms 410, nobody added, and again 410; redeemed after 150 ms 200;
eight acceptances at once: one 200, seven 409, one member added. With the default lifetime, an
invite a second old is accepted.

## Files

- `runs/<name>/`: `start.txt` (versions, base, flags), `run.out`, `report.md`, `report.json`,
  `patch.diff`, `drafted-security.json`, `drafted-acceptance.test.ts.txt`, `replay.out`,
  `judge.out`, `judge-summary.json`, `verifications/<n>/` (statement, manifest, signature, public
  key) and `ledger.jsonl`.
- `packs.sha256`: the packed builds each run installed. `consumer-package-lock.json`: the
  lockfile of `final-1`'s install, naming the registry's swarm-verify 3.3.0.

## Not shown

- The published 17.1.1 from npm: the release waits on the merge of the pull request. `final-1`
  ran the pack of the same source.
- The duplicate-operation check has no live run; its cases are always made and were not changed.
- An application with no lifetime setting cannot have expiry checked; its token requirement
  stays unverified (see `docs/known-issues.md`).
- Other local models were not tried on this task.
