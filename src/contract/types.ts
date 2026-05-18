// Re-export all obligation types from the shared-types module.
// This file keeps backward compatibility for any existing imports
// from '../contract/types' while breaking the circular dependency
// between contract ↔ verification and contract ↔ wasm.
// The canonical definitions now live in src/shared-types/obligation-types.ts.

export * from '../shared-types/obligation-types';