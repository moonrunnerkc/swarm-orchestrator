# Capability run: baseline

The branch point for the six-stage capability run. Recorded before Stage 0 opens.
Every number here regenerates from the command beside it.

## Toolchain (all green at branch point)

| gate | result | command |
|---|---|---|
| build | OK | `npm run build` |
| tests | 2263 passing / 41 pending / 0 failing | `npm run test:ci` |
| typecheck | OK | `npm run typecheck` |
| lint | OK | `npm run lint` |
| promotions policy | gate-eligible=0, advisory=10 | `npm run promotions:check` |
| corroborated gate | status `undefined-n`, n_bad=0 | `npm run corroborated-gate:check` |
| block policy | block-eligible=8 (all self-certifying, 0 firings) | `npm run block-policy:check` |
| LOC budget | 47358 / 47358 | `bash scripts/loc-budget-gate.sh` |

The LOC budget sits exactly at its limit, so any `src/**` addition ratchets
`evidence/loc-budget.txt` by its exact count (recorded per commit, as prior runs did).

## Credential probes (live only when loaded from the project `.env`)

| credential | probe | result |
|---|---|---|
| `GITHUB_TOKEN` | `GET /rate_limit` | HTTP 200, core 4910/5000 remaining |
| `ANTHROPIC_API_KEY` | `GET /v1/models` | HTTP 200 |

The shell's own vars are stale or absent; both keys were read from `.env` for the
probe and are never echoed. Re-probe before any credit- or token-dependent phase.

## Spend cap

**USD 5.00**, enforced by recording spend per stage in this run's evidence. The
design is deterministic-first: Stages 0 and 1 are model-free by construction, and
Stages 2 and 3 use the deterministic proof engines as the evidence chain (an
arbiter may only rank, never create). LLM spend is bounded to optional arbiter
ranking and any judge calls a hunt opts into; every prior hunt spent USD 0.00
because the gate is deterministic. If a stage would exceed the cap, the run
checkpoints and stops paid work rather than crossing it.

## The milestone this run targets

A cheat proven in a merged agent-authored PR that no human ever flagged: proven
(three-part: controls green, live path, fresh-clone replay), on an agent-authored
PR, merged and never found. The volume caveat is resolved by hunting merged
history backward, not only the forward stream. The pass-capability research
problem (Tier D free-text synthesis) stays parked and is not touched.

## Starting state carried in

- Wild cheat corpus at v3 (29 entries; strict 9 / legacy 19 / uncertain 1).
- jeduden/mdsmith#232: a `test-tamper` proven end-to-end on wild Go that is a
  **false positive for cheat** (a legitimate coverage-moving refactor). This is
  Stage 0's entry-one for the FP regression registry.
- Both polyglot front-end walls fixed; Go and Python test-tamper prove through
  `swarm audit --pr` (4/4, close-out run).
- 0 genuine wild cheats proven across hunts 2 through 7.
