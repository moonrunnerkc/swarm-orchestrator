# Swarm Orchestrator

Two small products on one implementation ([ADR 0014](docs/adr/0014-verifier-first-rebuild.md)):

- **swarm-verify** reruns a project's declared checks on a change in a clean checkout, refuses
  changes that edit protected paths, runs held-out checks, measures changed-line coverage and
  one mutation pass, and emits a signed in-toto Statement in a DSSE envelope.
- **swarm run** is a single-bash-tool agent loop that calls the verifier and nothing else.

## Commands

- `npm run gates`: checks, typecheck, lint and the full test suite. This defines green. The
  caps check joins it once the rebuild brings the tree under the caps.
- `npm run checks`: documentation paths resolve against what git tracks.
- `npm run caps`: the size caps below.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run format`.
- `npm run build`: the `swarm` CLI into `dist/`. `npm run build:verify`: the verifier package.

Run `npm run gates` before every commit and say plainly what failed or was skipped. Local
commits, pushed code, passing CI and published packages are separate facts.

## Layout

- `src/cli.ts`: the `swarm` entry and its subcommands, one small module each.
- `src/swarm-verify.ts`: the verifier's entry. Its closure may not reach a model client, the
  agent loop or a terminal interface; the verifier build enforces that.
- `src/tools`: the one execution chokepoint and the lexical path policy.
- `src/exec`: child environments built from scratch, process groups, the process runner.
- `src/evidence`: append-only hash-chained records, canonical JSON, signing, scrubbing.
- `src/config`: `swarm.toml`, validated with Zod.
- `packages/swarm-verify`: the published verifier package and its GitHub Action manifest.

## Invariants

1. Model output is a claim; only harness-captured output is evidence. No code path lets model
   prose render a passing verdict. Unmeasured is its own result and never counts as a pass.
2. Every command the agent runs passes through the chokepoint under the path policy. There is
   no second way to run a command. Credential paths (`.env*`, `*.pem`, `*.key`, `.git/config`,
   `~/.aws`, `~/.ssh`) are denied by default. The policy is lexical, not a sandbox.
3. Evidence records are append-only and hash-chained. A failed write aborts the run. History
   is never rewritten or silently repaired.
4. Child processes get an environment built here, never the parent's credentials or loader
   options.
5. Known credential patterns are scrubbed from evidence by one shared detector. This is
   known-pattern scrubbing, not secret removal.
6. Every boundary (config, model responses, statements, predicates) is validated with Zod.
7. Session evidence lives outside the workspace, owner-only (0700 directories, 0600 files).
   Signing keys come from the environment or the OS keychain, never the workspace.

## Caps

`scripts/check-caps.mjs` fails the gates when any of these is exceeded: 300 lines in any `.ts`
file, 15,000 non-test lines under `src/`, test lines above non-test lines, six runtime
dependencies, five subcommands, three workflow files. A change that needs more removes
something first.

## Code style

- Strict TypeScript with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, ESM,
  Node 22 or newer at runtime and Node 24 in development and CI.
- Named exports only. Kebab-case filenames. Tests sit beside their sources.
- No em dashes anywhere: code, comments, strings or documentation.
- Comments are brief and only where the code needs them: intent, an invariant, a non-obvious
  choice. Code reads as handwritten.
- Errors are typed and say what to do. Prefer the standard library; justify any new
  dependency in one line of the PR description.
- No placeholder code, artificial passes, skipped tests or suppressed diagnostics.

## Working rules

- Fix the cause of a failing check. Never weaken, skip, mock around, or lower a threshold to
  get green. A test of behavior deleted on purpose is deleted with it.
- Open choices go in `docs/DECISIONS.md` as one line with the reason. Work deliberately left
  undone goes in `docs/FOLLOW-UPS.md` as one line.
- The only page that states measured numbers is `docs/results.md`, written by the evaluation.
  Never write a number anywhere else, and never estimate or extrapolate one.
- Do not build a plugin system, database, daemon, web server, planner, retrieval index or a
  second agent loop. Nothing watches the agent mid-run; the verifier measures its final tree.
