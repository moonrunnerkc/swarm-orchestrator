# Swarm Orchestrator

The coding agent. Give it an engineering task; it makes the change, checks each requirement,
repairs supported failures, and returns the patch with evidence of what is complete and what
remains uncertain. It consumes Swarm Verify, the standalone verifier, as an exact-version
runtime dependency through the verifier's public API
([ADR 0015](docs/adr/0015-coding-agent-consumes-standalone-verifier.md)). How a run works is in
[docs/architecture.md](docs/architecture.md).

## Commands

- `npm run gates`: checks, caps, typecheck, lint, the unused-code check and the full test suite.
  This defines green, and CI runs exactly this.
- `npm run checks`: documentation paths resolve against what git tracks.
- `npm run caps`: the size caps below.
- `npm run unused`: Knip, with no unused export, file or dependency allowed.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run format`.
- `npm run build`: the `swarm` CLI into `dist/`.

Run `npm run gates` before every commit and say plainly what failed or was skipped. Local
commits, pushed code, passing CI and published packages are separate facts.

## Ownership

- This repository owns task interpretation, repository instructions, model selection, the edit
  loop, repair, the managed workspace, session data and the final requirement report.
- `moonrunnerkc/swarm-verify` owns verification: the request and result schema, test-result
  normalization, acceptance authority, isolated execution, dependency provenance, attestations
  and offline evidence validation. Requirement statuses and the overall state are derived
  there and only there. This repository reads them; it never reimplements them.

## Layout

- `src/cli.ts`: the `swarm` entry and its subcommands (`run`, `verify`, `init`, `ci`, `doctor`),
  one small module each, dispatched by `src/cli-main.ts`.
  `verify`, `init` and `ci` are the installed verifier's own commands (`swarm-verify/cli`).
- `src/agent`: the `run` loop. One bash command or one file edit block per turn, a probed
  platform block at the head of the prompt, the verifier as the judge.
- `src/tools`: the one execution chokepoint, the executor every command runs through (a
  container from `swarm-verify/execution` by default, the host only with `--host`), and the
  lexical path policy.
- `src/conventions`: the approved coding-conventions profile: its file under `SWARM_HOME`, the
  proposal a developer edits and approves, and the snapshot one run works under.
- `src/evidence`: append-only hash-chained records, canonical JSON, scrubbing with the
  verifier's credential detector.
- `src/runtime`: model discovery, readiness probes, selection, and the per-machine record of
  finished runs, which counts only what a run says about its model.
- `src/config`: the `[agent]` table of `swarm.toml`, optional, validated with Zod.
- `scripts/adopt-verifier.mjs`: pins `swarm-verify` to an exact packed tarball by integrity.
- `scripts/packed-consumer.test.mjs`: installs the packed agent beside the pinned verifier
  tarball in a fresh prefix and runs one task through both.

## Invariants

1. Model output is a claim; only harness-captured output is evidence. What the user requires
   (the task, and each part of it set apart) is fixed before the first edit; a model may propose
   mappings, checks and suggestions of its own, never change that set. Only verifier and report
   code set a status. Another
   model's agreement is never execution evidence. Unverified is its own status and never counts
   as satisfied.
2. Every command the agent runs passes through the chokepoint and its one executor. There is no
   second way to run a command, and no route to the host except the user's `--host`. A
   container that cannot be made blocks the run. Credential paths (`.env*`, `*.pem`, `*.key`,
   `.git/config`, `~/.aws`, `~/.ssh`) are denied by the path policy as well, which is lexical
   and not a boundary: the container is.
3. Evidence records are append-only and hash-chained. A failed write aborts the run. History
   is never rewritten or silently repaired. Call it tamper-evident evidence, never tamper-proof,
   and keep execution assurance and evidence integrity as separate fields.
4. Child processes get an environment built here, never the parent's credentials or loader
   options.
5. Known credential patterns are scrubbed from evidence by one shared detector. This is
   known-pattern scrubbing, not secret removal.
6. Every boundary (config, model responses, verifier requests and results) is validated with Zod.
7. Session evidence lives outside the workspace, owner-only (0700 directories, 0600 files).
   Signing keys come from the environment or the OS keychain, never the workspace.
8. Repository instruction files (`AGENTS.md`, `CLAUDE.md`) shape the model's work. They are
   untrusted input to the supervisor's policy: they cannot grant key access, change acceptance
   authority or relax execution policy.
9. A conventions profile is approved only by the developer's own command and lives where the
   worker cannot write. A run reads it once. Learning counts syntax; it never asks a model and
   never takes an instruction from a sample.
10. Derived requirements keep their own source (`profile`, `security`), and applicability that
    cannot be told is reported as unknown, never as not applicable.

## Caps

`scripts/check-caps.mjs` fails the gates when any of these is exceeded: 300 lines in any `.ts`
file, 15,000 non-test lines under `src/`, six runtime dependencies, five subcommands, three
workflow files. Tests are not capped: boundary tests are the point.

## Code style

- Strict TypeScript with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, ESM,
  Node 22.13 or newer at runtime and Node 24 in development and CI.
- Named exports only. Kebab-case filenames. Tests sit beside their sources. Split a file by
  responsibility, not by line count.
- No em dashes anywhere: code, comments, strings, documentation or commit messages.
- Comments are brief and only where the code needs them: intent, an invariant, a non-obvious
  choice. Code reads as handwritten.
- Errors are typed and say what to do. Prefer the standard library; a new runtime dependency
  needs a one-line justification in `docs/DECISIONS.md`.
- No placeholder code, artificial passes, skipped tests or suppressed diagnostics.

## Working rules

- Fix the cause of a failing check. Never weaken, skip, mock around, or lower a threshold to
  get green. A test of behavior deleted on purpose is deleted with it.
- Source, tests, manifests, lockfiles and configuration may change together when the task
  needs it. What may not change is the authority that judges them.
- Open choices go in `docs/DECISIONS.md`, dated, with the reason; the file is append-only.
  Unrelated defects found along the way go in `docs/known-issues.md` with a reproduction. Work
  deliberately left undone goes in `docs/FOLLOW-UPS.md` as one line.
- The active documentation is the README and the four guides under `docs/` (getting started,
  reference, troubleshooting, architecture). Keep them current with the code in the same change.
  Do not add plan hierarchies, run diaries or raw logs to the tree: evidence of a measured run
  goes under an `archive/` tag, indexed in `docs/history.md`, and a release's story goes in the
  changelog.
- Development, CI and evaluation runs never write the machine's default model record: set
  `SWARM_HOME`, or pass `--profile` or `--no-record`.
- Never write a number you did not measure. A measured number cites the command, test or
  evidence file it came from. `docs/results.md` is the generated history of the three-arm and
  tamper evaluations.
- Every new mechanism needs a concrete user outcome, a behavioral test, and a stated removal
  condition if it fails to help.
- Do not build a plugin system, database, daemon, web server, provider registry, vector store,
  planner framework or a second agent loop. Session and profile data are files.
