# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it privately via
[GitHub Security Advisories](https://github.com/moonrunnerkc/swarm-orchestrator/security/advisories/new)
rather than opening a public issue.

## Execution Model and Isolation

Swarm Orchestrator applies patches to the workspace and executes shell
commands as part of its core verification loop. This section describes
exactly what runs, where, and with what containment.

### Patch application

Patches are applied directly to the repository workspace on disk. The
orchestrator does **not** containerize, chroot, or sandbox the apply step.
Two patch formats are supported:

| Format | Applier | How it works |
|---|---|---|
| Unified diff (`--- a/… / +++ b/…`) | `src/population/unified-diff.ts` | Parses hunks with strict context-line matching. Writes files to the repo root. Rejects patches that don't match context lines exactly (no fuzz). |
| Whole-file (`<<<FILE path … FILE>>>`) | `src/population/whole-file-apply.ts` | Replaces the entire file content. Includes a truncation guard: if the new body is < 20% of the original line count and the original was > 30 lines, the block is rejected. |

**Path escape protection:** Both appliers reject absolute paths and paths
that traverse above `repoRoot` (using `path.relative` to detect `..`). This
prevents a malicious patch from writing outside the repository directory.

**Protected paths:** `file-must-exist` obligations with `body` content
register the path as "protected" — downstream patch appliers will not
overwrite or delete those files. This preserves contract-authored content
from being stomped by later persona patches.

### Rollback

After each obligation is verified, the workspace is rolled back to its
pre-apply state before moving to the next obligation. The rollback mechanism
(`src/population/rollback.ts`) is modeled on the ARIES UNDO phase (Mohan et
al. 1992):

1. **Snapshot before apply.** Before each applier runs, every file it will
   touch is hashed (`gitHashObject`-compatible SHA-1) and the original
   bytes are stored in `.swarm/snapshots/<run-id>/<obligation-index>/`.
   The hash pair `(preBlobSha, expectedPostBlobSha)` is recorded in the
   JSONL ledger as a `workspace-snapshot` entry.
2. **Verify.** The verifier runs the obligation's commands against the
   patched workspace.
3. **Rollback.** Each file is restored from the sidecar directory. After
   writing, the on-disk content is re-hashed and compared to `preBlobSha`.
   If the hash doesn't match, rollback returns `recovery-invariant-violated`
   and stops — the workspace state is considered unrecoverable.
4. **Idempotency.** Calling rollback twice is safe: if the current hash
   already equals `preBlobSha`, the file is treated as already-restored
   and skipped.
5. **State-mismatch detection.** If the on-disk hash matches neither
   `preBlobSha` nor `expectedPostBlobSha`, the workspace was mutated by
   something outside the orchestrator's control. Rollback returns
   `state-mismatch` with the offending path rather than silently
   overwriting.

### Command execution

Obligation verification commands (`build-must-pass`, `test-must-pass`,
`property-must-hold`, `performance-must-not-regress`) are executed via
Node.js `spawnSync` in `src/verification/run-verifier.ts`. Key properties:

| Property | Detail |
|---|---|
| Shell | `/bin/bash` (hardcoded). Bash-only syntax in predicates (`<(...)`, `[[ ]]`, `$'...'`) is supported. |
| Working directory | The repository root (`repoRoot`). Commands run in the project directory. |
| Timeout | 5 minutes per command by default (`--command-timeout-ms` overrides). |
| Environment | Full `process.env` is inherited. The orchestrator does not strip or sandbox environment variables. |
| Stdin | Closed (`'ignore'`). |
| Stdout/stderr | Captured; last 512 bytes of `stderr || stdout` included in the verification detail on failure. |

`property-must-hold` predicates are also run via `runPredicate()` in
`src/shared-predicates/predicate-runner.ts`, which uses `execSync` with the
same cwd and env propagation. This is the same code path the falsification
adapters use for their baseline check before spawning an LLM.

**There is no container, VM, or sandbox on the main verification path.** The
obligation commands run as the invoking user with the invoking user's
privileges. If a contract contains `rm -rf /` as a build command, it will
execute as-is. This is by design: the orchestrator is a contract verifier,
not a sandbox. Users who need isolation should run `swarm` inside a
container or VM (e.g. the GitHub Action runs in `actions/checkout`'s
container environment).

### Post-merge verification

After the tournament winner is selected and applied, a final
post-merge verification pass runs every obligation command again against
the patched workspace (`src/verification/post-merge.ts`). This ensures the
winner's changes pass all obligations simultaneously, not just individually.

### Falsification adapter sandboxing

Falsification adapters (Codex, Copilot, Claude Code) are external CLI tools
that run in their own sandbox postures. These are documented in
[docs/falsification-adapters.md](docs/falsification-adapters.md). The main
verification path does **not** use these adapters — they are opt-in and run
only when `--falsifiers on` is active.

### Snapshot cleanup

Per-obligation snapshots written under `.swarm/snapshots/<run-id>/` are
pruned after the run completes. Policies (`--snapshot-cleanup`): default
is `retain-on-failure` (drop on success, keep on failure). See
[docs/falsification-adapters.md](docs/falsification-adapters.md) for the
full policy list.

### Execution-grounded isolation

The execution-grounded audit layer (`src/audit/execution-grounded/`, opt-in via
`executionGrounded.enabled`, default off) provisions a real checkout of the PR
under audit and runs the repo's own toolchain against it: a git clone, a
dependency install (which executes the package's untrusted `postinstall`
scripts), an optional build, then diff-scoped mutation testing, a coverage run,
and any issue-linked repro. All of that is attacker-influenced code.

| Property | Detail |
|---|---|
| What runs | git clone/checkout, `npm ci` / pnpm / yarn / bun install (including `postinstall`), optional repo build, Stryker mutation run, coverage run, issue-repro execution |
| Where (host, default) | A `mkdtemp` checkout under the run's base dir; every command runs there as the invoking user |
| Where (`runner: docker`) | Mutation, coverage, and issue-repro run inside a container built from this repo's `Dockerfile` (`--rm`, only the checkout bind-mounted). Clone and install stay on the host |
| Environment | Deny-by-default allowlist (`exec-env.ts`): the child sees only a toolchain-pinned `PATH`, `HOME`, locale/tmp/cert vars, and headless forcing. `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, and anything else are dropped unless named in `SWARM_EG_ENV_PASSTHROUGH`. In docker only the headless and passthrough vars cross the boundary |
| Network | Inherited from the host on the host runner; `--network none` in docker (override `SWARM_EG_DOCKER_NETWORK`) |
| Timeout | Per-command cap, 5 minutes by default (`SWARM_EG_COMMAND_TIMEOUT_MS`); on timeout the command's whole process group is SIGKILLed, so a forked dev server cannot outlive it |

**Residual risk, stated plainly.** The host runner has no filesystem, process,
or network isolation beyond the env scrub. Untrusted `postinstall` scripts and
the PR's own test code run as the invoking user: they can read any file that
user can read and reach the network. The env allowlist removes the auditor's
credentials from their reach, but it is not a sandbox. Run the execution-grounded
layer only against PRs you would be willing to install and test locally, or set
`executionGrounded.runner: docker` to confine the mutation, coverage, and
issue-repro execution to a network-isolated container. Even in docker mode the
dependency install (and its `postinstall`) still runs on the host; full install
containerization is a follow-up. The docker path relies on native-docker
bind-mount writeback to read back its reports (rootless or userns-remapped
daemons may not propagate writes), and a timed-out `docker run` can orphan its
container.

### Summary

| Path | Execution | Isolation | Rollback | Timeout |
|---|---|---|---|---|
| Patch apply (no-op) | N/A | N/A | N/A | N/A |
| Patch apply (diff / whole-file) | In-process file write | Path traversal guard, protected paths, truncation guard | ARIES rollback with SHA-1 verification | N/A |
| Obligation commands (build, test, property, perf) | `spawnSync` via `/bin/bash` in `repoRoot` | **None** — runs as invoking user | ARIES rollback after each obligation | 5 min default |
| Falsifier adapters (opt-in) | External CLI in its own sandbox | Per-adapter (see docs) | N/A — adapters operate on already-verified patches | Per-adapter timeout |
| Post-merge verification | `spawnSync` via `/bin/bash` in `repoRoot` | **None** — runs as invoking user | N/A — final pass | 5 min default |
| Execution-grounded checks (opt-in) | `spawnSync` in a temp checkout, or `docker run` when `runner: docker` | Env-scrubbed allowlist (host); plus bind mount, `--network none`, process-group kill (docker) for mutation/coverage/repro | N/A — disposable checkout, removed after the run | 5 min/command default |

## Secret Handling

All credentials must be passed as environment variables. The orchestrator
never reads secrets from config files, CLI arguments, or `with:` inputs.

| Secret | Required For | Scope |
|--------|-------------|-------|
| `ANTHROPIC_API_KEY` | `--extractor anthropic` / `--session anthropic` | Anthropic API access |
| `OPENAI_API_KEY` | Codex falsifier (`src/falsification/adapters/profiles/codex.ts`) | OpenAI API access |
| `GITHUB_TOKEN` | Copilot falsifier (`src/falsification/adapters/profiles/copilot.ts`), PR creation | Repo contents + PRs only |

### GitHub Actions Usage

Always pass secrets via the `env:` block, never via `with:` inputs:

```yaml
- uses: moonrunnerkc/swarm-orchestrator@v9
  with:
    goal: "Your goal here"
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Always set minimal workflow permissions:

```yaml
permissions:
  contents: write
  pull-requests: write
```

### Credential Policies

- Use fine-grained GitHub PATs with only `contents:write` and
  `pull-requests:write`. Set expiry to 30 days or less.
- Rotate API keys on a regular cadence (30-90 days).
- Never commit `.env`, key files, or credentials to the repository.
- Session artifacts (transcripts, session state) are automatically
  redacted for known secret values at the end of every run.

### Cloud Code / Google Cloud

- Preferred: Workload Identity Federation (zero static secrets).
- Fallback (only if WIF is impossible): Short-lived service-account
  keys (1 hour max) passed via GitHub Secrets. Long-lived JSON key
  files are deprecated and should not be used.

## Nondeterminism

The deterministic provider (`--extractor deterministic` / `--session
deterministic`) is the default and produces reproducible results: same
goal, same contract, same patches, same verification outcome. The ledger
records every input and hash so runs are auditable.

Model-backed providers (`anthropic`, `local`) introduce nondeterminism
by nature, even with grammar constraints and seed parameters. Specifically:

- **Extractor output** (contract compilation from a natural-language goal)
  may differ between runs. `contractHash` will vary across runs even with
  identical goals. The ledger records the exact contract used.
- **Session output** (patch generation) may differ between runs. When
  using the `local` provider with `LOCAL_LLM_SEED`, the seed is recorded
  in the ledger, but reproducibility is bounded by what the backend itself
  honors.
- **Cost caps** (`--cost-cap`) limit cumulative spend but do not make
  model output deterministic. A cost-cap abort is recorded in the ledger
  as a `candidate-stream-aborted` entry.

Users who need bit-for-bit reproducibility should use the deterministic
provider with hand-authored contracts and patch queues. Users evaluating
model-backed results should compare contracts and outcomes qualitatively,
not by `contractHash` equality.

## .gitignore

Verify the following patterns are present in `.gitignore`:

```
.env*
*.key
*.pem
service-account*.json
```
## Audit coverage note

As of v11 the audit surface also covers two semantic cheat classes,
`goal-not-fixed` and `cheat-mock-mutation`, via a judge-primary path that
reads the PR's stated claim against the diff. This is advisory and
probabilistic: injected recall proves detection of the classes we inject,
not of unobserved classes, and the judge-primary false-positive rate is
measured against presumed-clean PRs. Do not treat a passing audit as proof
a PR is free of semantic defects.

## What can block a merge

`swarm audit --mode advise` (the default) never blocks. `--mode gate` blocks
only on verifiable runtime evidence, never on a structural detector's opinion:
that opinion is scored against an AI-labeled corpus where its precision is 0
(`benchmarks/real-corpus/promotions.json`), so a detector cannot earn a block.

A block instead comes from one of three self-certifying triggers, each carrying
the exact command to reproduce it: a fix claim the linked issue's repro still
contradicts (`claim-falsified`), a structural finding a surviving mutant or
coverage gap corroborates on the same changed line
(`corroborated-under-constraint`), or a declared contract obligation that fails
on the patched workspace (`obligation-failure`). A trigger's trustworthiness is
calibrated against whether the PRs it fired on were actually reverted or
hotfixed, not against any label. A trigger may gate only when that
revert-calibrated Wilson 95% lower bound clears 0.90 with at least 5 confirmed
reverted true positives; `npm run block-policy:check` enforces this in CI and
refuses a threshold tuned below the floor.

Current status: no trigger clears the bar
(`benchmarks/real-corpus/block-eligibility.json`,
`benchmarks/real-corpus/BLOCK-REPORT.md`), so `block-eligible` is 0 and gate
mode blocks nothing on its own today. When a trigger clears the bar, the
eligible set is bumped in source in the same commit and gate mode blocks on it
with the evidence and reproduce command attached to the PR comment. The bar is
never lowered to admit a trigger.
