# Swarm Orchestrator v13: state of the system

- **Branch:** `v13-main`
- **Package:** `swarm-orchestrator@13.1.0`
- **Report date:** 2026-08-23
- **Supersedes:** `state-report-2026-08-17.md`, which is left in place as the record of what was
  true then. Where the two disagree, this one is current and says what changed.

Every status claim below names a file, a commit, a command and its output, or a CI run. Where
this session could not establish a fact, it is under
[Not verifiable from this session](#not-verifiable-from-this-session).

---

## 1. Repo state

### Branch and remote

| | |
| --- | --- |
| Default branch on origin | `v13-main`, repointed in this run from `main`, confirmed by `git ls-remote --symref origin HEAD` |
| `v13-main` on origin | in sync; every commit of this run is pushed |
| Branches on origin | 7: `v13-main`, `main`, `crossfire-converge-01`, `crossfire-fuzz-01`, `crossfire-fuzz-02`, `dogfood/tamper-demo`, `redteam/loop/lap-1-attack` |
| Local-only branches | none |
| Local-only tags | `phase-5-complete` and `phase-6-complete`, named as intentionally local in `evidence/2026-08-23/tag-and-branch-hygiene.md` |

The 08-17 report listed fifteen local branches and asked whether `schema-v1` was meant to be
dangling. Nine of those branches were ancestors of `v13-main` and are deleted, hashes recorded
first. Three carried unique commits, were local-only, and are pushed. `schema-v1` is decided:
it is the only reference to `79c9c856` anywhere, so it is kept, pushed, and documented by what
it tags rather than deleted to tidy a listing.

### Repointing the default branch stopped six scheduled workflows

`agent-stream`, `backward-mine`, `codex-canary`, `complaint-mine`, `eg-viable-measure` and
`pages` are scheduled on `main`, which is the v12 auditor lineage, and GitHub fires `schedule`
only from the default branch. They stopped as of the repoint. Taken knowingly, recorded in
`evidence/2026-08-23/run-report.md` rather than left to read as breakage. `weekly-scan.yml` on
`v13-main` becomes the scheduled workflow that does fire.

One of the six leaves something behind. `pages` stopped firing, but the site it last built is
still served: `https://moonrunnerkc.github.io/swarm-orchestrator/` redirects to a page titled
"Swarm Audit, Real-Corpus Leaderboard", which is the v12 cheat-detector registry. It is public,
it is under this repository's name, and it describes a product this repository no longer is. The
sidebar homepage field points at the README rather than at it, so nothing here links to it, but
that is not the same as it being gone.

Not touched by this run, and named rather than quietly left. Taking a public page down and
replacing a public page are both decisions with a reader on the other end, and neither is a
release-day judgement call: whoever makes it should decide between retiring it, redirecting it to
the README, and building a v13 page. `tech-debt.md` carries it.

### Package identity

`package.json` is at `13.1.0`. The registry carries `swarm-orchestrator` up to `12.0.0` and no
13.x: `npm view swarm-orchestrator versions` returns `["7.0.0-alpha.0","11.2.0","12.0.0"]`. The
08-17 report and build guide 5.1 both said the published v12 was 12.1.1; that is the version in
the tree the `v12-final` tag points at, and it was never published. Corrected in the changelog
and the build guide, since it was an instruction users would have followed into a 404.

---

## 2. Phase completion against the build guide

| Phase | 08-17 | Now |
| --- | --- | --- |
| 0, scaffold | implemented | unchanged |
| 1, an agent that codes | implemented, gate item unrecorded | gate recorded: real tasks completed end to end, including one through the published tarball in this run |
| 2, evidence | implemented | **gate fully met**: a bundle verifies in a container that has never seen this repository, and the same bundle one byte later is refused there |
| 3, gates and auto-resolve | implemented | unchanged |
| 4, hardware fit | code and synthetic tests, live gate unrecorded | one machine profiled, two not reachable. Still short of the three-profile gate, and says so |
| 5, calibration and routing | fixtures only | **live, and now ranking**: 180 runs across three models with distributions, a pick measured against two others |
| 6, optional scale-out | partial | unchanged |

---

## 3. What this run changed

### The interface

`src/tui` was a screen that rendered and took no input. It is now driven: scroll, expand a row
to its whole payload and the ledger record it came from, filter, move focus, pause the render
without touching the run, a help overlay, and two exits that are not the same thing. Interactive
state is a second type with its own reducer sharing no field with the ledger projection, so a
keystroke has no route to a verdict, asserted across every action by a test.

A finished run presents what it produced and offers to open it, saying the bundle verified only
where the embedded verifier ran in that session and exited zero. `swarm review <bundle>` shows
the same panel for any bundle on disk.

Full account, keymap, config surface and degradation matrix in
`evidence/2026-08-23/interface.md`, with frames from four real pty captures and a playable
asciinema recording beside it.

### Defects found and fixed at the root

Nine, each with a test in the same change:

| What | Where it came from |
| --- | --- |
| Two consumers of one stdin: readline and Ink raced on the confirmation path | reading `cli.ts` before extending the interface |
| The curated shortlist and pricing URLs named `main`, which carries neither file, so every machine fell back to the bundled snapshot | auditing branch names after the repoint |
| The changelog told v12 users to install `@12.1.1`, which the registry does not carry | asking the registry instead of the tree |
| A missing verifier reported as a bundle its verifier refused | writing the first test for a module that had none |
| A keychain entry that is not a key reported as an ASN.1 error, downgrading every run to a per-run key with no way to know why | a real run on this machine |
| The end of a run wrote over the screen it was running on | running a real task from the installed tarball in a terminal |
| The dist build would have shipped a test fixture | the asset discovery flagging a new non-TypeScript file |
| The documentation-pointer check resolved against the disk rather than the repository, twice | CI, twice, correctly |
| Local token counts were always zero, zeroing throughput and pricing every local run at $0.0000 | a calibration dimension reading 0.0 for 179 runs |

The last is the one worth naming twice: an OpenAI-compatible server streams no usage unless
`stream_options.include_usage` is sent, so the router had been learning that every local model
is free.

### The weekly scan, which had never run

Scheduled 08-18, never fired, dispatched by hand here. All three parts had something wrong:
osv-scanner was passed a flag it does not define and had never scanned anything; the issue it
files could not be filed for want of a label; semgrep worked and had 21 findings nobody had
seen. Fixed, label created, findings dispositioned by class in `security-coverage.md`. The
first real OSV result: 259 packages, no advisories, agreeing with `npm audit`.

It then fired on its own schedule the following morning, run `32697714165` at 06:31 UTC, with
nobody watching: osv-scanner read the lockfile rather than exiting 127, semgrep ran its 252 rules
over 6102 files, and the issue was filed under the label that had not existed a day before. That
is the part a hand dispatch cannot prove.

---

## 4. Red-team loop state

Unchanged by this run. The loop ledger still records one completed lap;
`redteam/loop/state/lap-accounting.jsonl` holds ten records setting out what each pass
directory actually was. `redteam/loop/lap-1-attack` is now on origin, because it is where the
08-18 run recovered the pass5 probe from and deleting it would have removed the provenance of a
restored artifact while leaving the artifact.

The four judge-shaped residuals in build guide 7.1 are open, described exactly as before, and
each is still a case in `src/evidence/redteam-adversarial.test.ts` asserting its gap. That
suite runs 49 green. Nothing in this run touched a check adjacent to any of them.

---

## 5. Verification infrastructure

| | |
| --- | --- |
| Fuzz harnesses | 8, all loading, `npm run fuzz:build` green over 84 seeds |
| Invariant drift | `scripts/check-invariant-drift.mjs`, 12 invariants identical across CLAUDE.md and AGENTS.md |
| Documentation pointers | `scripts/check-doc-paths.mjs`, new in this run, in CI: 230 references over 27 files, zero misses |
| Committed bundles | 6, every one verified by its own embedded verifier, all exit 0 |
| Clean-container verification | done, both arms, `evidence/2026-08-23/clean-container-verification.md` |
| Semgrep | 21 findings, dispositioned by class, none silenced |
| OSV | 259 packages, 0 advisories |
| `npm audit` | 0 vulnerabilities |

---

## 6. Test and gate state

| | 08-17 | 08-18 close | Now |
| --- | --- | --- | --- |
| Test files | 68 | 84 | 103 |
| Tests | 785 | 1021 | 1300 |

`npm run gates` is typecheck, then Biome, then the full suite, and exits 0. CI runs it on every
push together with the drift check, the documentation-pointer check, and the fuzz smoke.

Coverage over every source file, measured with `@vitest/coverage-v8`, reported and not chased:
chokepoint 98.3%, `src/core` 98.8%, `src/evidence` 94.4%, `src/gates` 94.2%, `src/tui` 75.7%,
whole tree 85.2%. The two real gaps are on the tech-debt list; the two that are shapes rather
than gaps say why in `docs/tech-debt.md`.

---

## 7. Interface state

| | |
| --- | --- |
| TTY, interactive | the single screen, driven by keyboard |
| Not a TTY | plain lines, byte-identical to a fixture captured before the work started |
| `--no-tui` on a TTY | the same plain lines, readline answering confirmations |
| `NO_COLOR`, `TERM=dumb`, `TERM` unset | no colour, no escape sequence in any row, every status still carrying a word |
| Below 80 columns | optional columns come off, nothing wraps |
| Any height from one row up | the layout never paints more rows than the window has |
| Config | `[interface]`, `[theme]`, `[keys]` in swarm.toml, validated at the boundary |
| `swarm calibrate` | no screen. It writes plain lines on a terminal and off one, so a three-model sweep, the longest run this tool does, is watched through a log. A sweep is not one run, so this is a second view rather than a call site, and it is on `tech-debt.md` |
| Flags | `--no-tui`, `--color`, `--no-color`, `--open-evidence`, `--no-open-evidence`, and `--help`, which used to be an error |

---

## 8. Release state

| | |
| --- | --- |
| Version | 13.1.0, minor because everything added is additive and nothing changed meaning |
| Tag | `v13.1.0`, annotated, pushed |
| GitHub release | `v13.1.0`, marked latest, so the repository sidebar names the v13 lineage rather than the v12 auditor it named before |
| `v13.0.0` | pushed, left where it is, the record of the tree it named. No release, never published |
| Tarball | 268 files, 311.8 kB packed, matching the `files` allowlist exactly. Nothing from `.env`, `.swarm/`, `redteam/`, `fuzz/`, no tests, no fixtures, no `src/` |
| Installed and run | yes: installed from the tarball into a clean directory, `swarm --help`, `swarm review`, and two real tasks end to end in a real pty, one green and one escalating at the file-set gate, both recorded in `evidence/2026-08-23/installed-package-run.md` |
| Published to the registry | **no** |

### What blocks publishing

One credential. `npm whoami` returns `ENEEDAUTH` here, and the `NPM_TOKEN` in the repository
`.env` is not a working token: `https://registry.npmjs.org/-/whoami` answers `{}` for it and the
package's collaborators endpoint answers 401. The same token is the repository secret the
publish workflow uses, which is why CI run `32668579920` assembled the tarball, ran the gates
through `prepublishOnly`, signed provenance into the sigstore transparency log, and was then
refused by the registry with `E404` on the `PUT`.

`npm login` needs a browser and an OTP, so it cannot be done from this session. Everything else
in the publish path is done and verified, and the tag push proved it end to end. CI run
`32685163550` on `v13.1.0` passed every step in order, the tag-matches-package.json check, the
gates through `prepublishOnly`, and `npm pack` at 268 files, then failed on the last one:

```
npm notice version: 13.1.0
npm notice total files: 268
npm error code E404
npm error 404 Not Found - PUT https://registry.npmjs.org/swarm-orchestrator - Not found
```

That is the registry refusing an unauthorized write, not a build problem. One command closes it,
and re-running the workflow needs no new tag:

    npm login                                    # a person, at a terminal, or a new repo secret
    gh workflow run publish.yml --ref v13.1.0

The publish workflow now refuses to publish a tag that disagrees with `package.json`. That
check was missing and this run needed it: the version bump was very nearly tagged onto a tree
still saying 13.0.0.

---

## 9. Drift and deltas

- `CLAUDE.md` and `AGENTS.md`: identical invariant blocks, 12 invariants, checked in CI.
- `docs/build-guide.md` section 4.2 now describes the interface that exists; section 7.1 is
  untouched, and the four residuals read exactly as before.
- `docs/security-coverage.md`: the `src/tui` entry now names the terminal-control boundary the
  interface introduced and what closes it; the `@types/node` note was stale in the other
  direction and now says where the version sits and why it stays there.
- `docs/claims.md`: four interface rows added, the container row now names an artifact instead
  of a NOT-RUN, and the calibration row names the three-model run.
- The banned list was re-read against everything this run wrote. Every occurrence of a banned
  phrase in the tree is inside the prohibition itself or the README's own disclaimer.

---

## 10. Not verifiable from this session

- Whether `swarm-orchestrator@13.1.0` installs from the registry. It is not published, and the
  blocker is the credential above.
- The edit-quality battery's frontier arm, 30 of 60 runs. Both keys in `.env` authenticate and
  neither has a balance, checked live.
- Hardware profiles for the other two machines. Not reachable from here, and a profile is a
  probe of a machine rather than a reading of its specification.
- Whether the six scheduled workflows on `main` were wanted. They stopped with the repoint; the
  decision to repoint is the build guide's, the consequence is recorded, and whether to move any
  of them onto the new default branch is a call this run did not make.
- The 21 semgrep findings beyond their classification. They are dispositioned by class from the
  run log; none was opened as a source review.
- Whether the `security` label existed before this run created it, beyond `gh label list` not
  showing it and `gh issue create --label security` failing.
- What the `swarm-orchestrator/bundle-signing-key` keychain entry on this machine actually is.
  It is nine characters and not an ed25519 key. It was left alone rather than overwritten,
  because overwriting an entry whose contents nobody recognizes is destroying something to fix a
  signature.
- Long-run fuzz budgets and coverage-curve numbers in `security-coverage.md`, which are
  historical and were not re-measured here.
