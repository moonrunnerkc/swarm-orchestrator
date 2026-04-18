export type GateStatus = 'pass' | 'fail' | 'skip';

export interface GateIssue {
  message: string;
  filePath?: string;
  line?: number;
  excerpt?: string;
  hint?: string;
}

export interface GateResult {
  id: string;
  title: string;
  status: GateStatus;
  durationMs: number;
  issues: GateIssue[];
  stats?: Record<string, number>;
}

export interface GateContext {
  projectRoot: string;
  files: ProjectFile[];
  /** Files that existed before agents ran; gates only flag issues on files NOT in this set */
  baselineFiles?: Set<string> | undefined;
  /** Requirement IDs classified as 'skip' for the current task type, used to downgrade gate failures */
  skippedRequirementIds?: Set<string> | undefined;
  /** Base commit used for diff-aware gates. */
  baseCommit?: string | undefined;
}

export interface ProjectFile {
  path: string; // absolute
  relativePath: string; // from projectRoot, posix-ish
  sizeBytes: number;
  text?: string;
}

export interface GenericGateConfig {
  enabled: boolean;
}

export interface QualityGate<TConfig extends GenericGateConfig> {
  id: string;
  title: string;
  run(ctx: GateContext, config: TConfig): Promise<GateResult>;
}

export interface ScaffoldDefaultsConfig {
  enabled: boolean;
  bannedTitleRegexes: string[];
  bannedReadmeRegexes: string[];
  bannedFiles: string[];
}

export interface DuplicateBlocksConfig {
  enabled: boolean;
  minLines: number;
  maxOccurrences: number;
  maxFindings: number;
  excludeFileRegexes: string[];
}

export interface HardcodeConfig {
  enabled: boolean;
  bannedLiteralRegexes: string[];
  allowIfFileContainsRegexes: string[];
  excludeFileRegexes: string[];
}

export interface ReadmeClaimsConfig {
  enabled: boolean;
  claimRules: Array<{
    id: string;
    readmeRegex: string;
    requiredEvidence: Array<{ fileRegex: string; contentRegex: string; note?: string }>;
  }>;
}

export interface TestIsolationConfig {
  enabled: boolean;
  mutableStoreRegexes: string[];
  allowIfFileContainsRegexes: string[];
  testFileRegexes: string[];
  allowIfAnyTestContainsRegexes: string[];
}

export interface RuntimeChecksConfig {
  enabled: boolean;
  /** Number of retry attempts for each check (0 = no retries) */
  retries: number;
  /** Run `npm test` or equivalent */
  runTests: boolean;
  /** Run `npx eslint .` if eslint config exists */
  runLint: boolean;
  /** Run `npm audit --audit-level=moderate` */
  runAudit: boolean;
  /** Timeout per command in ms (default 120000) */
  timeoutMs: number;
}

export interface AccessibilityConfig {
  enabled: boolean;
  requireSkipLink: boolean;
  requireHeadingHierarchy: boolean;
  requireAriaLabels: boolean;
  requireFocusStyles: boolean;
  requireReducedMotion: boolean;
  requireNoPhantomAssets: boolean;
  requireMetaTags: boolean;
  requireResponsiveCSS: boolean;
  requireColorScheme: boolean;
  requireSemanticHTML: boolean;
  requireImgAlt: boolean;
}

export interface TestCoverageConfig {
  enabled: boolean;
  entryPointPatterns: string[];
  minTestAssertions: number;
  requireComponentTests: boolean;
}

/**
 * D4: Detects modifications to pre-existing test files.
 * Agents should write NEW tests, not modify existing ones.
 */
export interface TestFileProtectionConfig {
  enabled: boolean;
  /** Glob patterns that identify test files (matched against relative paths) */
  testFileGlobs: string[];
  /** Maximum number of findings to report */
  maxFindings?: number;
}

export interface BuiltInQualityGateConfigs {
  scaffoldDefaults: ScaffoldDefaultsConfig;
  duplicateBlocks: DuplicateBlocksConfig;
  hardcodedConfig: HardcodeConfig;
  readmeClaims: ReadmeClaimsConfig;
  testIsolation: TestIsolationConfig;
  runtimeChecks: RuntimeChecksConfig;
  accessibility: AccessibilityConfig;
  testCoverage: TestCoverageConfig;
  testFileProtection: TestFileProtectionConfig;
}

export interface QualityGatesConfig {
  enabled: boolean;
  failOnIssues: boolean;
  autoAddRefactorStepOnDuplicateBlocks: boolean;
  autoAddReadmeTruthStepOnReadmeClaims: boolean;
  autoAddScaffoldFixStepOnScaffoldDefaults: boolean;
  autoAddConfigFixStepOnHardcodedConfig: boolean;
  excludeDirNames: string[];
  maxFileSizeBytes: number;
  autoAddAccessibilityFixStepOnAccessibility: boolean;
  autoAddTestCoverageStepOnTestCoverage: boolean;
  gates: BuiltInQualityGateConfigs & Record<string, any>;
}
