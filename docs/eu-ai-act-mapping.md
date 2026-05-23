# EU AI Act mapping — swarm-audit AI-BOM

This page maps the fields a `swarm audit --emit-aibom cyclonedx-ml`
artifact carries to the technical-documentation surface the
**EU AI Act** mandates for high-risk and general-purpose AI systems.

The relevant binding dates:

| Date | Obligation |
|---|---|
| 2025-02-02 | Prohibitions and AI literacy (Title II + Art. 4) |
| 2025-08-02 | General-purpose AI model obligations (Title V) |
| **2026-08-02** | High-risk system obligations (Title III), including **Article 11** technical documentation and **Annex IV** |
| 2027-08-02 | High-risk systems embedded in products covered by Annex I |

The fields below are what a procurement reviewer reads against
Article 11 and Annex IV. The mapping is per-record: every
`swarm audit` run produces one CycloneDX-ML or SPDX-AI document, and
that single artifact answers each field below from the audit's
ledger evidence.

## Article 11 — Technical documentation

> *"Documentation shall be drawn up before that system is placed on the
> market and shall be kept up to date."*

| Article 11 requirement | swarm-audit field | Source |
|---|---|---|
| General description of the AI system | `components[0].description` (subject) and `components[*].description` (agent) | `pr-audit-started.prRepository`, `pr-audit-started.prHeadSha`, ledger agent attribution |
| Detailed description of the AI system's elements | `components` array | one entry per audited PR (`application`) and per AI agent (`machine-learning-model`) |
| Description of monitoring, functioning, and control | `vulnerabilities` array | one entry per cheat finding |
| Detailed description of the risk-management system | `vulnerabilities[*].ratings[*].severity` | `block` ↔ `high`, `warn` ↔ `medium`, `info` ↔ `info` |

## Annex IV — Technical documentation contents

| Annex IV section | swarm-audit field |
|---|---|
| 1(a) intended purpose | `components[0].description` |
| 1(c) date and version | `metadata.timestamp`, `metadata.tools[*].version`, `serialNumber` |
| 1(e) description of forms in which the AI system is placed on the market | implicit — one document per PR audit run |
| 2(b) design specifications including: a description of the general logic of the AI system and of the algorithms | `metadata.tools[*]` carries the detector engine version + per-detector versions |
| 2(c) description of the system architecture | `externalReferences[type=attestation]` — link + SHA-256 of the hash-chained evidence ledger reconstructs the per-finding chain |
| 2(d) data sheets describing the training methodologies, datasets, and provenance | `components[type=machine-learning-model].modelCard.properties` carries agent vendor + version + attribution signal |
| 3 description of monitoring, functioning, control | `vulnerabilities[*]` carries every cheat finding with file/line/severity |
| 4 description of risk-management system | severity ladder maps to procurement-standard rating |
| 5 description of post-market monitoring system | weekly leaderboard refresh + append-only ledger |

## Practical workflow for procurement

1. Pin the GitHub Action at `moonrunnerkc/swarm-orchestrator@v10` with
   `audit-mode: true` and `emit-aibom: cyclonedx-ml`.
2. Configure CI to upload `.swarm/aibom/*.cdx.json` as a release artifact
   on every release tag.
3. The CycloneDX-ML document plus the `.swarm/ledger/audit-*.jsonl` it
   references together constitute the Article 11 documentation packet
   for any model-generated change merged into the release.
4. Verify integrity by recomputing the ledger's hash chain (the entry
   chain is anchored by `externalReferences[*].hashes[alg=SHA-256]`).

## Limitations and out-of-scope

- swarm-audit grades the *patch*, not the model that produced it. Article 11
  requirements that mandate model-internal documentation (training data,
  pretraining corpus, alignment process) must be sourced from the AI
  provider directly.
- The cheat-detector engine catches the cheat *categories* it ships with.
  Categories Phase 1 + Phase 2 cover are the 10 documented in the README;
  future Phase additions will be visible via `metadata.tools[*].version`.

See also: [docs/cisa-sbom-ai-mapping.md](cisa-sbom-ai-mapping.md) for the
CISA AI SBOM minimum-elements view of the same artifact.
