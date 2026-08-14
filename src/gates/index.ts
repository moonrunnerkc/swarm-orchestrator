export {
  type AutoResolveAttempt,
  type AutoResolveDependencies,
  type AutoResolveOutcome,
  defaultAttemptCap,
  type ResolveAttempt,
  type ResolveRequest,
  runAutoResolve,
} from "./auto-resolve.ts";
export {
  type BaseControlOptions,
  createBaseControlRunner,
  singleFileTestCommand,
} from "./base-control.ts";
export {
  assembleGates,
  commandGate,
  type GateSetOptions,
  noOutputParser,
  unavailableGate,
} from "./default-gates.ts";
export {
  defaultDiffBudget,
  type GatesEngineOptions,
  type GatesEngineRun,
  runGatesEngine,
} from "./engine.ts";
export {
  type AttemptSummary,
  attemptSummarySchema,
  describeEscalation,
  type EscalationPayload,
  escalationSchema,
} from "./escalation.ts";
export {
  checkFileSet,
  createFileSetRegistry,
  emptyFileSet,
  FileSetAlreadyDeclaredError,
  type FileSetAmendment,
  type FileSetRegistry,
  type FileSetState,
  type FileSetVerdict,
  fileSetAmendmentSchema,
  fileSetDeclarationSchema,
  normalizePath,
} from "./file-set.ts";
export { createAmendFileSetTool, createDeclareFileSetTool } from "./file-set-tool.ts";
export {
  type CommandOptions,
  type DiffBudget,
  defaultGateTimeoutMs,
  type GateCommandRunner,
  type GateContext,
  type GateDefinition,
  type GateInspection,
  type GateMeasures,
  type GateObservation,
  type GateParser,
  type GateReading,
  type GateSeverity,
  type GateSource,
  observationFromJson,
  unavailableObservation,
} from "./gate-definition.ts";
export {
  citedRecords,
  describeFailuresForModel,
  type GateCycle,
  type GateCycleDependencies,
  type GateRun,
  type GateRunPayload,
  gateRunSchema,
  isGreen,
  outstandingJustifications,
  runGateCycle,
} from "./gate-runner.ts";
export {
  createGitCheckpoint,
  createGitWorkspaceProbe,
  GitUnavailableError,
  type GitWorkspaceOptions,
  revertSourceToBase,
} from "./git-workspace.ts";
export {
  diffBudgetGate,
  fileSetGate,
  findPlaceholders,
  inspectionGates,
  type PlaceholderFinding,
  placeholderGate,
  secretScanGate,
} from "./inspection-gates.ts";
export {
  type ComparablePair,
  type ComparableTotals,
  comparableTotals,
  emptyMeasureSnapshot,
  type MeasureSnapshot,
  measuresFor,
  respecificationAllowance,
  type SnapshotInput,
  takeMeasureSnapshot,
} from "./measure-snapshot.ts";
export {
  assertionSubject,
  emptyTestFileMeasures,
  isTestFile,
  isTestReachableSource,
  measureTestFile,
  type TestFileMeasures,
} from "./measures.ts";
export { createNodeCommandRunner } from "./node-command-runner.ts";
export {
  exitCodeParser,
  inspectionParser,
  matchCoverageFile,
  measureNames,
  parseUncoveredLines,
  testCounterParser,
  testOutputParser,
  vitestTestParser,
} from "./parsers.ts";
export {
  detectProject,
  type ManifestReader,
  manifestsByType,
  type ProjectDetection,
  type ProjectType,
} from "./project-type.ts";
export {
  judgeRatchet,
  type RatchetAbstention,
  type RatchetDecision,
  type RatchetDecisionPayload,
  type RatchetInput,
  type RatchetViolation,
  type RatchetViolationKind,
  ratchetDecisionSchema,
  ratchetPayload,
} from "./ratchet.ts";
export {
  assessRespecification,
  type BaseControlRunner,
  type ControlOutcome,
  type ControlRun,
  findExemptFiles,
  indeterminate,
  type RespecificationFinding,
  type RespecificationPayload,
  respecificationSchema,
} from "./respecification.ts";
export { parseUnifiedDiff, reconstructSides } from "./unified-diff.ts";
export {
  type AddedLine,
  type CapturedWorkspace,
  type ChangedFile,
  type ChangeKind,
  changedPaths,
  changedTestPaths,
  countAddedLines,
  countRemovedLines,
  noChanges,
  type WorkspaceChanges,
  type WorkspaceCheckpoint,
  type WorkspaceProbe,
} from "./workspace-changes.ts";
