# Viability-lift run: Phase 0 baseline

Environment verification and suite state, recorded before any phase spends a
credit or a token. This file is the branch point every later phase measures
against.

## Branch point

- Commit: `7c8686355058bd209d33cac7b5a6adc3cb2a6312`
- Branch: `main`
- Working tree at probe time: clean except one untracked scratch file
  (`social-posts-behavioral-cheats.md`, unrelated to this run).
- Recorded: 2026-07-07T22:47:05Z (UTC).

## Suite state at the branch point

`npm run build` then `npm run test:ci` (Mocha over `dist/test/**/*.test.js`):

- **2137 passing, 39 pending, 0 failing** (wall clock ~2m).
- Build: green (`tsc -p tsconfig.build.json`, chmod on `dist/src/cli.js`).

This is the green baseline. Every commit in this run re-runs `npm test`,
`npm run typecheck`, `npm run lint`, and the LOC-budget gate before landing.

## Credential probes

Both credentials were probed with a minimal call. The maintainer is topping up
credits; as of this probe the top-up had not landed.

### Anthropic API (1-token call)

`POST https://api.anthropic.com/v1/messages`, `model: claude-haiku-4-5-20251001`,
`max_tokens: 1`, one-word user message.

- **Result: HTTP 400, `invalid_request_error`**, message "Your credit balance is
  too low to access the Anthropic API." Request id `req_011CcoWFZj9hkabrUXt67Jqc`.
- **Verdict: credit-gated phases HALT.** This blocks Phase 2's live twin
  validation gate, Phase 3 (judge gate-cost sweep) in full, and Phase 5's
  claim-differential path. Restoration-tier proofs make no model calls and are
  unaffected.

### GITHUB_TOKEN (authenticated no-op)

`GET https://api.github.com/user` with `Authorization: Bearer $GITHUB_TOKEN`.

- **Result: HTTP 401, "Bad credentials."** Same invalid token recorded across the
  frontier run and Hunt 3.
- **Verdict: token-gated work HALTS.** This blocks Phase 4 (complaint-mine
  workflow dispatch). Per the Hunt 3 protocol, unauthenticated public GitHub
  access remains available for every other fetch and clone; a `git ls-remote`
  against a corpus repo succeeded at probe time, so Phase 1's census and
  provisioning (both infrastructure, both permitted against wild checkouts) run
  on unauthenticated access.

## What this run can and cannot do under these conditions

| phase | needs | status under the probe |
| --- | --- | --- |
| 1 viability lift | git fetch (unauth OK) | **runs in full** |
| 2 claim-differential hardening (code) | none | **code + deterministic unit tests run** |
| 2 validation gate (live twins) | Anthropic credits | **halts**, recorded |
| 3 judge gate-cost | Anthropic credits | **halts**, recorded |
| 4 corpus growth (mining) | valid GITHUB_TOKEN | **halts**, recorded |
| 5 Hunt 4 restoration tier | git fetch (unauth OK) | **runs** |
| 5 Hunt 4 claim-differential | Anthropic credits | **halts** on the model calls, recorded per entry |

Phase 1 is the biggest lever and is fully unblocked, so it is where this run
spends its engineering. Credit-gated measurements are built and left ready to
run the moment a probe passes; each records its block as a finding, not a gap.

## Reproduce the probes

```sh
npm run build
node -e '
const { loadDotenv } = require("./dist/src/env-loader.js");
loadDotenv(process.cwd());
(async () => {
  const a = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
  });
  console.log("anthropic", a.status);
  const g = await fetch("https://api.github.com/user", { headers: { Authorization: "Bearer " + process.env.GITHUB_TOKEN, "User-Agent": "probe" } });
  console.log("github", g.status);
})();
'
```
