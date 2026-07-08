# Endgame run: Phase 0 baseline

Probes and suite state at the run's branch point. Re-probe any credit- or
token-dependent line before trusting it; the token and credit states below are the
values observed at this run's Phase 0 (2026-07-08T04:22Z).

## Branch point

`b0526212cad93306331a4c0455408afbff87c797` (`main`), the soundness-run capstone.
All endgame work builds forward from here.

## Suite state

`npm test` (build + `mocha --recursive`): **2181 passing, 41 pending, 0 failing**
(exit 0). Grown from the soundness-run baseline (2152 passing, 39 pending) by that
run's committed tests; no regressions.

## Probes

| probe | result | consequence |
| --- | --- | --- |
| `GITHUB_TOKEN` -> `GET /user` | **HTTP 200**, login `moonrunnerkc` | Phases 1 and 5 primary set UNBLOCKED |
| token -> `GET /search/issues` | **HTTP 200** | complaint mining can run |
| token -> `GET /repos/{o}/{r}/pulls` | **HTTP 200** | PR diff/SHA fetch can run |
| `ANTHROPIC_API_KEY` -> `POST /v1/messages` (haiku, 1 token) | **HTTP 200** | dual-arbiter mining and any funded stage can run |

The token is a fine-grained PAT (no `x-oauth-scopes` header; classic-PAT scope list
does not apply). Rate-limit remaining 4999/5000 core at probe time. This is the
first endgame prerequisite the last three runs did not have: the soundness run
recorded HTTP 401 here and blocked corpus mining (READINESS item 4). The 401 is
cleared.

## Gating decision

- **Phase 1 (mine, verify, package):** unblocked. Miner launched at Phase 0 with the
  full workflow budget (`--limit 25 --api-budget 400 --wall-clock-ms 2100000
  --max-cost-usd 5`, dual arbiter on), checkpointed and resumable, running while
  Phases 2 and 3 build.
- **Phase 2 (attestation), Phase 3 (derived witnesses):** token-independent; proceed
  regardless.
- **Phase 4 (fold-gated intake), Phase 5 (Hunt 5 primary):** gated on the maintainer
  approving a fold, not on the token. If approval has not landed by the time Phases 2
  and 3 complete, halt at Phase 4 and record awaiting-review, per the run contract.

## Spend at Phase 0

1 Anthropic probe call (haiku, 1 output token, ~$0.00) + 3 GitHub reads (free).
