/**
 * Type definitions for v8 contract obligations and the runtime objects the
 * compiler, validator, and serializer pass between each other.
 *
 * On-disk shape is defined by `schema/v1.json`; this file is the
 * TypeScript-side mirror. Schema and types are kept in lockstep — schema
 * changes mean a `v2.json`, a new union member, and a new schema-version
 * string. See `docs/v8-implementation-guide.md` §4 and §13.
 *
 * Phase 7 (impl guide §10) extends the v1 obligation union with five new
 * types: `function-must-have-signature`, `property-must-hold`,
 * `import-graph-must-satisfy`, `coverage-must-exceed`, and
 * `performance-must-not-regress`. The schema bump stays at v1 because the
 * additions are purely additive — every Phase 0–6 obligation document is
 * still valid input.
 */

/** Schema version of the contract obligation format on disk. */
export const CONTRACT_SCHEMA_VERSION = 'v1';

/** Obligation: a file that must exist after execution. */
export interface FileMustExistObligation {
  type: 'file-must-exist';
  /** Path relative to repository root. */
  path: string;
  /**
   * Phase 5: optional deterministic-strategy tag. Names a strategy
   * registered with the WASM runtime; when set, the population manager
   * dispatches this obligation to the runtime instead of the synthesis
   * tournament. See impl guide §8 and overhaul guide §5.6.
   */
  deterministicStrategy?: string;
}

/** Obligation: a build command that must exit zero. */
export interface BuildMustPassObligation {
  type: 'build-must-pass';
  /** Shell command, run from repository root. */
  command: string;
  /** Phase 5: optional deterministic-strategy tag. */
  deterministicStrategy?: string;
}

/** Obligation: a test command that must exit zero. */
export interface TestMustPassObligation {
  type: 'test-must-pass';
  /** Shell command, run from repository root. */
  command: string;
  /** Phase 5: optional deterministic-strategy tag. */
  deterministicStrategy?: string;
}

/**
 * Phase 7 obligation: a named function in `file` must declare a signature
 * containing the `signature` substring. The verifier runs a literal-string
 * match for `name(<signature>)` (after collapsing whitespace) so it
 * accepts both arrow-function and method declarations without parsing the
 * full AST. The persona is expected to emit a unified diff that brings
 * the file into the expected shape.
 */
export interface FunctionMustHaveSignatureObligation {
  type: 'function-must-have-signature';
  /** Path relative to repository root, must be a regular file. */
  file: string;
  /** Function/method name as it appears in source. */
  name: string;
  /**
   * Signature substring including parens. Whitespace is collapsed before
   * comparison so `(req, res)` matches `( req, res )`. Example:
   * `(req: Request, res: Response): Promise<void>`.
   */
  signature: string;
  /** Phase 5: optional deterministic-strategy tag. */
  deterministicStrategy?: string;
}

/**
 * Phase 7 obligation: an external `predicate` shell command must exit zero
 * when run against the workspace. Distinct from `build-must-pass` because
 * the obligation is a property check (a hold/violation classifier), not a
 * build step; the contract surfaces the property's `target` for prompts
 * and ledger entries.
 */
export interface PropertyMustHoldObligation {
  type: 'property-must-hold';
  /** Shell command, run from repo root. Exit zero ⇒ property holds. */
  predicate: string;
  /**
   * Human-readable target the property is asserted to hold over. Used in
   * persona prompts and ledger detail strings; the verifier itself does
   * not act on this field.
   */
  target: string;
  /** Phase 5: optional deterministic-strategy tag. */
  deterministicStrategy?: string;
}

/**
 * Phase 7 obligation: the import graph rooted at `scope` must satisfy
 * the named structural `constraint`. Two constraints ship initially:
 *   - `no-cycles`: no directed cycle exists in the import graph.
 *   - `no-upward-imports`: no relative import escapes its file via
 *     `../`.
 *
 * Scope is a relative directory; the verifier walks `.ts/.tsx/.js/.mjs/
 * .cjs/.py` files under it.
 */
export interface ImportGraphMustSatisfyObligation {
  type: 'import-graph-must-satisfy';
  /** Constraint identifier. New constraints land via additive Phase-7 PRs. */
  constraint: 'no-cycles' | 'no-upward-imports';
  /** Relative directory to walk. */
  scope: string;
  /** Phase 5: optional deterministic-strategy tag. */
  deterministicStrategy?: string;
}

/**
 * Phase 7 obligation: a coverage report's metric must exceed `threshold`.
 * The report is read from `scope` (a relative path to a JSON document
 * shaped like Istanbul/c8's `coverage-summary.json`: a top-level
 * `total[metric]` with a numeric `pct` field).
 */
export interface CoverageMustExceedObligation {
  type: 'coverage-must-exceed';
  /** Path to the coverage-summary.json file, relative to repo root. */
  scope: string;
  /** Coverage metric to assert against. */
  metric: 'lines' | 'statements' | 'branches' | 'functions';
  /** Threshold percentage in [0, 100]. Coverage must be `>= threshold`. */
  threshold: number;
  /** Phase 5: optional deterministic-strategy tag. */
  deterministicStrategy?: string;
}

/**
 * Phase 7 obligation: the `benchmark` command's numeric output must not
 * regress past `threshold` (a fractional cap, e.g. 0.10 for 10%) versus
 * the value stored in the `baseline` JSON file. The baseline file shape
 * is `{ "value": <number> }`. Smaller numbers are considered better
 * (typical wall-time / latency convention); the verifier flags a
 * regression when `current > baseline * (1 + threshold)`.
 */
export interface PerformanceMustNotRegressObligation {
  type: 'performance-must-not-regress';
  /** Shell command whose stdout's last numeric token is the current value. */
  benchmark: string;
  /** Path to the baseline JSON file. */
  baseline: string;
  /** Maximum allowed fractional regression in [0, 1]. */
  threshold: number;
  /** Phase 5: optional deterministic-strategy tag. */
  deterministicStrategy?: string;
}

/** Discriminated union of every v1 obligation type. */
export type ObligationV1 =
  | FileMustExistObligation
  | BuildMustPassObligation
  | TestMustPassObligation
  | FunctionMustHaveSignatureObligation
  | PropertyMustHoldObligation
  | ImportGraphMustSatisfyObligation
  | CoverageMustExceedObligation
  | PerformanceMustNotRegressObligation;

/** String literal union of every v1 obligation type. */
export type ObligationType = ObligationV1['type'];

/**
 * Stable canonical ordering of the obligation type tags. Phase 0–6 types
 * keep their original positions so contract hashes from earlier phases
 * remain stable; Phase 7 additions append to the end of the list.
 */
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

/**
 * Repository-level context fed to the contract compiler. Used to resolve
 * build/test obligations to concrete commands and to produce LLM-grade
 * background for the extractor.
 */
export interface RepoContext {
  /** Absolute path to the repository root. */
  repoRoot: string;
  /** Resolved build command, or null if none could be discovered. */
  buildCommand: string | null;
  /** Resolved test command, or null if none could be discovered. */
  testCommand: string | null;
  /** Detected primary language, or 'unknown' when no signal. */
  language: 'typescript' | 'javascript' | 'python' | 'unknown';
}

/**
 * Provenance metadata for the LLM extraction step.
 *
 * Phase 1 spec (impl guide §4) requires recording a "seed" so contract
 * identity is reproducible. We record the model id, sampling temperature,
 * and a sha256 of the prompt sent to the model. The contract hash itself is
 * computed only over canonical obligation bytes, not over provenance.
 */
export interface ExtractorProvenance {
  /** Free-form name of the extractor implementation, e.g. "anthropic". */
  name: string;
  /** Model id, when applicable (e.g. "claude-sonnet-4-5"). */
  model: string | null;
  /** Sampling temperature, or null when not applicable. */
  temperature: number | null;
  /** Sha256 of the prompt the extractor sent to the LLM, hex. */
  promptSha256: string | null;
}

/**
 * In-memory representation of a contract before approval and persistence.
 * Obligations are already validated and canonically ordered.
 */
export interface DraftContract {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  goal: string;
  repoContext: RepoContext;
  obligations: ObligationV1[];
  extractor: ExtractorProvenance;
}

/**
 * Manifest serialized alongside contract.jsonl. Captures everything not in
 * the obligation list itself so the .jsonl format remains exactly the
 * schema-validated obligations the verifier consumes.
 */
export interface ContractManifest {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  /** Sha256 of the canonical JSONL bytes (full hex). */
  contractHash: string;
  /** Short prefix of contractHash used for filesystem ids. */
  contractId: string;
  goal: string;
  repoContext: RepoContext;
  extractor: ExtractorProvenance;
  /** ISO-8601 UTC timestamp the contract was finalized. */
  createdAt: string;
}

/** A finalized contract: manifest plus its obligation list. */
export interface FinalContract {
  manifest: ContractManifest;
  obligations: ObligationV1[];
}
