/**
 * Public surface of the v8 contract module.
 *
 * Phase 1 exports the goal-to-contract pipeline: types, the compiler, the
 * validator, the canonicalizer, the JSONL serializer, the approval flow,
 * and the two extractor implementations.
 */

export {
  CONTRACT_SCHEMA_VERSION,
  OBLIGATION_TYPES,
  type BuildMustPassObligation,
  type ContractManifest,
  type CoverageMustExceedObligation,
  type DraftContract,
  type ExtractorProvenance,
  type FileMustExistObligation,
  type FinalContract,
  type FunctionMustHaveSignatureObligation,
  type ImportGraphMustSatisfyObligation,
  type ObligationType,
  type ObligationV1,
  type PerformanceMustNotRegressObligation,
  type PropertyMustHoldObligation,
  type RepoContext,
  type TestMustPassObligation,
} from './types';

export {
  ContractValidationError,
  compileGoal,
  discoverRepoContext,
  finalize,
  type CompileOptions,
} from './compiler';

export {
  validateObligations,
  type ValidationError,
  type ValidationResult,
} from './validator';

export {
  canonicalSerialize,
  canonicalSort,
  contractHash,
  contractIdFromHash,
} from './canonicalize';

export {
  CONTRACT_FILENAME,
  MANIFEST_FILENAME,
  parseJsonl,
  readContract,
  writeContract,
} from './serializer';

export {
  ContractRejectedError,
  runApproval,
  type ApprovalIO,
  type RunApprovalOptions,
} from './approval';

export {
  type Extractor,
  type ExtractorInput,
  type ExtractorOutput,
} from './extractor/types';

export {
  AnthropicExtractor,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  type AnthropicExtractorOptions,
} from './extractor/anthropic-extractor';

export { StubExtractor } from './extractor/stub-extractor';

export {
  loadObligationSchema,
  obligationValidator,
} from './schema/loader';

export {
  isKnownBoilerplate,
  pickStrategyForFile,
  tagObligations,
  tagSummary,
  type TaggerOptions,
} from './tagger';

export { findContractFile } from './auto-discover';
