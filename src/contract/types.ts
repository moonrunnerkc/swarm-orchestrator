/**
 * Type definitions for v8 contract obligations and the runtime objects the
 * compiler, validator, and serializer pass between each other.
 *
 * On-disk shape is defined by `schema/v1.json`; this file is the
 * TypeScript-side mirror. Schema and types are kept in lockstep — schema
 * changes mean a `v2.json`, a new union member, and a new schema-version
 * string. See `docs/v8-implementation-guide.md` §4 and §13.
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

/** Discriminated union of every v1 obligation type. */
export type ObligationV1 =
  | FileMustExistObligation
  | BuildMustPassObligation
  | TestMustPassObligation;

/** String literal union of every v1 obligation type. */
export type ObligationType = ObligationV1['type'];

/** Stable canonical ordering of the obligation type tags. */
export const OBLIGATION_TYPES: readonly ObligationType[] = [
  'file-must-exist',
  'build-must-pass',
  'test-must-pass',
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
