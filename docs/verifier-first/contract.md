# swarm-verify 1.x: the stable contract

What a consumer of the `swarm-verify` package and the `moonrunnerkc/swarm-verify` Action may
rely on within the 1.x major. A change to anything listed here is a breaking change and
takes a new major with a written migration; an addition is compatible and takes a minor.
Formats keep their version fields so a reader can tell which one it holds, and every reader
this package ships keeps reading every earlier version named here.

## Runtime and platforms

| Requirement | Contract |
| --- | --- |
| Node | 22.0.0 or newer. Every command runs on the floor; the changed-line coverage measurement runs on 22.8 or newer and reports `unmeasured` below it, never a pass. |
| git | required for `check`, `ci`, `gates`, `pre-commit` and the Action. |
| Linux, macOS | every command. |
| Windows | `verify`, `verdict`, `--help`, `--version`. The commands that run project checks need a POSIX shell and report that on Windows; WSL runs everything. |
| Dependencies | `zod` and `smol-toml` only. No provider, model, worker or screen module is in the package, and a build that crosses that boundary is refused. |

Held by `.github/workflows/verifier-matrix.yml`, which installs the packed tarball on every
row above and runs the same eighteen cases through the installed entry.

## Commands

| Command | Stable surface |
| --- | --- |
| (none) | the same as `check` over the current directory |
| `check [--workspace <dir>] [--package <dir>]* [--explain] [--json] [--bundle <dir>] [--base <ref>]` | discover, run unattended, five conclusions |
| `ci --patch <file> \| --branch <ref> \| --pr <owner/repo#n>` with `--workspace`, `--base`, `--goal-contract`, `--challenges off\|report\|required`, `--package`*, `--install`, `--oracle`, `--oracle-only`, `--immutable`, `--isolation`, `--require-isolation`, `--summary`, `--bundle`, `--json` | verify a change in a fresh checkout of its base |
| `verify <bundle> [--signer <fp>]*` | a bundle's integrity and its signer |
| `verdict [<verdict.json>] [--evidence <dir>] [--repo <owner/repo>] [--signer-workflow <ref>]` | a signed verdict against its evidence and an expected signer |
| `gates [--workspace <dir>] [--base <ref>] [--package <dir>]* [--allowed-files <a,b>] [--isolation <runtime[:image]>] [--bundle <dir>]` | the gates over a workspace |
| `hook install\|uninstall\|run [--scope project\|user] [--settings <file>] [--workspace <dir>]` | the Claude Code hook |
| `mcp [--root <dir>] [--describe]` | the local MCP server over stdio |
| `pre-commit [install\|uninstall] [--workspace <dir>] [--json]` | the staged-tree verification and its git hook |
| `action verify\|comment\|retain` | the Action's steps, read from the runner's environment |
| `--help`, `--version` | usage; the package version |

Unknown flags are accepted and ignored today; a future minor may refuse them, so a consumer
should not rely on passing one. A flag listed here keeps its name and meaning through 1.x.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | acceptable: a regression-only pass from `check` and `pre-commit`, a verified change from `ci`, a valid bundle with a trusted signer from `verify`, a bound document with a trusted signer from `verdict` |
| 1 | not acceptable: a failed check, a refused change, an unjudged task under `ci`, an untrusted or unnamed signer, inconsistent evidence |
| 2 | invalid request: a command line the binary cannot read, a missing or malformed document |
| 3 | cancelled by a signal |
| 4 | unavailable or incomplete: a missing prerequisite, an ambiguous scope, a watch-mode script, no manifest, an empty suite, a runtime that cannot be started |
| 5 | internal error |

`ci` exits 1 for a regression-only pass, because it is asked whether the change is verified
and an unjudged task is not; `check` and `pre-commit` exit 0 for the same measurement,
because they are asked whether the declared checks passed, and print the limited scope.

## Machine-readable formats

| Schema | Produced by | Notes |
| --- | --- | --- |
| `swarm.check.v1` | `check --json`, `pre-commit --json` (with `stagedTree`, `stagedCommit`, `borrowed` added), the MCP `swarm_verify_check` tool | fields: `schema`, `plan` (`swarm.check-plan.v1`), `tree`, `conclusions` (`command`, `checks[]`, `executionTrust`, `requirements`, `challenges`), `result`, `exitCode`, `bundleDirectory` |
| `swarm.ci.v1` | `ci --json`, the Action's `report.json` | the independent verification with `sourceIdentity`, `changedPaths`, `assessmentDigest`, `executionTrust`, `bundleDirectory`; `challenges` present when a policy other than `off` ran |
| `swarm-verify.verdict.v1` | the Action's `verdict.json` | canonical JSON, one trailing newline; the digest of the file bytes is the attestation subject; predicate type `https://github.com/moonrunnerkc/swarm-verify/verdict/v1` |
| bundle format 2, ledger schema 1 | every run | `manifest.json`, `ledger.jsonl`, `blobs/`, `verify.mjs`, `rederive.mjs`, `review.html`, `dag.json`, optional `attestation.dsse.json`; bundle format 1 stays readable |
| goal contract version 1 | `--goal-contract` | additive `challenges` block; a contract without it digests as before |
| `swarm.pytest.v1`, Vitest JSON | the structured runners | runner-reported; no ratchet or coverage authority |

Record rules on the chain that readers may depend on: `goal-contract`, `goal-check`,
`goal-verification`, `independent-verification`, `dependency-install`, `gate-run`,
`gate-bond`, `ratchet-decision`, and `verification-command` rules `challenge-plan-v1`,
`challenge-run-v1`, `challenge-verdict-v1`, `check-plan-v1`, `controlled-node-tap-v1`,
`upgrade-authorization-v1`, `upgrade-resolution-v1`. A new rule is an addition; a changed
meaning under an existing rule name is a break.

## Evidence and signatures

Every bundle carries its own dependency-free verifier that recomputes every hash, the
signature over the chain head and every recorded verdict, including the challenge verdicts,
with nothing installed. Bundle signatures are ed25519 over the chain head with the key in the
OS keychain or, where none can be held, a per-run key the manifest names `ephemeral` and the
verifier reports `untrusted`. Signer trust is a separate answer from integrity and is never
inferred from the bundle itself.

The Action signs the verdict document as a GitHub artifact attestation through the workflow's
OIDC identity (Sigstore, Fulcio and Rekor through `actions/attest`). A reader verifies it with
`gh attestation verify` against Sigstore's public trust root, naming the repository and the
workflow they expect; `swarm-verify verdict` runs that command and never reimplements it. Key
rotation is the platform's; there is no key to manage. A verdict is fresh for the head it
names and for nothing else: the comment marker, the document and the attestation all carry
that head, and a moved head gets a new run.

## The Action

`moonrunnerkc/swarm-verify@v1` moves only to validated stable versions; `v1.x.y` tags and
full commit SHAs are immutable. Inputs: `target`, `isolation`, `image`, `goal-contract`,
`oracle`, `packages`, `install`, `require-task`, `challenges`, `comment`, `attest`,
`github-token`, `workspace`, `head`, `base`, `source-url`, `allow-self-hosted`. Outputs:
`status`, `result`, `head`, `base`, `tree`, `report`, `summary`, `verdict`, `verdict-digest`,
`evidence`, `artifact`, `attestation`, `comment`, `comment-url`, `retention`. The final step
returns `status`; `attestation` and `comment` are separate outputs and a failed one is never
reported as delivered. Candidate code runs inside a network-disabled container under
`isolation: docker`; `install: true` gives the lockfile install, and only it, registry access
with lifecycle scripts off, recorded as such.

## Configuration precedence

Command-line flags win over `swarm.toml` in the workspace, which wins over defaults. `check`
and `ci` need no `swarm.toml` and never write one; `gates` reads gate overrides from it where
present. Environment: `NO_COLOR`, `SWARM_LOCAL_BASE_URL` (unused by the verifier, honoured
so a shared shell does not probe a model), and the runner's `GITHUB_*`, `RUNNER_*` and
`SWARM_INPUT_*` names for `action`.

## What is explicitly not stable

The human text output, the order and wording of lines, the reviewer Markdown summary, and
the set of mutation operators and their limits (recorded on every plan, so a bundle stands on
its own whatever changes later). Node 22.0 to 22.7 keep running but may lose the floor in a
future major once the platform drops them.
