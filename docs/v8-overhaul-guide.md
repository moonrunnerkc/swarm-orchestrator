# V8 Overhaul Guide

Branch: v8-dev
Date: 2026-05-05

---

## Section 5: Module Inventory

This section describes the v8 module structure and each module's purpose.

### Section 5.1: Contract Module (src/contract/)

The contract module defines the contract compilation model for v8. Contracts replace plans as the primary artifact produced during bootstrap; they are JSON Schema-validated compositions of obligations that agents must satisfy. Contracts are persisted as hash-referenced JSONL entries in the evidence ledger. The contract compiler validates input against `$schema` and `$id` fields per JSON Schema Draft 2020-12, then emits finalized contracts signed by the responsible persona.

Reference: This module implementation follows Section 2 of v8-implementation-guide.md (module inventory) and Section 4 (contract schema v1).

### Section 5.2: Population Module (src/population/)

The population module manages the tournament population of candidate agents. Each obligation in a contract generates a population of candidates that compete to satisfy it. Population management includes candidate creation, fitness scoring, diversity injection, and winner selection. The population manager interfaces with the ledger to query prior obligation satisfaction and with the persona registry to assign candidates.

Reference: This module implementation follows Section 2 of v8-implementation-guide.md (module inventory).

### Section 5.3: Ledger Module (src/ledger/)

The evidence ledger is the append-only hash-chain store for all v8 state transitions. Every obligation satisfaction, candidate selection, and tournament result is recorded as a ledger entry with a cryptographic hash referencing the prior entry. The ledger provides stigmergic coordination: agents observes entries added by other agents and makes decisions based on ledger state rather than explicit signal exchange.

Reference: This module implementation follows Section 2 of v8-implementation-guide.md (module inventory).

### Section 5.4: Verification Module (src/verification/)

The verification module provides post-generation and post-merge verification of contract obligations. Each obligation type (file-must-exist, build-must-pass, test-must-pass) has specific verification logic that checks whether the candidate agent's output satisfies the obligation. Verification results are recorded in the ledger and feed the composite scoring for tournament winner selection.

Reference: This module implementation follows Section 2 of v8-implementation-guide.md (module inventory). Note: v8 introduces v8-specific submodules under src/verification/; do not overwrite existing v6 quality-gates modules.

### Section 5.5: WASM Module (src/wasm/)

The WASM module provides deterministic execution wrappers for tools that must produce repeatable outputs regardless of environment. WASM runners execute build and test commands in a sandboxed WebAssembly environment to ensure that build artifacts and test results are reproducible across runs. The WASM module interfaces with the ledger to cache deterministic execution results.

Reference: This module implementation follows Section 2 of v8-implementation-guide.md (module inventory).

### Section 5.6: Persona Module (src/persona/)

The persona module manages persona definitions—system-prompt slices, sampling regimes, and model tiers that define agent behavior. Personas are registered in a persona registry and referenced by contract obligations. Each obligation type has a recommended persona (e.g., file-must-exist uses a file-verification persona, build-must-pass uses a build-engineer persona). Persona configuration is loaded at startup and persisted with ledger entries.

Reference: This module implementation follows Section 2 of v8-implementation-guide.md (module inventory).

### Section 5.7: Session Module (src/session/)

The session module manages shared inference sessions for v8 execution. Unlike v6's subprocess-based sessions, v8 uses API-level shared inference sessions that reduce overhead and improve cache hit rates. The session manager handles session lifecycle (creation, reuse, expiry) and interfaces with the ledger to persist session state across runs.

Reference: This module implementation follows Section 2 of v8-implementation-guide.md (module inventory).

### Section 5.8: CLI Module (src/cli/v8/)

The CLI module provides v8-specific command dispatch (compile, run, resume) for the swarm CLI. CLI handlers parse v8-specific flags (contract path, persona name, cost cap) and route to v8 execution paths. The CLI module interoperates with the v6 command set during migration.

Reference: This module implementation follows Section 2 of v8-implementation-guide.md (module inventory).

---

## Sections 1-4 (Existing Documentation)

Sections 1-4 of v8-overhaul-guide.md are covered in ARCHITECTURE.md and other existing documentation:

- Section 1: Overview and goals (see ARCHITECTURE.md)
- Section 2: Component architecture (see ARCHITECTURE.md)
- Section 3: Migration plan (see docs/v6-to-v7-migration.md patterns)
- Section 4: API contracts (see src/types.ts and related type files)

---

## Appendix: JSON Schema Reference

The contract schema is defined in src/contract/schema/v1.json using JSON Schema Draft 2020-12. The schema defines the envelope structure and three obligation types: file-must-exist, build-must-pass, test-must-pass. See v8-implementation-guide.md Section 4 for detailed obligation shapes.