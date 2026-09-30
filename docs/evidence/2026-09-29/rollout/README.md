# Rollout of the swarm-verify Action to sixteen repositories

Two rounds on 2026-09-29, each re-pinning every open rollout pull request to the release by
commit SHA, keeping each workflow's `with:` block, merging only a clean result (a regression-only
pass with no inherited failure and a signed attestation) after a labelled red-control pull request
on a disposable branch read "Not verified, Regression: fail", and merging through each
repository's ordinary route with no bypass.

- **1.1.0** (`5abe0fd26`): seven clean, red controls refused, merged: crossfire, claimcheck,
  pubprep, dumpscan, counterfactual-court, cronproof (after pinning the project's own Node
  22.16.0 image, since its CLI refuses a timezone-database mismatch), ruleprobe (after a fix
  that runs its CLI tests from source rather than the git-ignored build). Nine left open with
  causes named, most of them verifier limits that 1.2.0 fixes.
- **1.2.0** (`2c4b6944a`): three more clean and merged: quantproof, nborder, ironroot (after the
  project scoped mypy in `mypy.ini`). Details, run ids and attestations in
  [results-1.2.0.md](results-1.2.0.md). depose and tracemantle surfaced verifier defects (a base
  control that saw the head's ignored build output, and temporary paths in compared failure
  causes), which are being fixed in the verifier, not worked around in the projects.
  rlfusion-orchestrator needs an owner packaging decision; gemma-witness (Rust) and nondet (Java)
  are unsupported toolchains; swarm-orchestrator-rules has no manifest and requires a second
  account's review.
