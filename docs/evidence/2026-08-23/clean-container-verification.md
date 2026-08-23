# Clean-container verification, 2026-08-23

The claim this closes: a bundle verifies on a machine that has never seen this repository.
The 08-18 run recorded it NOT-RUN for want of a container runtime, and
`../2026-08-18/clean-container-verification.md` says so and points here.

Two arms, because a verifier that only ever says yes has demonstrated nothing: the committed
bundle, and the same bundle with one byte changed by the committed `flip-one-byte.mjs`.

## What the container is

| | |
| --- | --- |
| Runtime | colima 0.10.3 on lima 2.2.0, installed for this run; the host had none at preflight |
| Engine | Docker Engine 29.5.2 (server), 29.7.2 (client), on Ubuntu 24.04.4 LTS aarch64 |
| Image | `node:24`, digest `sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584` |
| Node in the image | v24.19.0 |
| Network | `--network none`. Checked from inside rather than assumed: `fetch("https://registry.npmjs.org/")` answers `EAI_AGAIN` |
| What was carried in | one directory, by `docker cp`. No bind mount of this repository, no npm install, nothing else |

The bundle is `../2026-08-18/live-frontier/`, committed, 42 records.

| | |
| --- | --- |
| `manifest.json` sha256 | `05e206b04af0d41a099cf8825b74b93219f510d2613e7a10ff721d428c9a1aa9` |
| session | `20260818T145619-d5dd08` |
| chain head | `sha256:6dafa1f811723f7c2b4dcff7bab7cdb6151fc2154dc0afebb5faf11824a14041` |
| signature | ed25519, `keySource: keychain` |

`docker cp` rather than a bind mount is deliberate twice over. It makes "only a committed
bundle directory was copied in" literal rather than a claim about mount flags, and colima
mounts only part of the host filesystem into its VM, so a bind mount of a path outside that
set arrives as an empty directory. The first attempt did exactly that, and the verifier
reported `Cannot find module '/bundle/verify.mjs'` against an empty mount. An empty directory
failing to verify would have proved nothing, which is why it is written down here rather than
quietly retried.

## Arm 1: the bundle as committed

```
$ docker run -d --name swarm-cc-clean --network none \
    node@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584 sleep 300
c048257569b72f4609b676440e477b135a7a6607e10df63977ef865124cf8f13
$ docker cp <clean bundle> swarm-cc-clean:/bundle
$ docker exec swarm-cc-clean node --version
v24.19.0
$ docker exec swarm-cc-clean ls /bundle
blobs
dag.json
ledger.jsonl
manifest.json
review.html
verify.mjs
$ docker exec swarm-cc-clean node /bundle/verify.mjs /bundle
verifying bundle at /bundle

  VERIFIED   record 28: facts.exitCode == 0

  PASS  manifest reads: bundle format 1, session 20260818T145619-d5dd08
  PASS  ledger parses: 42 of 42 lines
  PASS  record count matches the manifest: 42 records, manifest says 42
  PASS  hash chain intact: 42 links
  PASS  chain head matches the manifest: computed sha256:6dafa1f811723f7c2b4dcff7bab7cdb6151fc2154dc0afebb5faf11824a14041
  PASS  signature over the chain head verifies: ed25519, keychain key
  PASS  blobs match their content addresses: 42 blobs
  PASS  every record's payload is present: all payloads resolve
  PASS  claim verdicts recomputed: 1 verified, 0 unverified; manifest says 1 verified

bundle verified: every check passed
exit status: 0
```

## Arm 2: the same bundle, one byte changed

`flip-one-byte.mjs` changed record 28's timestamp, one digit, 9 to 8. Nothing else in the
directory differs: `diff -rq` reports only `ledger.jsonl`.

```
$ docker run -d --name swarm-cc-tampered --network none \
    node@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584 sleep 300
f480a42e4db9c4544e564ed344cdd3191244d0260c618e20116f17a22805c272
$ docker cp <tampered bundle> swarm-cc-tampered:/bundle
$ docker exec swarm-cc-tampered node --version
v24.19.0
$ docker exec swarm-cc-tampered ls /bundle
blobs
dag.json
ledger.jsonl
manifest.json
review.html
verify.mjs
$ docker exec swarm-cc-tampered node /bundle/verify.mjs /bundle
verifying bundle at /bundle

  VERIFIED   record 28: facts.exitCode == 0

  PASS  manifest reads: bundle format 1, session 20260818T145619-d5dd08
  PASS  ledger parses: 42 of 42 lines
  PASS  record count matches the manifest: 42 records, manifest says 42
  FAIL  hash chain intact: record 28 carries previousHash sha256:82a471cc7bca02de8c4020cbdb55bcb7d8dc9ad16c73ffede431f906c707eed2, but the record before it hashes to sha256:a0546cfd8cc4da7f60fdc9009494a94386bd9eca9471fa4105836cfc312f829b
  PASS  chain head matches the manifest: computed sha256:6dafa1f811723f7c2b4dcff7bab7cdb6151fc2154dc0afebb5faf11824a14041
  PASS  signature over the chain head verifies: ed25519, keychain key
  PASS  blobs match their content addresses: 42 blobs
  PASS  every record's payload is present: all payloads resolve
  PASS  claim verdicts recomputed: 1 verified, 0 unverified; manifest says 1 verified

bundle FAILED: 1 check(s) did not pass
exit status: 1
```

## What this shows and what it does not

The verifier needs the bundle and a Node runtime and nothing else: no install, no network, no
copy of this repository, no cached module. It says yes to the bundle as committed and no to
the same bundle one byte later, from the same image in the same session.

Two things it does not show. The signature check confirms the bundle was not altered after it
left the machine that produced it; it does not make that machine honest, and the review page
says so on its face. And the chain-head check still passes on the tampered copy, which is the
expected reading rather than a gap: the flip is inside the chain, so the link check catches it
at record 28 while the head, being the hash of the last record, is unchanged. One failed check
is what fails the bundle.
