# Close-out run: Phase 0 baseline

Snapshot taken before any close-out work. Everything below is measured, not asserted.

## Branch point

- Branch: `main`
- HEAD at baseline: `a506ecf9` (`docs(reach): evidence report + READINESS refresh (close-out)`)
- `origin/main`: `3d662714` (local `main` is 56 commits ahead; this line of runs lives on the local orphan main, per `project_git_topology`)

## Probes

| dependency | probe | result |
|---|---|---|
| GITHUB_TOKEN (shell env) | `curl api.github.com/rate_limit` | 401 (stale shell var) |
| GITHUB_TOKEN (project `.env`) | same, key sourced from `.env` | **200** |
| `gh` CLI | `gh auth status` / `gh api rate_limit` | authenticated (account moonrunnerkc, repo+workflow scopes, 4993 remaining) |
| ANTHROPIC_API_KEY (shell env) | not set | absent |
| ANTHROPIC_API_KEY (project `.env`) | `POST /v1/messages` haiku ping | **200** |
| Go toolchain | `~/go-toolchain/go/bin/go version` | go1.26.5 (user-local, reversible; installed at reach run) |
| Python | `python3 --version` | 3.12.3 (`.venv` present with pytest) |
| Node | `node --version` | v18.19.1 |

Both credentialed dependencies are live **when loaded from the project `.env`** (the
tool's `env-loader` reads project `.env` first). The shell's own `GITHUB_TOKEN` is stale
and `ANTHROPIC_API_KEY` is unset; all pipeline invocations this run source `.env` (or use
`gh auth token`) so both surfaces are reachable. No dependent phase is probe-blocked.

## Suite state

| gate | result |
|---|---|
| `npm run build` | OK |
| `npm run test:ci` | **2245 passing, 41 pending, 0 failing** (~2m) |
| `npm run typecheck` | OK |
| LOC budget (`scripts/loc-budget-gate.sh`) | 47282 / 47282 **PASS** (exactly at budget) |

The LOC budget is at its ceiling. Phase 2 adds ecosystem-aware source classification and
will exceed 47282; the budget will be ratcheted for that capability with the new count
committed (a size ratchet, not a soundness-bar change), recorded as a deviation, as at the
reach run.

## Spend cap

- **Cap for this run: $5.00.** Generous headroom for a four-job close-out.
- Expected realized spend is near $0: the census, the polyglot live-path proof, and the
  Hunt 7 audit are deterministic (no model); the only paid surface is the Opus arbiter
  *annotation* on any Hunt 7 candidate (annotates, never gates) and the judge-primary path
  during audits, both capped.
- Spend recorded per phase in the close-out evidence report; paid work stops at the cap.

## Git status at baseline

```
On branch main
Untracked: social-posts-behavioral-cheats.md   (pre-existing; the maintainer's, left in place)
```

Clean except the one pre-existing untracked file named in the run brief.

## Scope confirmation (binding docs read first)

- `CLAUDE.md` (global + project): binding.
- `evidence/reach/EVIDENCE-REPORT.md`: the 19/27 tightened-bar finding, the
  `mutableSourceFilter` barrier at `src/audit/execution-grounded/index.ts:81`.
- `benchmarks/real-prs/wild-cheat-corpus/v2/` dataset (29 entries) + DATASET.md.
- `src/audit/execution-grounded/index.ts`: diff intake through engine dispatch.
- `benchmarks/oracle-corpus/POLYGLOT-RESTORATION-REPORT.md`: 4/4 planted fixtures.
- `docs/READINESS.md`, `docs/attestation.md`, README, Action workflow docs.

The pass-capability research problem stays parked (README of every prior run).
