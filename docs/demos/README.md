# Demos

Five scripts and the transcripts they printed when they were recorded. Run them from a checkout
of this repository after `npm ci`; none touches the OS keychain (each signs with a throwaway
key). Each script exits 0 when every step it shows behaved as its transcript records.

- [tamper-demo.sh](tamper-demo.sh), transcript [tamper-demo.txt](tamper-demo.txt): `swarm init`
  and `swarm verify` on a scratch repository, then `verify.mjs` and, where it is installed,
  `cosign verify-blob-attestation` accept the attestation; one bit of it is flipped and both
  refuse it.
- [clean-container-demo.sh](clean-container-demo.sh), transcript
  [clean-container-demo.txt](clean-container-demo.txt): the attestation, its public key, the
  patch and `verify.mjs` are streamed into a `node:24` container with no network and no mount;
  it verifies there, and fails after one bit is flipped.
- [action-demo.sh](action-demo.sh), transcript [action-demo.txt](action-demo.txt): the steps of
  `packages/swarm-verify/action.yml` run by hand on a pull request's branch, with the package
  packed from this checkout as the version input; the Sigstore bundle lands under the
  workspace's `.swarm/verify/` and `verify.mjs` accepts it.
- [mcp-demo.sh](mcp-demo.sh), transcript [mcp-demo.txt](mcp-demo.txt): `mcp.mjs` over stdio
  answers initialize, lists one tool (verify) and returns the predicate for a change.
- [pre-commit-demo.sh](pre-commit-demo.sh), transcript [pre-commit-demo.txt](pre-commit-demo.txt):
  the pre-commit entry from docs/integrations.md as a git hook blocks a commit that edits a test
  together with source and lets an honest fix through.
