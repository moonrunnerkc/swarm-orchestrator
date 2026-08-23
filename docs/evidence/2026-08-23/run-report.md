# Release-completion run report, 2026-08-23

One session, run start to finish on `v13-main` without pausing for approval. Every decision
point took the stated default; the decision and its reasoning are recorded in the decisions
section. Steps that could not run live are recorded as NOT-RUN or NOT-DONE with the exact
reason and the exact command, never synthesized.

This run continues from `../2026-08-18/run-report.md`, which is left in place as the record
of what was true then.

## 0. Preflight

| Check | Result |
| --- | --- |
| `node -v` | v24.15.0 (floor is 24; run proceeds) |
| `npm -v` | 11.12.1 (npm notices 12.0.2 is available; not taken mid-release) |
| Branch | `v13-main` at a5ce696b |
| Working tree | clean apart from untracked `RELEASE-COMPLETION-PROMPT.md` (the work list itself, not committed) |
| Baseline `npm run gates` | exit 0, 88 files, 1082 tests passed |
| Baseline `npm run fuzz:build` | exit 0, 8 harnesses, 84 seeds |
| `node scripts/check-invariant-drift.mjs` | exit 0, 12 invariants identical across CLAUDE.md and AGENTS.md |
| Container runtime | none: `docker`, `podman`, `nerdctl`, `lima`, `limactl`, `colima`, `orbctl` all absent; no container app in /Applications. Homebrew is present at /opt/homebrew/bin/brew |
| `gh` | 2.92.0, authenticated as `moonrunnerkc` (keyring), scopes `gist`, `read:org`, `repo`, `workflow` |
| `npm whoami` | not logged in (`ENEEDAUTH`) |
| Provider keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NPM_TOKEN` present in repo-root `.env` (names only; no value read or echoed) |
| Ollama, port 11434 | not running at preflight; started with `ollama serve`, then responds with 30 models |
| rapid-mlx, port 8000 | responds; serves `qwen3-coder:30b-a3b` |
| `$TERM` | `xterm-256color` (`COLORTERM=truecolor`) |
| `NO_COLOR` | unset |

Consequences carried into the rest of the run: the clean-container verification in phase 4
has no runtime at preflight and phase 4 begins by trying to install one. Everything needing a
local model can run; the frontier keys authenticate but were unfunded at the 08-18 run and are
re-checked in phase 6 rather than assumed.

The baseline is 88 files and 1082 tests, up from the 84 and 1021 the 08-18 run closed at. The
difference is the five commits that landed after it.

## Per-item status log

Appended as the run proceeds.

| Item | Status | Note |
| --- | --- | --- |
| 0. Preflight | done | table above |
| 1.1 Push `v13-main` | done | 10 commits, `2633f1c1..f16e7f70`, under owner bypass |
| 1.2 Push `v13.0.0` and `v12-final` | done | both confirmed by `git ls-remote --tags origin` and from a fresh clone |
| 1.3 v12 tag reachable from a clone | done | fresh clone in a temp directory; `git show v12-final:package.json` resolves and the v12 tree is intact |
| 1.4 Gates workflow on the pushed branch | done | run `32668575341`, success, 88 files / 1082 tests, fuzz smoke and drift check both in it |
| 1.5 Tag push fired the publish workflow | finding, recorded | run `32668579920` failed at `npm publish` with `E404 ... PUT https://registry.npmjs.org/swarm-orchestrator`. Nothing was published. The provenance statement reached the sigstore transparency log before the 404 (logIndex 2576965290) |
| 1.6 Tag push fired the v12 CD workflow | finding, no effect | run `32668579948`, from the workflows in the v12-final tree, stopped at its own interlock: `tag v12-final does not match package.json 12.1.1; refusing to publish`. No image, no package |
| 2.1 `main` holds nothing unique | done | `origin/main` and local `main` are both `b2b681ff`, which is exactly the commit `v12-final` points at. `git log origin/main..main` is empty |
| 2.2 Repoint default branch | done | `gh api -X PATCH ... -f default_branch=v13-main`, confirmed by `git ls-remote --symref origin HEAD` reporting `ref: refs/heads/v13-main` |
| 2.3 Branch-naming audit | done, one real defect fixed | README gates badge already names `v13-main`. The two curated-JSON URLs named `main` and answered 404; fixed in `4ca7aa0a` |
| 2.4 v12 reachable, changelog correct | done, one correction | tag reachable from a fresh clone. The changelog told v12 users to install `@12.1.1`, which the registry does not carry; corrected in `3f158e21` |

## Decisions, phases 1 and 2

**The v13.0.0 tag push triggered a publish attempt, and that was not the plan.** The work list
says to push both tags in phase 1 and to decide the published version in phase 7, after the
interface work has landed. Those two instructions are in tension, because `publish.yml` fires
on `v*`. The tag was pushed as instructed and the publish ran; it failed at the registry with
`E404` on the `PUT`, so nothing was published and phase 7 still has a free choice of version.
The failure is a credential, not a build: `npm pack` ran, `prepublishOnly` ran the gates, the
tarball was assembled at 268.9 kB over 234 files, and provenance was signed and logged before
the registry refused the write. The `NPM_TOKEN` repository secret exists and does not carry
publish rights for this package.

**Repointing the default branch stops six scheduled workflows.** GitHub fires `schedule`
triggers only from the default branch, and the six on `main` (`agent-stream`, `backward-mine`,
`codex-canary`, `complaint-mine`, `eg-viable-measure`, `pages`) belong to the v12 auditor
lineage. They stop firing as of the repoint. The build guide treats the repoint as a release
precondition, so this is a consequence taken knowingly rather than a surprise, and it is
written here so nobody later reads the silence as breakage. `weekly-scan.yml` on `v13-main`
becomes the scheduled workflow that does fire.

**The curated-JSON 404 was not what the 08-18 report expected.** That report predicted the
repoint would fix `hardware-select.md`'s shortlist 404, because the URL pointed at `main`. It
does not: `raw.githubusercontent.com/<owner>/<repo>/main/...` names the branch `main`, not the
repository's HEAD, so repointing HEAD leaves it resolving to the v12 tree, which carries
neither file. Both URLs now build from one ref that carries them, checked live: 404 before,
200 after.
