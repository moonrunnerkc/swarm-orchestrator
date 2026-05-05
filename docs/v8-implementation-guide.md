# V8 Implementation Guide

Branch: v8-dev
Date: 2026-05-05
Reference: v8-overhaul-guide.md Section 5 (module inventory)

---

## Section 3: Module Skeleton Directories

Phase 0 implements the v8 module skeleton. Each directory contains an index.ts with a top-level JSDoc block describing the module's purpose (citing v8-overhaul-guide.md Section 5.x) and one named export of an empty const to satisfy the "named exports only, no default exports" rule.

### Directory Structure

```
src/
├── contract/           # Contract compilation and validation (Section 5.1)
├── population/         # Tournament population management (Section 5.2)
├── ledger/             # Evidence ledger implementation (Section 5.3)
├── verification/       # Obligation verification (Section 5.4)
│   ├── v8/             # V8-specific verification submodules
├── wasm/               # WASM sandbox wrappers (Section 5.5)
├── persona/            # Persona registry (Section 5.6)
├── session/            # Shared inference sessions (Section 5.7)
└── cli/
    └── v8/             # V8 CLI handlers (Section 5.8)
```

### Verification Module Note

The src/verification/ directory already exists from v6. Per the reuse audit, do not overwrite existing modules. Instead, create v8-specific submodules under src/verification/v8/. The existing verification modules remain for CLI fallback mode; v8 submodules provide enhanced verification for the shared-inference path.

### index.ts Requirements

Each index.ts must:
1. Contain a top-level JSDoc block citing v8-overhaul-guide.md Section 5.x
2. Export exactly one named export: an empty const
3. Be valid TypeScript modules under strict no-any settings
4. Have no implementation content beyond the export

Example index.ts:
```typescript
/**
 * Module purpose paragraph describing role in v8 architecture.
 * Reference: v8-overhaul-guide.md Section 5.x (module name)
 *
 * @packageDocumentation
 */

/**
 * Placeholder export to satisfy named exports only rule.
 * @internal
 */
export const placeholder = {};
```

---

## Section 4: Contract Schema V1

The contract schema uses JSON Schema Draft 2020-12 with `$schema` and `$id` fields.

### Section 4.1: Contract Envelope

The contract envelope is the top-level object containing:
- `$schema`: JSON Schema URI (draft 2020-12)
- `$id`: Unique identifier for this contract definition
- `version`: Schema version string (e.g., "1.0.0")
- `obligations`: Array of obligation objects

### Section 4.2: Obligation Types

Three obligation types are defined:

#### file-must-exist

Verifies that a specific file path exists after generation.

Shape:
- `type`: "file-must-exist"
- `path`: string (relative file path)
- `description`: string (optional description)

Example:
```json
{
  "type": "file-must-exist",
  "path": "src/index.ts",
  "description": "Main entry point file must be created"
}
```

#### build-must-pass

Verifies that the build command completes successfully.

Shape:
- `type`: "build-must-pass"
- `command`: string (build command)
- `description`: string (optional description)

Example:
```json
{
  "type": "build-must-pass",
  "command": "npm run build",
  "description": "Project must build without errors"
}
```

#### test-must-pass

Verifies that tests execute and pass.

Shape:
- `type`: "test-must-pass"
- `command`: string (test command)
- `description`: string (optional description)

Example:
```json
{
  "type": "test-must-pass",
  "command": "npm test",
  "description": "All tests must pass"
}
```

### Section 4.3: Validation

The schema must validate cleanly with AJV 8.x. Tests are provided in src/contract/__tests__/schema-v1.test.ts to verify:
- Positive validation of each obligation type
- Negative validation (unknown obligation type)
- Envelope-level required fields

### Section 4.4: Schema Location

The contract schema is defined at src/contract/schema/v1.json and referenced via `$schema` and `$id` fields in all contract documents.