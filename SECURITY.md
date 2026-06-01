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

### Summary

| Path | Execution | Isolation | Rollback | Timeout |
|---|---|---|---|---|
| Patch apply (no-op) | N/A | N/A | N/A | N/A |
| Patch apply (diff / whole-file) | In-process file write | Path traversal guard, protected paths, truncation guard | ARIES rollback with SHA-1 verification | N/A |
| Obligation commands (build, test, property, perf) | `spawnSync` via `/bin/bash` in `repoRoot` | **None** — runs as invoking user | ARIES rollback after each obligation | 5 min default |
| Falsifier adapters (opt-in) | External CLI in its own sandbox | Per-adapter (see docs) | N/A — adapters operate on already-verified patches | Per-adapter timeout |
| Post-merge verification | `spawnSync` via `/bin/bash` in `repoRoot` | **None** — runs as invoking user | N/A — final pass | 5 min default |

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
