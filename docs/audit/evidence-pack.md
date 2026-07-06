# Evidence packs

An evidence pack is a self-contained directory that records what an audit
proved about a pull request, in a form a third party can archive and
re-verify offline. It is produced by `swarm audit --pr <ref>
--evidence-pack <dir>` and holds two kinds of artifact: replay-identical
attestations (a pure function of the PR inputs and the audit's
conclusions) and a per-run record (the hash-chained ledger, which carries
real timestamps).

## Layout

```
<dir>/
  attestation/cyclonedx.json   CycloneDX 1.6 ML-BOM
  attestation/spdx.json        SPDX 3.0 AI-Profile
  evidence/<sha256><ext>       raw execution-grounded bytes, content-addressed
  MANIFEST.json                sha256 + byte length over every file above
  ledger.jsonl                 the run's hash-chained audit ledger
  run-record.json              the ledger's sha256 and runId
```

Everything except `ledger.jsonl` and `run-record.json` is
replay-identical: run the audit twice against the same PR head and the
attestation files, the content-addressed evidence, and `MANIFEST.json`
are byte-for-byte identical. The two runs' ledgers differ (each has a
random runId and wall-clock timestamps), which is why the ledger is not in
the MANIFEST and is instead pinned by sha256 in `run-record.json`. The
ledger's own integrity is its hash chain (`verifyChain`), not replay.

## What makes the attestations replay-identical

The AIBOM documents normally stamp a random `serialNumber`
(`crypto.randomUUID`) and a wall-clock timestamp. In an evidence pack they
instead take a pinned identity derived purely from the run inputs
(`src/audit/aibom/bom-identity.ts`):

- `serialNumber` is an RFC-4122 version-5 UUID over the repository, PR
  number, head SHA, base SHA, detector versions, and tool version. Same
  inputs, same UUID.
- Every internal id (CycloneDX `bom-ref`, SPDX `@id`) keys off that stable
  UUID rather than the random runId.
- The timestamp is not fabricated. It honors `SOURCE_DATE_EPOCH` (the
  reproducible-builds standard); when that variable is unset the timestamp
  is the Unix epoch and a `swarm.timestamp.basis` property records why, so
  the field is never read as a real generation time. Set
  `SOURCE_DATE_EPOCH` to pin a real build time into the pack.

The raw execution-grounded evidence (Stryker mutation JSON, coverage JSON,
issue-repro output) is copied under a content-addressed name
(`evidence/<sha256><ext>`), so identical bytes deduplicate and the file
name is itself the integrity anchor.

## The MANIFEST and verification

`MANIFEST.json` lists every replay-identical file with its sha256 and byte
length, plus:

- `subject`: the audited repository, PR number, and head/base SHA.
- `identity`: the pinned serialNumber, timestamp, and timestamp basis.
- `verdict`: `negativeGateClean` from the cheat gate, and, when the
  positive merge-safety gate ran, the two-sided `merge` verdict
  (`auto-merge` or `human`) with its reason codes. This comes from the
  `pr-audit-work-verified` ledger entry, which records every positive-gate
  control (build, test, obligation, falsifier) with its
  pass/fail/unavailable status. A control that could not run is recorded
  as `unavailable`, never as a pass.

`verifyManifest(<dir>)` recomputes the sha256 of every listed file and
reports any file that is missing or altered, so a reviewer can confirm the
pack was not edited after the audit produced it.

## Out of scope

Cryptographic signing of the pack (DSSE envelopes, in-toto attestations,
sigstore/cosign transparency-log entries) is a bounded follow-on, not part
of this layer. The pack is integrity-pinned (every byte is hashed in the
MANIFEST and the ledger self-verifies via its hash chain) but not signed:
nothing here binds the pack to a signing key or a transparency log. Adding
a DSSE wrapper over `MANIFEST.json` is the natural next step and does not
require changing the pack contents.
