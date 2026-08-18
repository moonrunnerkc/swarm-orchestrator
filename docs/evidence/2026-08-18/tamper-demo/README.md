# Tamper demonstration, 2026-08-18

The same bundle, verified and then tampered with, one byte apart.

The byte is the last digit of record 28's timestamp. Nothing about the run's result
changes: no gate outcome, no claim, no payload. That is deliberate. A reviewer
comparing only results would see nothing, and the chain still catches it.

Reproduce it from the committed bundle beside this file:

```sh
node flip-one-byte.mjs ../live-frontier /tmp/tampered
node /tmp/tampered/verify.mjs /tmp/tampered
```

`cmp -l` between the two ledgers reports exactly one differing byte, at offset 9799,
and both files are 14412 bytes.

## Verified: exit 0

```
verifying bundle at live-frontier

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
```

## Tampered: exit 1

```
verifying bundle at live-frontier-tampered

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
```

## What the difference says

One check moves, and it names the record and both hashes:

```
FAIL  hash chain intact: record 28 carries previousHash sha256:82a471cc7bca02de8c4020cbdb55bcb7d8dc9ad16c73ffede431f906c707eed2, but the record before it hashes to sha256:a0546cfd8cc4da7f60fdc9009494a94386bd9eca9471fa4105836cfc312f829b
```

The other checks still pass, and each one is worth reading as a limit rather than as
reassurance. The blobs still match their addresses, because no payload was touched.
The chain head still matches the manifest, because the tamper is mid-chain and the
head is computed from the last record. The signature still verifies, because it
covers that head. Only the link-by-link recomputation sees it, which is what makes
the chain load-bearing rather than the signature alone: a signature over a head
proves the head, and the chain is what ties every earlier record to it.

The exit codes are the part a script reads: 0 verified, 1 failed.
