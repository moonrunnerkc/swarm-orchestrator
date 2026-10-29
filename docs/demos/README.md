# Demos

Two scripts and the transcripts they printed when they were recorded. Run them from a checkout
of this repository; neither touches the OS keychain (each signs with a throwaway key).

- [tamper-demo.sh](tamper-demo.sh), transcript [tamper-demo.txt](tamper-demo.txt): `swarm init`
  and `swarm verify` on a scratch repository, then `verify.mjs` and, where it is installed,
  `cosign verify-blob-attestation` accept the attestation; one bit of it is flipped and both
  refuse it.
- [clean-container-demo.sh](clean-container-demo.sh), transcript
  [clean-container-demo.txt](clean-container-demo.txt): the attestation, its public key, the
  patch and `verify.mjs` are streamed into a `node:24` container with no network and no mount;
  it verifies there, and fails after one bit is flipped.
