export { type BackendCommands, formatBackendCommands } from "./backend-command.ts";
export { bundledShortlistLocation, readBundledShortlist } from "./bundled-shortlist.ts";
export {
  type CalibrationOptions,
  type CalibrationResult,
  minimumRepeats,
  runCalibration,
} from "./calibrate.ts";
export {
  type CalibrationCase,
  calibrationCaseSchema,
  caseDigest,
  MalformedCalibrationCaseError,
  parseCalibrationCase,
} from "./calibration-case.ts";
export {
  type ModelCallTally,
  payloadsSince,
  type RecordedPayload,
  type ToolCallTally,
  tallyModelCalls,
  tallyToolCalls,
} from "./calibration-measures.ts";
export {
  type CalibrationPick,
  type CalibrationReportInput,
  compareWithShortlist,
  pickFromCalibration,
  type RejectedModel,
  renderCalibrationReport,
  type ShortlistComparison,
} from "./calibration-report.ts";
export {
  type CalibrationRepeatObservation,
  type CalibrationRunDependencies,
  type MemoryProbe,
  runCalibrationRepeat,
} from "./calibration-run.ts";
export {
  type CaseBreakdown,
  type ModelSummary,
  summarizeByModel,
} from "./calibration-summary.ts";
export {
  type CalibrationDimension,
  calibrationDimensions,
  type DimensionSpec,
  type Distribution,
  dimensionSpecs,
  distributionOf,
  statisticOf,
} from "./dimensions.ts";
export {
  appendCalibrationCase,
  DuplicateCalibrationCaseError,
  defaultGoldenSetPath,
  type GoldenSet,
  goldenSetSchemaVersion,
  goldenSetVersion,
  readGoldenSet,
} from "./golden-set.ts";
export {
  type GpuReading,
  type GpuVendor,
  type HardwareProfile,
  type ProbeCommandRunner,
  type ProbeEnvironment,
  probeHardware,
} from "./hardware-probe.ts";
export { createOllamaMemoryProbe, nativeEndpointFor } from "./memory-probe.ts";
export {
  type CalibrationPickRecord,
  defaultPickPath,
  readCalibrationPick,
  writeCalibrationPick,
} from "./pick-store.ts";
export {
  calibrationCandidates,
  type NoTierMatched,
  type Recommendation,
  type RecommendedModel,
  recommendModel,
} from "./recommendation.ts";
export {
  buildRewardEntry,
  defaultRewardWeights,
  type RewardEntryInput,
  type RewardInput,
  type RewardScore,
  type RewardWeights,
  scoreReward,
} from "./reward.ts";
export {
  type AssignmentKind,
  assignmentKinds,
  defaultRoutingLogPath,
  openRoutingLog,
  type RewardEntry,
  type RoutingLog,
  type RoutingLogContents,
  rewardEntrySchema,
  routingLogSchemaVersion,
} from "./routing-log.ts";
export { type RoutingReportInput, renderRoutingReport } from "./routing-report.ts";
export { renderSelectReport, type SelectReport } from "./select-report.ts";
export {
  MalformedShortlistError,
  parseShortlist,
  type Shortlist,
  type ShortlistBackend,
  type ShortlistModel,
  type ShortlistTier,
  shortlistSchemaVersion,
} from "./shortlist.ts";
export {
  bundledShortlistKeyword,
  defaultShortlistUrl,
  type LoadedShortlist,
  loadShortlist,
  type ShortlistFetch,
  type ShortlistOrigin,
  type ShortlistSource,
  ShortlistUnavailableError,
} from "./shortlist-source.ts";
export { systemProbeEnvironment } from "./system-probe.ts";
export {
  classifyTask,
  type TaskClass,
  type TaskClassification,
  taskClasses,
} from "./task-class.ts";
export {
  type Arm,
  armsFor,
  defaultRouterSettings,
  type RouterSettings,
  type RoutingDecision,
  type RoutingInput,
  routeModel,
} from "./ucb.ts";
