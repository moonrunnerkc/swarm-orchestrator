# CISA AI SBOM mapping — swarm-audit

This page maps the **CISA SBOM-for-AI minimum elements** (published early
2026, building on the 2021 NTIA SBOM minimum elements) to the
`swarm audit --emit-aibom` artifacts.

Both CycloneDX-ML 1.6 and SPDX 3.0 AI-Profile carry the same evidence;
the mapping below uses CycloneDX field names. The SPDX equivalents are
inline.

## Minimum Elements

| CISA element | CycloneDX-ML field | SPDX 3.0 AI-Profile field |
|---|---|---|
| **Supplier name** | `metadata.tools[*].vendor` | `CreationInfo.createdBy[*].name` (vendor) |
| **Component name** | `components[*].name` | `SoftwareApplication.name` / `AIPackage.name` |
| **Version of the component** | `components[*].version` | `SoftwareApplication.packageVersion` / `AIPackage.packageVersion` |
| **Other unique identifiers** | `serialNumber` (top-level), `bom-ref` (per component) | `@id` (per element) |
| **Dependency relationships** | `vulnerabilities[*].affects[*].ref` (cheat finding → audited patch) | `Relationship.relationshipType=audited` (agent → patch) |
| **Author of SBOM data** | `metadata.tools[*]` | `CreationInfo.createdBy[*]` |
| **Timestamp** | `metadata.timestamp` | `CreationInfo.created` |

## CISA AI-specific additions

| Element | Where it lives |
|---|---|
| Model identifier | `components[type=machine-learning-model].name` + `.version` |
| Training data identifier or fingerprint | not emitted by swarm-audit (the audit grades the patch, not the model — sourced separately from the AI provider) |
| Inference parameters | not applicable to a patch audit |
| Provenance of model invocation | `components[type=machine-learning-model].modelCard.properties[name=attribution.source]` carries the signal that identified the agent (`bot-author`, `pr-body-marker`, `commit-marker`, `branch-name`) |
| Hash of the audit evidence | `externalReferences[type=attestation].hashes[alg=SHA-256]` — SHA-256 over the hash-chained JSONL ledger that drove the document |

## Verification workflow

1. Verify the document is well-formed: validate against the upstream
   CycloneDX 1.6 schema (`bomFormat: CycloneDX`, `specVersion: 1.6`).
   `ajv` already ships as a runtime dep; the project's CI fixture set
   exercises this.
2. Recompute the SHA-256 over the referenced ledger file; compare to
   `externalReferences[type=attestation].hashes[content]`.
3. Walk the ledger's hash chain — every entry's `entryHash` is the SHA-256
   of the canonical JSON of the entry minus `entryHash`, with `prevHash`
   matching the prior entry's `entryHash`. Genesis `prevHash` is the
   all-zero digest. `swarm stats` and the `verifyChainEntries` helper
   both perform this verification.
4. The chain anchors the cheat findings — any in-flight tampering with
   the audit record breaks the chain.

## Limitations and gaps

- The audit subject is the **patch**, not the model. CISA elements that
  pertain to model-internal information (training datasets, weights,
  inference parameters) require an upstream AI-BOM emitted by the model
  provider. swarm-audit's BOM composes with such upstream BOMs via the
  dependency-graph relation.
- Synthetic-corpus runs (e.g. the public leaderboard refresh) emit
  artifacts where the `agent` attribution is synthetic and round-robin;
  these documents are useful for benchmark provenance but should not
  be cited as model-supplier provenance.

See also: [docs/eu-ai-act-mapping.md](eu-ai-act-mapping.md) for the
EU AI Act Article 11 + Annex IV view of the same artifact.
