export {
  runVerificationCommand,
  type VerificationCommandResult,
} from './command-runner';
export {
  runDifferentialGate,
  type DifferentialGateInput,
  type DifferentialGateResult,
  type DifferentialGateStatus,
} from './differential-gate';
export {
  synthesizeRegressionTest,
  type SynthesizedTestCandidate,
  type TestSynthesisAttempt,
  type TestSynthesisInput,
  type TestSynthesisResult,
  type TestSynthesisStatus,
} from './test-synthesizer';
export {
  DEFAULT_MUTATION_THRESHOLDS,
  buildMutationCommand,
  detectMutationLanguages,
  evaluateMutationScore,
  loadMutationThresholds,
  parseMutationOutput,
  runMutationGate,
  type MutationCommandRunner,
  type MutationGateInput,
  type MutationGateResult,
  type MutationGateStatus,
  type MutationLanguage,
  type MutationLanguageTarget,
  type MutationThresholds,
  type MutationToolResult,
} from './mutation-gate';
export {
  runCheatDetector,
  type CheatDetectorInput,
  type CheatDetectorResult,
  type CheatFinding,
  type CheatFindingSeverity,
} from './cheat-detector';
export {
  extractLiterals,
  isTestFilePath,
  parseUnifiedDiff,
  type ParsedDiffFile,
  type ParsedDiffLine,
} from './diff-analysis';
export {
  discoverPropertyTargets,
  runPropertyGate,
  type PropertyCommandRunner,
  type PropertyFinding,
  type PropertyGateInput,
  type PropertyGateResult,
  type PropertyGateStatus,
  type PropertyLanguage,
  type PropertyTarget,
} from './property-gate';
export {
  attachAttestationNote,
  createAttestationEnvelope,
  generateSignedAttestation,
  readAttestationNote,
  signWithCosign,
  unsignedTestSigner,
  verifyAttestation,
  type AttestationAgentIdentity,
  type AttestationInput,
  type AttestationLayerResult,
  type AttestationSignature,
  type AttestationSigner,
  type AttestationVerificationResult,
  type CosignKeySigningOptions,
  type InTotoStatement,
  type SignedAttestation,
} from './attestation';
export {
  signWithCosignKey,
} from './cosign-attestation';
export {
  DEFAULT_COMPOSITE_CONFIG,
  computeCompositeScore,
  loadCompositeScoreConfig,
  type CompositeScoreConfig,
  type CompositeScoreInput,
  type CompositeScoreResult,
  type CompositeLayerStatus,
  type CompositeWeights,
} from './composite-score';
