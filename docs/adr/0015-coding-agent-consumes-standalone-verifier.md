# 0015. Swarm Orchestrator is the coding agent; Swarm Verify is the standalone verifier it consumes

**Status:** approved 2026-10-31, supersedes [0014](0014-verifier-first-rebuild.md)

## Context

ADR 0014 cut the repository to a small verifier and a plain agent loop and shipped both from
one tree, with the root README headed `swarm-verify` and `swarm run` described as a loop the
verifier judges. The cut was worth keeping: two runtime dependencies, a short execution path,
standard attestations, a verifier with no model dependency.

The review in [docs/plans/2026-10-31-product-recovery.md](../plans/2026-10-31-product-recovery.md)
reproduced what that shape costs. The verifier lives in this repository's `src/verify`, while
the repository named `swarm-verify` is only a generated Action distribution; the agent imports
verifier modules by relative source path, so the dependency between the products is not
visible in any installed package graph. Acceptance has no notion of the requested
requirements: a run whose model declares completion with an empty diff ends `verified`, while
a correct fix that adds a regression test is refused because a test changed beside source.
Several rules in this repository's own instructions (the protected-path refusal, no instruction
loading to meet a loop line target, test lines capped at source lines) forbid behavior the
product needs.

## Decision

1. **Swarm Orchestrator is the coding agent.** It owns task interpretation, repository
   instructions, model selection, the edit loop, repair, the managed workspace, session data
   and the final requirement report. Its package is `swarm-orchestrator` and its command is
   `swarm`.
2. **Swarm Verify is the standalone verifier.** The `moonrunnerkc/swarm-verify` repository
   holds its source, tests, build, releases and GitHub Action. It owns the versioned request
   and result schema, test-result normalization, per-test regression comparison, acceptance
   authority, isolated execution, dependency provenance, attestations and offline evidence
   validation. It imports no model client and never installs or requires the agent.
3. **The orchestrator consumes the verifier as an exact-version runtime dependency** through
   the verifier's public, versioned API. Cross-repository tests install a packed verifier
   tarball and run the installed agent against it. No relative source import crosses the
   boundary, and no copy of the verifier stays in this repository once the packed consumer
   test passes.
4. **Verification outcome interpretation lives in one place: Swarm Verify.** The verifier
   derives each requirement's status (`satisfied`, `failed`, `unverified`, `blocked`) and the
   overall state (`complete`, `incomplete`, `blocked`) from captured results and declared
   policy. The agent reads the result to decide whether to repair or stop and renders it; it
   does not reimplement the acceptance predicate. A model may propose requirements, mappings
   and checks; only verifier and report code set a status.
5. **Candidate artifacts are not acceptance authority.** Source, tests, manifests, lockfiles,
   configuration, migrations and documentation may change together. Trusted acceptance
   commands, sealed checks, baseline snapshots, policy and signing material stay outside the
   candidate's writable environment, and the original regression obligations run from the
   base commit's tests against the candidate's source.

## Consequences

- The README, instruction files and package metadata describe one coding agent consuming one
  standalone verifier. The verifier's own README lives in its repository.
- `swarm verify` and `swarm ci` remain available to people who use the agent; they call the
  installed verifier. Verifying another agent's patch is the verifier's own use case, through
  the `swarm-verify` command and Action.
- The protected-path refusal, the 500-line loop target and the test-to-source line ratio are
  retired. The size caps that remain are lines per file, non-test lines under `src/`, runtime
  dependencies, subcommands and workflows.
- `docs/results.md` and its store stay as history from before this decision; the scheduled
  three-arm evaluation becomes a manual workflow until the everyday workflow is proven.
- Changed verifier commands, exit codes, evidence format and Action inputs ship as a new major
  with a migration note in the verifier repository. Existing release tags are never moved.
