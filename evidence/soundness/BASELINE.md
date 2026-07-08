# Soundness run: Phase 0 baseline

The starting state for the soundness run, recorded before any change. The run's
one goal is a product whose every claim is sound before any of it is written
about: the discrimination control that closes the Hunt 4 false-positive gap, the
documentation truth sweep, the judge reframe, the viability close-out, and a
committed definition of done.

## Branch point

`cc1d1c42589cfbea85bfe6adbb8f67c02f68406e` on `main` (all work is on `main`,
per the run contract). Commit date 2026-07-07 18:16:55 -0600.

## Suite state at branch point

`npm test` (build + `mocha --recursive`): **2152 passing, 39 pending, 0 failing**
(2m wall clock). Green.

## Credit and token probes

Recorded 2026-07-08 (UTC). Credit-dependent work halts individually if a probe
fails; each phase re-reads this before spending.

| probe | result | detail |
| --- | --- | --- |
| Anthropic API | **HTTP 200** | 1-token `messages.create` on `claude-haiku-4-5-20251001` returned `msg_011Ccon5JHoAGGqSkWefczWP` (8 in / 1 out). Credits live. |
| GITHUB_TOKEN | **HTTP 401** | `GET /user` with the `.env` token returned 401, same as the prior run. Phase 4 mining stays blocked; unauthenticated public GitHub still works for fetch/clone. |

The Anthropic 200 unblocks Phase 1's twin measurement (deterministic, model-free
by construction, but the funded path is available if needed), Phase 3's judge
regeneration (restated from committed artifacts, no new calls required), and any
disclosed verification. The GitHub 401 keeps Phase 4 corpus mining blocked and is
carried into READINESS.md as an external blocker owned by the maintainer.

## Reproduce

```sh
git rev-parse HEAD                 # cc1d1c42589cfbea85bfe6adbb8f67c02f68406e
npm test                           # 2152 passing, 39 pending, 0 failing
# Anthropic probe: 1-token messages.create against claude-haiku-4-5-20251001
# GitHub probe:    GET https://api.github.com/user with the .env token
```
