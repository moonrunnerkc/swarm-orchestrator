// Re-export from the shared-predicates module.
// This file keeps backward compatibility for any existing imports
// from '../verification/predicate-runner' or './predicate-runner'.
// The canonical implementation now lives in src/shared-predicates/predicate-runner.ts
// to break the circular dependency between contract and verification.

export * from '../shared-predicates/predicate-runner';