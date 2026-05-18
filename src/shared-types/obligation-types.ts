// TypeScript-side mirror of `schema/v1.json`. Kept in lockstep — schema
// changes mean a v2.json, new union member, and new schema-version
// string. Phase 7 added five obligation types additively; v1 still
// accepts every Phase 0–6 obligation document.
//
// These types are shared across contract, verification, and wasm
// modules. Moving them here breaks the circular dependency that
// arose when verification and wasm both imported from contract.

export const CONTRACT_SCHEMA_VERSION = 'v1';

export interface FileMustExistObligation {
  type: 'file-must-exist';
  path: string;
  deterministicStrategy?: string;
}

export interface BuildMustPassObligation {
  type: 'build-must-pass';
  command: string;
  deterministicStrategy?: string;
}

export interface TestMustPassObligation {
  type: 'test-must-pass';
  command: string;
  deterministicStrategy?: string;
}

// Verifier runs a whitespace-collapsed literal-string match for
// `name(<signature>)`, so arrow-function and method declarations both
// match without parsing the full AST.
export interface FunctionMustHaveSignatureObligation {
  type: 'function-must-have-signature';
  file: string;
  name: string;
  signature: string;
  deterministicStrategy?: string;
}

// Distinct from `build-must-pass`: property check (hold/violation
// classifier), not a build step. `target` is rendered into prompts and
// ledger detail but the verifier itself ignores it.
export interface PropertyMustHoldObligation {
  type: 'property-must-hold';
  predicate: string;
  target: string;
  deterministicStrategy?: string;
}

// Constraint identifiers extend additively in future Phase-7 PRs.
// Verifier walks `.ts/.tsx/.js/.mjs/.cjs/.py` files under `scope`.
export interface ImportGraphMustSatisfyObligation {
  type: 'import-graph-must-satisfy';
  constraint: 'no-cycles' | 'no-upward-imports';
  scope: string;
  deterministicStrategy?: string;
}

// `scope` points at a JSON document shaped like Istanbul/c8's
// coverage-summary.json: top-level total[metric] with a numeric `pct`.
export interface CoverageMustExceedObligation {
  type: 'coverage-must-exceed';
  scope: string;
  metric: 'lines' | 'statements' | 'branches' | 'functions';
  threshold: number;
  deterministicStrategy?: string;
}

// Smaller numbers are better (wall-time/latency convention); verifier
// flags a regression when current > baseline * (1 + threshold).
// Baseline file shape: { "value": <number> }.
export interface PerformanceMustNotRegressObligation {
  type: 'performance-must-not-regress';
  benchmark: string;
  baseline: string;
  threshold: number;
  deterministicStrategy?: string;
}

export type ObligationV1 =
  | FileMustExistObligation
  | BuildMustPassObligation
  | TestMustPassObligation
  | FunctionMustHaveSignatureObligation
  | PropertyMustHoldObligation
  | ImportGraphMustSatisfyObligation
  | CoverageMustExceedObligation
  | PerformanceMustNotRegressObligation;

export type ObligationType = ObligationV1['type'];

// Stable canonical ordering: Phase 0–6 types keep their original
// positions so contract hashes from earlier phases stay stable; Phase 7
// additions append to the end.
export const OBLIGATION_TYPES: readonly ObligationType[] = [
  'file-must-exist',
  'build-must-pass',
  'test-must-pass',
  'function-must-have-signature',
  'property-must-hold',
  'import-graph-must-satisfy',
  'coverage-must-exceed',
  'performance-must-not-regress',
] as const;

export interface RepoContext {
  repoRoot: string;
  buildCommand: string | null;
  testCommand: string | null;
  language: 'typescript' | 'javascript' | 'python' | 'unknown';
  // Optional for back-compat with manifests written before this field
  // existed; new manifests always set it (possibly to null).
  testFramework?: 'jest' | 'mocha' | 'vitest' | 'node-test' | 'pytest' | null;
}

// Contract hash is computed only over canonical obligation bytes, not
// over provenance.
export interface ExtractorProvenance {
  name: string;
  model: string | null;
  temperature: number | null;
  promptSha256: string | null;
}

// Predicates that already hold against the unmodified workspace —
// trivial tautologies the compiler drops from the obligation list and
// surfaces here for caller audit. Never part of the contract hash.
export interface TautologyWarning {
  obligation: ObligationV1;
  reason: string;
}

export interface DraftContract {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  goal: string;
  repoContext: RepoContext;
  obligations: ObligationV1[];
  extractor: ExtractorProvenance;
  tautologyWarnings?: readonly TautologyWarning[];
}

// Manifest captures everything that isn't the obligation list, so the
// on-disk .jsonl is exactly the schema-validated obligations the
// verifier consumes.
export interface ContractManifest {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  contractHash: string;
  contractId: string;
  goal: string;
  repoContext: RepoContext;
  extractor: ExtractorProvenance;
  createdAt: string;
}

export interface FinalContract {
  manifest: ContractManifest;
  obligations: ObligationV1[];
}