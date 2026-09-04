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
| 4.8 Weekly evidence workflow | done, observed passing | dispatched run `33675598963`, 6m04s end to end: pinned Ollama 0.33.2 installed and digest-checked in 10s, `qwen3:0.6b` pulled and served in 8s, the task ran 5m21s, the model failed it (tests gate 2 of 3, escalated after the one attempt), and the 47-record bundle, signed with a per-run key because the runner has no keyring, verified with its own verifier, exit 0, 2 claims verified. Rehearsed locally first with the same model: green on one retry, 52 records, exit 0 |
| Gate 4 | passed | every task done, suite 1847 green, fuzz smoke 8 harnesses, both scheduled workflows observed passing on dispatched runs |
| 5.1 Selection criteria sealed | done | `campaign/criteria.md` committed as `885c2cc6` before the first query; held to `campaign/harness/criteria.mjs` by a test |
| 5.2 Container harness | done, smoke-tested | four images by digest, an internal network with one forwarder per arm, shown to reach the backend and nothing else; one repository run end to end on `local-mlx` in 2 minutes, bundle verified |
| 5.3 Seeding protocol | done | one defect per repository from the sealed operator list, accepted only on a pass-then-test-failure, provenance and expected detection written to the seeds manifest under the campaign directory as the walk accepts each repository, committed before any run |
| 5.4 Run prompts | done | `campaign/harness/prompt.mjs`: the command to run, what passing is, the tests as specification, NOT-DONE as the fallback; the executed flag is read off the bundle's model calls |
| 5.6 Methodology | done | `campaign/methodology.md`, committed before any arm run |
| 5.5 Execution | in progress | search done (5025 candidates over five languages), the walk running in the background; arms run after the walk, and after this tree's CLI is repacked into the images so the corpus carries the sealed criteria and the bonds |
| 6.2 Sealed criteria, falsification bonds, re-derivation | done | gate set sealed before the loop and held by the verifier; a bond per passing gate with vacuous, unshown and not-bonded named apart; `rederive.mjs` in every bundle; shown on `gates-bonded/` beside this report, all seventeen verdicts re-derived |
| 6.3 Competency-table routing | done, awaiting the sweeps for its data | `src/select/competency-table.ts` and its test; the table is written by `swarm calibrate` from the sweep's own run records, the router consults it per class below the reward threshold, abstains under six executed runs, and records the lookup with its counts. Populated by the sweeps below rather than by hand |
| Discovered: the doc-path checker crashed on the campaign shelf | fixed at the root | it walked every markdown file under `campaign/`, cloned repositories included, 9518 misses and one path outside the repository that made git stop reading its input; it now reads only tracked documents and reports git's refusal by name |
| 6.1 Calibration campaign | done | four sweeps, 300 repeats, every one executed and none abstained, one after another so no two shared the machine: `qwen3.6:35b-a3b` twice, `gemma4:31b` with `mistral-small3.2:24b`, and `qwen3.8:27b` on rapid-mlx. The pair was restarted once to carry the competency-table code; the rapid-mlx sweep abstained once when the server refused connections and was rerun. `calibration-report.md` beside this file, distributions only, compared with August distribution against distribution; the four bundles under `calibration/` verify and re-derive |
| Gate 6 | passed for 6.1 and 6.2; 6.3 delivered with its data | 6.2's bonds are ledgered on `gates-bonded/` and every sweep bundle, and re-derivation runs end to end on each; 6.3 routes from the table the three format 2 sweeps wrote |
| 5.5 Execution, the walk | done | 50 accepted from 1428 decisions, exactly the sealed quotas, committed as `3e7b5d51` and `0de9f803` before any arm ran. Four harness faults found and fixed on the way, each a dated amendment in `../../../campaign/methodology.md`: Go and Rust images pinned to toolchains older than the pool, a 20 GB container disk that filled, cargo's closing line read as a build failure, and a 4 GB cap sized for the suite check applied to a whole arm run |
| 5.5 Execution, the `local-mlx` arm | done | 50 of 50 recorded between 02:46 and 22:02 UTC on 2026-09-03, with the manifest committed first. 43 runs executed and every one of their bundles verifies under its own verifier; 7 produced no bundle inside the 45-minute budget, three of them on the backend restarts named below. Outcomes over the 43: 23 fixed by restoring the line, 3 fixed another way, 17 not fixed; 18 settled green, 25 escalated, 14 ratchet rejections in total, 69 claims verified against 97 refused. Duration over the 43: median 16.1 min, quartiles 9.6 and 31.9, longest 42.6. By language, fixed of executed: JavaScript 9 of 12, TypeScript 7 of 12, Python 6 of 8, Go 2 of 6, Rust 2 of 5. Results in `../../../campaign/results/local-mlx/`, bundles in `../../../campaign/corpus/local-mlx/`. Three more harness faults fixed on the way: a TCP relay Ollama refused on its Host header, a repository hook running on the seed commit, and one failure ending the whole arm |
| 5.5 Execution, the `local-ollama` arm | done | 50 of 50 recorded between 22:02 UTC on 2026-09-03 and 08:24 UTC on 2026-09-04, with rapid-mlx taken down for its duration. Every run executed and every bundle verifies under its own verifier; no timeouts. Outcomes: 33 fixed by restoring the line, 5 fixed another way, 1 settled green with test edits, 11 not fixed; 18 settled green, 32 escalated, 22 ratchet rejections in total, 76 claims verified against 19 refused. Duration: median 9.0 min, quartiles 3.5 and 18.8, longest 38.5. By language, fixed of executed: JavaScript 13 of 13, TypeScript 11 of 13, Python 5 of 12, Go 5 of 6, Rust 4 of 6. Results in `../../../campaign/results/local-ollama/`, bundles in `../../../campaign/corpus/local-ollama/` |
| 5.5 Execution, the report | done | `../../../campaign/results/report.md`, generated 08:23 UTC on 2026-09-04 from the result records alone; the frontier arm appears in it with zero runs recorded |
| Discovered: the shell allowlist refused the toolchains the gates run | fixed at the root | the default list carried node's toolchain only, so in a Python repository the model could not run `pytest -q` while the harness ran it as a gate. `python`, `python3`, `pytest`, `go` and `cargo` are on the list now, with a test over every command the gates assemble |
| Discovered: a model call with no deadline | fixed at the root | the wall budget was checked between steps, so a backend that went quiet held a run until the container killed it with nothing recorded. A call is bounded by what is left of the budget on the injected clock, the test clock gained deadline semantics, and a hung call ends the loop as a wall-time stop with its gates run and its bundle written |
| Discovered: the campaign relay leaked the backend request of a killed run | fixed at the root | the rapid-mlx backend aborted twice during the `local-mlx` arm on a Metal out-of-memory error with two contexts resident, each within ninety seconds of a budget kill, and three of the arm's timeouts fall on those restarts. The relay now ends the upstream request when its caller closes, with a test; one backend is resident per arm; the crash reports, the log lines, and the cost are in `../../../campaign/methodology.md` |
| Discovered: third-party tests collected | fixed at the root | vitest's default include reached the campaign's cloned repositories, 280 of their test files; `vitest.config.ts` excludes `campaign/work` and `campaign/corpus` |
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
- **The pair sweep was restarted rather than folded in by hand.** It had started before the
  competency-table code existed, so its process would never have written the table. Ten of
  its one hundred and twenty runs were discarded and it was started again under the committed
  code, because a table the tool writes from its own records is the claim, and one assembled
  afterwards by a script is a different thing with the same numbers in it.
- **The campaign stays on the CLI it started with.** Two defects in the tool under test were
  found by the campaign's own transcripts and fixed in this tree while the arms ran. The arms
  keep running the tarball packed from the commit that started the campaign, because a corpus
  measured under two CLIs is not one measurement; the report names what the defects cost the
  non-node pools, and a campaign under the fixed CLI is a different campaign.
- **The calibration-trust condition.** Gate 1 asked for the empty-turn cause confirmed fixed
  against live backends. What this run can show is narrower and is stated as such: the exact
  request that produced the empty turn, identified by digest, no longer does against the
  backend served now, and every layer this tree controls is the same as on the day it did. The
  cause is located in a backend build that cannot be re-served, which is not a fix in this
  tree because nothing in this tree was the cause. Phase 6.1 is treated as unblocked on that
  basis, with the abstention from 1.2 as the running check: a sweep with any abstained repeat
  is not trusted data, whatever this note says.
