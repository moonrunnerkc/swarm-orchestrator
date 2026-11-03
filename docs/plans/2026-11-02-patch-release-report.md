# Patch release report: swarm-orchestrator 16.0.1, swarm-verify 2.0.1

Carried out 2026-11-02 to 2026-11-03 in the clones under `/Users/brad/projects/recovery-2026-10-31`.
Every command's outcome is in that directory's `run-log.md` and `patch-run/` (outside both
repositories); the acceptance evidence is docs/acceptance/2026-10-31/ here.

## 1. Commits, tags and versions

| Repository | Start | End | Tags |
| --- | --- | --- | --- |
| swarm-orchestrator | `v13-main` a19734be8 | `v13-main` 8f5b616027a87c4b2194301cf7e515a3c3c54ac6, then the commit adding this report | `v16.0.1` at 8f5b61602 |
| swarm-verify | `main` 9e8e4d1 | `main` b49b7ff8f83c7ec4d7e4999537c049232b5b3d7e | `v2.0.1` at fb4af912c61c48dfdac0518e20813f6b5e327b30; `v2` moved 53b6473 to fb4af91 |

swarm-orchestrator, a19734be8..8f5b61602 (10 commits): bf1029418, 1f5dc58b7, 3a7f2ea0c (the three
loop fixes), 3ee6c19ab (decision log), b4e252a49 (isolated fix runs), 7e86c0f2d (comparison and
the t6 correction), ea9cf1456 (decision log), f1ec5cf02 (t6 rerun against 2.0.1), 450982ccd (pin
swarm-verify 2.0.1), 8f5b61602 (Release 16.0.1).

swarm-verify, 9e8e4d1..b49b7ff (12 commits): af0cac4, 87039be, 8e0527d, dcdf154, 64ffac6,
7017d91, 5363149, 4e53b13, 3b67eb7, d2f0df0, fb4af91 (Release 2.0.1), b49b7ff (release record and
tamper rerun, documents only, after the tag).

No commit in either range carries an attribution trailer (`git log --format=%B` of both ranges:
0 `Co-Authored-By`, `Claude-Session` or "Generated with" lines).

| Package | Registry | Integrity | Published by |
| --- | --- | --- | --- |
| swarm-verify 2.0.1 | `latest` | sha512-T6CpawLgt4AqmnFsuEbotztSOpOIfnmN/Qy6VlgHQeeD0A02gvlEjGsd2UYMSQAU5oj6D0A6IZPXpr0WHTudpg== | the workstation, from a pack of a fresh clone at fb4af91, with Brad's browser approval; no provenance statement |
| swarm-orchestrator 16.0.1 | `latest` | sha512-Ei0XFJYaIsMqX4nGJhwXTwp91uCbscJ7Br96VdiX2PPR35+tSxYcqlzV+hm9MnyNEwPKz70en9Llt9nkXVJwpA== | release workflow run 41716229546, with provenance (sigstore log index 3679187279) |

`npm view swarm-orchestrator@16.0.1 dependencies`: `{ zod: '^4.4.3', 'smol-toml': '^1.8.0',
'swarm-verify': '2.0.1' }`. The lockfile resolves
`https://registry.npmjs.org/swarm-verify/-/swarm-verify-2.0.1.tgz` with the integrity above.

## 2. Defects

Each has a test that failed before its fix; the before-fix output is in `patch-run/` in the work
root.

| Defect | Failing before | Commit |
| --- | --- | --- |
| No-progress missed 36 reruns of one passing vitest file, whose output prints its clock | `src/agent/no-progress.test.ts` "stops as no progress at the second result identical to the first" (`defect-1-2-before.out`) | bf1029418 |
| The same requirements block, resent 29 times without the marker, never stopped the loop | same file, "stops as no progress on the second identical block in a row, keeping the record" (`defect-2-before.out`) | 1f5dc58b7 |
| A relative path after `cd` was read from the workspace root, refusing four recorded commands and allowing `cd .git && cat config` | `src/tools/cd-paths.test.ts`, 10 of 11 failing (`defect-4-before.out`) | 3a7f2ea0c |
| Replay of a refused dependency preparation diverged (recorded as `none`) | `swarm-verify/src/api/replay.integration.test.ts` "records the refusal and its reason, and the replay meets the same refusal" (`defect-3-before.out`) | swarm-verify af0cac4 |
| The baseline said "no checks are declared" when preparation stopped the base | same file, "says the base went unmeasured because of the refusal" (`baseline-reason-before.out`) | swarm-verify 87039be |
| A judged process ended by SIGTERM read as tampering (vitest's pool) | `swarm-verify/src/verify/judge.test.ts` "checks a process ended by SIGTERM" (`judge-signal-before.out`) | swarm-verify dcdf154 |
| A relative `SWARM_HOME` lost the sealed held-out checks | `swarm-verify/src/probes/isolated.integration.test.ts` "runs a sealed held-out check with SWARM_HOME given relative" (`home-before.out`) | swarm-verify 64ffac6 |
| A worker thread its runner terminated read as a held-out failure | `swarm-verify/src/verify/judge.test.ts` "counts a thread its runner terminated as unchecked" (`judge-thread-before.out`) | swarm-verify 5363149 |
| A test file moved and edited was read as deleted, its tests "gone", and both copies ran | `swarm-verify/src/probes/edited-move.integration.test.ts`, 2 of 2 (`edited-move-before.out`) | swarm-verify 4e53b13 |
| The one mutant could land inside a multi-line docstring or comment | `swarm-verify/src/verify/mutation.test.ts` "mutates no line inside a multi-line string or comment" (`mutation-docstring-before.out`) | swarm-verify 3b67eb7 |
| The release workflow would publish a version already on the registry | none: workflow change; run 41715408010 took the comparison path on v2.0.1 and found the registry's bytes equal to the tag's pack | swarm-verify 7017d91 |

## 3. Evidence

| Claim | Evidence |
| --- | --- |
| Gates at the release heads | orchestrator 8f5b61602: 55 files, 404 tests, exit 0 (`patch-run/gates-16.0.1-orch.out`); swarm-verify b49b7ff: 43 files, 246 tests, exit 0 (`patch-run/gates-sv-released.out`) |
| CI on both default branches | orchestrator `v13-main` 8f5b61602: run 41716200786 success; swarm-verify `main` b49b7ff: run 41718397448 success (fb4af91: 41585275028 success) |
| swarm-verify registry bytes are the tag's | release run 41715408010, "swarm-verify@2.0.1 on the registry is this commit's pack"; the work tree and a fresh clone at fb4af91 pack to the same integrity |
| The `v2` Action alias | action-smoke run 41715655881 resolved `moonrunnerkc/swarm-verify@v2` to fb4af91 and passed |
| Tamper evaluation of the released verifier | at fb4af91: 20 honest, 0 flagged; 24 of 24 cheats flagged (`swarm-verify/eval/results/tamper-2026-11-03T21-02-15-908Z.json`); the same at 4e53b13 |
| Integrity suite | 15 of 15 at swarm-verify 3b67eb7 (`patch-run/integrity-3b67eb7.out`); fb4af91 changes no source after it |
| Clean install | into an empty prefix: `swarm --version` 16.0.1, `swarm-verify --version` 2.0.1, the orchestrator's own swarm-verify 2.0.1; `swarm doctor --models` exit 0, 9 models probed ready, 8 excluded before loading with reasons (4 served remotely, 2 not chat models, 1 context under 65,536, 1 with no stated attention shape) (docs/acceptance/2026-10-31/e-dossier-installed-16.0.1/clean-install.txt) |
| Dossier through the clean install | session 20261103T205635-acc4bd, `--model auto` chose swarm-redesign-qwen36-32k, isolated (docker node:24), ironroot cloned beside and built: incomplete, no-progress after 14 turns, 120 s; replay agrees; dossier and ironroot unchanged (`e-dossier-installed-16.0.1/attempt-1/`) |
| t6 against 2.0.1 before the changelog | closing attempt 3, session 20261103T175257-900062, gemma4-31b-greedy-128k: incomplete at the time budget, the three test files moved byte for byte, the same 7 fixture tests failing, read as moved and attributed by 2.0.1; replay agrees; tracemantle unchanged (docs/acceptance/2026-10-31/t6-tracemantle/closing-attempt-3/) |
| Isolated fix runs | depose 09b01c1 and claimcheck d2f136c, neither complete; fix category stays host-verified only (docs/acceptance/2026-10-31/f-fix-isolated/) |

The dossier run through the clean install did not complete, where the 16.0.0 one did: the
model's two `sed -i` edits failed on macOS sed, so `fs-walk.ts` never changed, and it then read
the file three turns running. That stop is the unchanged three-repeat rule on identical `cat`
output, not the new comparison. No escalation followed: escalation goes only to a strictly
larger model, and the chosen one was the largest eligible. The install, isolation, verdict and
replay worked; the task's outcome is the model's.

## 4. What remains open

- **t6 cross-module refactor has no complete local-model run.** Reproduce:
  `acceptance/closing/run-task.sh t6-tracemantle --model gemma4-31b-greedy-128k --context 65536`
  in the work root; judge any patch with docs/acceptance/2026-10-31/t6-comparison/README.md.
  Recorded in docs/known-issues.md and the 16.0.1 changelog.
- **The agent is not told it runs on macOS; BSD `sed -i` fails it.** Both 2026-11-03 local runs
  met it (dossier ledger records 28 and 31; t6, six commands). Reproduce: `sed -i "s/x/y/"
  README.md` on macOS, or `acceptance/closing/run-task.sh smoke-dossier --model auto`. Recorded in
  docs/known-issues.md; a prompt change is past 16.0.1.
- **The fix category is host-verified only.** Neither isolated fix run completed; reproduce with
  `patch-run/fix-run.sh` as recorded in docs/acceptance/2026-10-31/f-fix-isolated/README.md.
- **swarm-verify 2.0.1 has no provenance statement.** Published from the workstation by the
  fallback Brad chose; the registry's bytes equal the tag's pack (release run 41715408010).
- **The orchestrator's `NPM_TOKEN` bypasses two-factor authentication**, and npm's notice in run
  41716229546 says such tokens "are being restricted for account changes and direct publishing".
  16.0.1 published; a later release may not by this route.

## 5. Branch and secret state

- `patch/16.0.1` and swarm-verify `patch/2.0.1` are deleted locally and on origin, each an
  ancestor of its default branch when deleted.
- swarm-verify on origin: `main` and `docs/readme-replay` (9e8e4d1, merged, left for Brad as in
  the hygiene entry). swarm-orchestrator on origin: `v13-main`, `main` and the older branches the
  closing report listed, unchanged by this release.
- `gh secret list -R moonrunnerkc/swarm-verify`: empty. swarm-orchestrator: `ANTHROPIC_API_KEY`
  and `NPM_TOKEN`, as before.
- Every git repository under `/Users/brad/projects` except the work root has the same head,
  status, worktrees and stashes as at the closing run's restore check
  (`acceptance/closing/restore-E.txt` in the work root), no reflog entry since 2026-11-02 12:00,
  and no swarm clone beside it (`patch-run/restore-patch.txt`). Brad's checkout
  `/Users/brad/projects/swarm-orchestrator` is clean at cce4bde43, behind `origin/v13-main`, not
  worked in.
- Ollama is stopped. colima `swarm-eval` runs the gates for this report's commit and is stopped
  after it, with the docker context set to default; the check follows the printed report.
