# Hardening run report, 2026-09-02

One session on `v13-main`, run unattended through the phases of the hardening plan that earlier
sessions had not reached, with a progress note per phase. Every decision point took the stated
default and is recorded in the decisions section. Steps that could not run live are NOT-DONE
with the exact reason and the exact command, never synthesized.

The phases that already landed before this session, with their commits, are listed first so
the gate states can be read from one place.

## 0. Preflight

| Check | Result |
| --- | --- |
| `node -v` | v24.15.0 (floor is 24; run proceeds) |
| `npm -v` | 11.12.1 |
| Branch | `v13-main` at 78d5c8c9, clean, equal to `origin/v13-main` and to `origin/main` |
| Baseline `npm run gates` | exit 0, 157 files, 1833 tests passed |
| `swarm-v13-hardening-prompt.md` | not in the tree; the plan was supplied in the session prompt and is not committed here |
| Container runtime | `docker` 29.5.2 through `colima`, started for this run with 4 CPUs and 6 GB |
| `gh` | authenticated as `moonrunnerkc` (keyring) |
| Ollama, port 11434 | running, 19 models listed; neither `qwen3.6:35b-a3b` nor `qwen3.5:27b` among them at preflight |
| rapid-mlx, port 8000 | running, serves `qwen3.8:27b` |
| Provider keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NPM_TOKEN` present in the repo-root `.env` by name only; neither frontier key was needed by any task in this run |

## Already landed before this session

| Task | Commit |
| --- | --- |
| 1.1 transport trace | 9ebb810c |
| 1.2 and 1.3 empty-turn abstention, regression fixture | 643a91e6 |
| 1.4 written up, not diagnosed | 1aa832d5, then 78d5c8c9 with eight live runs |
| 1.5 pinned sampling on the wire and in the ledger | c921df2b |
| 2.1 to 2.3 ratchet inputs inventory and resolution | 29b55556, b0fd4a16 |
| 2.4 attack pass on the ratchet inputs | 8d3e1fa5 |
| 3.0 fixtures for the four gaps | c1ee9154 |
| 3.1, 3.2, 3.3 detections | 543ed53a, 31b460db, 3f4ae860 |
| 3.4 attack pass on the four gaps | 36052626 |
| 4.1, 4.2, 4.3, 4.4, 4.5, 4.7 | b40eec3b, c84bc4d0, 1ed0126f, cc7a70f0, 1045a341, cc7a70f0 |

A parallel cloud session (`claude/swarm-v13-hardening-phases-6987ly` on origin) implemented tasks
1.1 through 4.7 a second time from `e261c859`. It is not merged and not used: this tree carries
the attack passes and the live-backend runs that branch does not, and merging two
implementations of one change would be a third implementation. Its one finding this tree
lacked, the 4.6 record, is answered below.

## Per-item status log

| Item | Status | Note |
| --- | --- | --- |
| 0. Preflight | done | table above |
| 4.6 Dead v12 scheduled workflows | done, by the branch move | none of the four is a workflow GitHub knows about; `docs/tech-debt.md` records how and what was checked |
| 4.8 Nightly proof workflow | done, observed passing | dispatched run `33675596249`, 1m23s: suite, fuzz smoke, reference bundle exit 0, one-byte copy exit 1 naming `record 21 carries previousHash`, transcript uploaded as `verification-transcript` |
| 4.8 Weekly evidence workflow | committed, dispatched | rehearsed locally first: `qwen3:0.6b` through the built CLI against the seeded workspace, two empty responses, green on one retry, 52 records, verifier exit 0. Runner result below |
| 1.4 revisited: the failing pairing replayed | done, cause located outside the tree | `qwen3.6:35b-a3b` pulled back, the runbook run as written, and the shape-two request replayed by prompt digest: same digest, same sampling, answered in full. Client, drain loop and SDK unchanged since August; backend build and Ollama version changed and were unrecorded. `../../empty-turn-diagnosis.md` |
| Discovered: corpus replay skipping in CI | fixed at the root | the v12 corpus was named by `main`, which moved onto this lineage on 09-01; three replay tests then skipped under green, on CI and here. Named by the `v12-final` tag now, and the checkout test pins that the corpus was reached |

## Decisions

Appended as the run proceeds.

- **The cloud branch is not merged.** Two implementations of one plan cannot both land, the
  local one is further along and is what origin serves, and the one thing the cloud branch
  found that this tree had not recorded, the 4.6 state, is recorded here from a fresh check.
- **The calibration pick written by the diagnostic sweep stays.** It is what the tool does
  after every sweep, and a 60-run measurement of this machine is a better basis for routing
  than the absence of one. It is named in the diagnosis note rather than quietly reverted.
- **The calibration-trust condition.** Gate 1 asked for the empty-turn cause confirmed fixed
  against live backends. What this run can show is narrower and is stated as such: the exact
  request that produced the empty turn, identified by digest, no longer does against the
  backend served now, and every layer this tree controls is the same as on the day it did. The
  cause is located in a backend build that cannot be re-served, which is not a fix in this
  tree because nothing in this tree was the cause. Phase 6.1 is treated as unblocked on that
  basis, with the abstention from 1.2 as the running check: a sweep with any abstained repeat
  is not trusted data, whatever this note says.
