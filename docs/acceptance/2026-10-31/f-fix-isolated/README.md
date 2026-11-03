# The fix category, isolated (16.0.1 patch release)

Both earlier fix runs (t3 and c1, ruleprobe) ran on the host, because the ruleprobe defect is
macOS-specific. These are the two isolated attempts the patch release made: each a real bug-fix
commit from one of Brad's repositories, its parent as the base, the fix commit's test as a
held-out acceptance check the model never saw (the file is not in the base), and the task
written as a user would report the bug, from the commit message and its test. Each ran as

    swarm run "<task>" --model auto --approve auto --max-steps 60 --max-minutes 60

isolated, on swarm-orchestrator `patch/16.0.1` (3ee6c19ab), then `swarm-verify replay` of the
final verification. Pick 1 ran with the pinned swarm-verify 2.0.0 from the registry; pick 2 with
that pin replaced in `node_modules`, with the lockfile unchanged, by a pack of swarm-verify `patch/2.0.1` at
64ffac6 (the refused preparation, the judge in a process a signal ends, an absolute SWARM_HOME). The held-out judgment ran afterwards in a fresh clone at the base: an untracked
`swarm.toml` declares a test check running only the fix commit's test, that test is sealed with
`swarm-verify init --seal`, and the delivered patch is verified and replayed with swarm-verify
`patch/2.0.1` at 5363149, which carries the judge fixes these runs exposed. The visible checks
still come from the base commit; only the sealed check's command is narrowed, because each
repository's whole test command already fails at its base and would fail the held-out check
whatever the patch did.

Neither attempt completes, so the category stays host-verified only (t3 and c1). Both reasons
are recorded below; the driver is `fix-run.sh` and the witness `witness.sh` in the work root's
`patch-run/`.

| Pick | Commit | Session | State | Replay | Held-out (sealed test) | Model | Input / output tokens | Wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | depose 09b01c1 | 20261103T012746-36fbbf | incomplete | agrees | fails at the base, passes with the patch | gemma4:31b, escalated, Ollama auto | 132,103 / 4,844 | 568 s |
| 2 | claimcheck d2f136c | 20261103T015145-ff5ff2 | incomplete | agrees | fails at the base and with the patch | gemma4:31b, escalated, Ollama auto | 315,477 / 7,257 | 954 s |

- **depose 09b01c1**, "encode the timestamp in generated ULIDs". `generateUlid()` filled all 16
  bytes from the CSPRNG, timestamp prefix included. The delivered patch stamps `Date.now()` into
  the timestamp bytes unless a fixed seed is set, as the fix commit does, and adds its own test.
  The sealed test (`packages/core/test/events.ids.test.ts`, 12 tests) fails at the base and passes
  with the patch, in the container (`held-out/witness.txt`) and on the host
  (`held-out/host-before.out`: "encodes the current time in the timestamp prefix" fails;
  `host-after.out`: 12 of 12). No assertion was weakened: the patch adds a test file and changes
  `ids.ts` only. Incomplete because depose's `typecheck` and `build` fail at this base in the
  container (tsc project references; `make build-local` needs Go, which the Node image lacks): a
  check with no per-test report that fails before and after is unresolved, never a pass.
- **claimcheck d2f136c**, "a suite that fails to load must not read as passes-on-head". The
  delivered patch adds `failedToRun` to `runVitest`'s result, true only when no results file was
  read, and a test that mocks `exec` and `node:fs/promises`. R1 is satisfied by that test. The
  sealed test runs a real suite that cannot load and finds `failedToRun` false
  (`held-out/host-candidate.out`): vitest writes a results file for a load failure, so the patch
  does not fix the defect the task describes, and the model left the pipeline unchanged. The
  held-out check is what shows it (`held-out/verify.out`: "a held-out check failed"). The base
  also cannot typecheck anywhere: `claimcheck/src/core/pipeline.ts` imports `../coverage/collect.js`, which
  the commit does not contain.

Each directory holds `task.txt`, `start.txt` (base, fix commit, held-out path), `delivered.patch`,
`report.md`, `run.out`, `replay.out`, `session.txt`, `source-check.txt` and `held-out/` (the seal,
the verdict, its replay, the base and candidate held-out results). Both source repositories were
unchanged.
