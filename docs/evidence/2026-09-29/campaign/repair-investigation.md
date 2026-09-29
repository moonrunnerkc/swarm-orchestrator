# The four unsuccessful Comparison B repairs, investigated

Comparison B of 2026-09-28 ([rows](../../2026-09-28/comparison-b/rows.json), page
[docs/results/comparison-b.md](../../../results/comparison-b.md)) fed the released 1.0.4
regression-only verdict back to the prefix's agent on five fork patches. One repair succeeded
(iamkun/dayjs#2330: a lint failure fixed in one invocation). Four did not: koajs/koa#1904, #1961,
#1999 and tj/commander.js#1671, each ending on its fork patch unchanged after two invocations.
Those rows stay as recorded; this page explains them and names what changed since. Verdict
reports are under `~/.cache/swarm-comparison-b/reports/1.0.4/`, the replay below under
`~/.cache/swarm-campaign/repair-replay/`.

## koa#1904, #1961, #1999: a failure the verifier manufactured

Each 1.0.4 verdict failed `tests` on two cases of `__tests__/load-with-esm.test.js`, both
`ERR_MODULE_NOT_FOUND` for `dist/koa.mjs`. That file is written by koa's `build` script
(`gen-esm-wrapper`), which its `prepare` lifecycle runs; the verifier installs with lifecycle
scripts off, so no wrapper existed when 1.0.4 ran `tests` (before `build`). The base observation
of the same check exited 0: `build` had since written `dist/` on the candidate's side, and the reset
to the base (`git checkout --force` plus `git clean -fdq`) kept ignored files, so the base's tests
imported the candidate's wrapper. The failure both sides share was charged to the patch as new.

Three mechanism defects, one per layer:

1. **Verifier, asymmetric base measurement (fixed here).** The reset kept every ignored file,
   including output a check wrote after preparation. Fixed in `resetToBase`
   (`src/gates/independent-verification.ts`): the ignored entries present once dependencies are
   prepared are listed, and each reset removes ignored entries written after that. The
   failing-first test, "measures the base without the ignored output a check wrote on the patch's
   side" in `src/gates/independent-verification.test.ts`, shows the sharper form of the same
   defect: with an incremental build that skips when its output exists, a patch that breaks the
   code read as an inherited failure, a false green. Before the fix the base observation exited
   1; after it the base exits 0 and the failure is attributed `new`. Residual, named in the code:
   output written inside a directory preparation already held (`node_modules/.cache`) is not told
   apart by the listing.
2. **Verifier feedback that names nothing to fix (fixed before this campaign).** The 1.0.4 detail
   was "400 collected, 398 passed, 2 failed", with no test named. Since 3eea7e7fe the TAP reading
   names the failing tests.
3. **Harness, environment mismatch between agent and verifier.** The agent's workspace was
   installed with `npm ci` and lifecycle scripts on, so `dist/koa.mjs` existed there and every test
   passed: the agent could not reproduce what it was told and changed nothing, twice. The campaign
   registered on 2026-09-29 prepares every arm's workspace with the same install argv the verifier
   uses.

Replay on the current source (commit b65161292, host, `ci --patch <fork> --install --json`, once
each, development evidence): all three read `regression: pass` with `build` then `tests` passing
(400, 439 and 459 tests). Current check order runs `build` before `tests`, so the candidate side
no longer fails, and with the reset fix the base side is measured without the candidate's output.
Under the current source B1 would have stopped at these forks, as the prefix's own judge did, and
their held-back outcome (pass) was already B0's.

## commander.js#1671: a real regression the feedback did not name

The fork patch adds `tests/command.optsWithGlobals.test.js`, written by the agent, whose nested
cases call `program.parse` with a subcommand the program cannot resolve; commander calls
`process.exit(1)` inside a Jest worker and Jest reports "Test suite failed to run" for that file.
The verdict was right: this is a regression the patch caused. The 1.0.4 feedback said only
"the runner reported: 978 passed, 978 total", because the suite that failed to run has no counted
test. The agent received nothing it could act on and changed nothing in either invocation.

- **Verifier feedback (fixed before this campaign, 3eea7e7fe).** The same observation read by the
  current parser: "the runner reported: 978 passed, 978 total; no test failed, but test files: 1
  failed, 90 passed, 91 total; failing file: tests/command.optsWithGlobals.test.js (a file that
  fails to load or exits the process has no test to count)". The replay on the current source
  reads `regression: fail`, attribution `new`, with that detail.
- **Harness, agent output discarded.** `scripts/comparison-b.mjs` kept the agent's exit code and
  wall time but not its output, so why the agent exited 1 without editing cannot be established
  from the record. The campaign runner keeps every command's stdout and stderr by digest.
- **Not established.** The prefix's own judge read this fork's regression as `pass`; the stored
  prefix step carries only the verdict, not the check observations, so the disagreement between
  the prefix judge and 1.0.4 is recorded, not explained.

## What the campaign changes because of this

Every arm's workspace is installed with the verifier's install argv (lifecycle scripts off);
the agent's output is retained; repair feedback is the verifier's own detail, which now names
failing tests and files; and the reset fix above is in the source revision the campaign pins.
The four outcomes above remain the record of the 2026-09-28 experiment.
