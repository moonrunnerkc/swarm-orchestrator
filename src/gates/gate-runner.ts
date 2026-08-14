import { z } from "zod";
import type { GateStatus, LoopEvent } from "../core/loop-events.ts";
import { claimPayloadSchema } from "../evidence/claim.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { CoverageArtifactStore } from "./coverage-artifact.ts";
import {
  defaultGateTimeoutMs,
  type GateCommandRunner,
  type GateContext,
  type GateDefinition,
  type GateMeasures,
  type GateObservation,
  type GateSeverity,
} from "./gate-definition.ts";

/** Big enough to hold a real failing suite, small enough that one gate cannot fill a disk. */
const maxRecordedOutputChars = 256_000;

const gateRunSchema = z.object({
  gateId: z.string().min(1),
  title: z.string(),
  severity: z.enum(["blocking", "advisory"]),
  status: z.enum(["passed", "failed", "not-applicable"]),
  blocking: z.boolean(),
  detail: z.string(),
  attempt: z.number().int().nonnegative(),
  command: z.string().nullable(),
  exitCode: z.number().int(),
  durationMs: z.number().nonnegative(),
  unavailable: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  outputTruncated: z.boolean(),
  measures: z.record(z.string(), z.number()),
});

interface GateRun {
  readonly gateId: string;
  readonly title: string;
  readonly severity: GateSeverity;
  readonly status: GateStatus;
  readonly detail: string;
  readonly measures: GateMeasures;
  readonly observation: GateObservation;
  /** What this gate's runner wrote to the report path it was given, or null for neither. */
  readonly coverageReport: string | null;
  /** The payload digest of this run's ledger record, which a claim may cite. */
  readonly record: string;
}

export interface GateCycle {
  readonly attempt: number;
  readonly runs: readonly GateRun[];
  readonly statuses: Readonly<Record<string, GateStatus>>;
  readonly blockingFailures: readonly GateRun[];
  readonly advisoryFailures: readonly GateRun[];
  /** Every gate's measures merged. Later gates win on a name collision, which is recorded. */
  readonly measures: GateMeasures;
  /**
   * The reports the runners wrote this cycle, which is the only place coverage is read from.
   * Empty means nothing measured it, which the ratchet abstains on by name.
   */
  readonly coverageReports: readonly string[];
}

export interface GateCycleDependencies {
  readonly commands: GateCommandRunner;
  readonly evidence: EvidenceRecorder;
  readonly emit: (event: LoopEvent) => void;
  /**
   * Reads back the reports gate commands were told to write. Absent means no report is
   * collected and coverage of changed lines goes unmeasured, which is the honest reading.
   */
  readonly coverageArtifacts?: CoverageArtifactStore;
}

export function isGreen(cycle: GateCycle): boolean {
  return cycle.blockingFailures.length === 0;
}

/**
 * Runs every gate, records each one, and reports. Every gate runs even after one fails:
 * the ratchet needs the whole picture, and a reviewer opening the bundle should see what
 * the other gates were doing rather than a run that stopped at the first red.
 */
export async function runGateCycle(
  gates: readonly GateDefinition[],
  context: GateContext,
  attempt: number,
  deps: GateCycleDependencies,
): Promise<GateCycle> {
  const runs: GateRun[] = [];
  const statuses: Record<string, GateStatus> = {};
  const measures: Record<string, number> = {};

  for (const gate of gates) {
    const { observation, coverageReport } = await observe(gate, context, deps);
    const reading = gate.parse(observation);
    const blocking = gate.severity === "blocking";

    const payload = gateRunSchema.parse({
      gateId: gate.id,
      title: gate.title,
      severity: gate.severity,
      status: reading.status,
      blocking,
      detail: reading.detail,
      attempt,
      command: gate.source.kind === "command" ? gate.source.command : null,
      exitCode: observation.exitCode,
      durationMs: observation.durationMs,
      unavailable: observation.unavailable,
      stdout: truncate(observation.stdout),
      stderr: truncate(observation.stderr),
      outputTruncated:
        observation.stdout.length > maxRecordedOutputChars ||
        observation.stderr.length > maxRecordedOutputChars,
      measures: reading.measures,
    });

    const recorded = await deps.evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload,
    });

    const run: GateRun = {
      gateId: gate.id,
      title: gate.title,
      severity: gate.severity,
      status: reading.status,
      detail: reading.detail,
      measures: reading.measures,
      observation,
      coverageReport,
      record: recorded.record.payloadDigest,
    };
    runs.push(run);
    statuses[gate.id] = reading.status;
    Object.assign(measures, reading.measures);

    // Emitted after the record exists, and carrying its digest, so what the screen shows
    // is what the ledger holds rather than a parallel account of it.
    deps.emit({
      type: "gate",
      gateId: gate.id,
      status: reading.status,
      blocking,
      detail: reading.detail,
      record: recorded.record.payloadDigest,
    });
  }

  return {
    attempt,
    runs,
    statuses,
    blockingFailures: runs.filter((run) => run.status === "failed" && run.severity === "blocking"),
    advisoryFailures: runs.filter((run) => run.status === "failed" && run.severity === "advisory"),
    measures,
    coverageReports: runs
      .map((run) => run.coverageReport)
      .filter((report): report is string => report !== null),
  };
}

interface GateOutput {
  readonly observation: GateObservation;
  readonly coverageReport: string | null;
}

/**
 * Runs one gate and collects whatever the runner wrote beside its output. The report path is
 * cleared first: a file left behind by an earlier attempt would otherwise be read as this
 * attempt's measurement, which is the same defect as reading stdout, one run later.
 */
async function observe(
  gate: GateDefinition,
  context: GateContext,
  deps: GateCycleDependencies,
): Promise<GateOutput> {
  if (gate.source.kind === "inspection") {
    return { observation: await gate.source.inspect(context), coverageReport: null };
  }

  const artifact = gate.source.coverageArtifact;
  const store = deps.coverageArtifacts;
  const collecting = artifact !== undefined && store !== undefined;
  if (collecting) {
    await store.clear(artifact);
  }

  const observation = await deps.commands.run(gate.source.command, {
    cwd: context.workspaceRoot,
    timeoutMs: gate.source.timeoutMs ?? defaultGateTimeoutMs,
  });

  return {
    observation,
    coverageReport: collecting ? await store.read(artifact) : null,
  };
}

function truncate(text: string): string {
  return text.length <= maxRecordedOutputChars
    ? text
    : `${text.slice(0, maxRecordedOutputChars)}\n[truncated at ${maxRecordedOutputChars} characters]`;
}

/**
 * Advisory gates that asked for a justification and did not get one. Section 3.7's diff
 * budget does not block; it demands a claim that lands in the bundle. Nothing enforces that
 * demand, so the outstanding ones are named here and reported, which is the difference
 * between an advisory gate and a gate nobody reads.
 */
export function outstandingJustifications(
  cycle: GateCycle,
  citedRecords: ReadonlySet<string>,
): readonly GateRun[] {
  return cycle.advisoryFailures.filter((run) => !citedRecords.has(run.record));
}

/** Every record digest some claim on the ledger cites. */
export function citedRecords(evidence: EvidenceRecorder): ReadonlySet<string> {
  const cited = new Set<string>();
  for (const record of evidence.records()) {
    if (record.type !== "claim") {
      continue;
    }
    const payload = evidence.payloads().get(record.payloadDigest);
    const parsed = claimPayloadSchema.safeParse(payload);
    if (parsed.success && parsed.data.record !== null) {
      cited.add(parsed.data.record);
    }
  }
  return cited;
}

/** What the model is shown after a failure: the gate's own bytes, not a summary of them. */
export function describeFailuresForModel(cycle: GateCycle): string {
  const sections = cycle.blockingFailures.map((run) =>
    [
      `gate ${run.gateId} (${run.title}) FAILED: ${run.detail}`,
      `evidence record: ${run.record} kind gate-run:${run.gateId}`,
      run.observation.stdout.trim().length === 0 ? "" : `stdout:\n${run.observation.stdout.trim()}`,
      run.observation.stderr.trim().length === 0 ? "" : `stderr:\n${run.observation.stderr.trim()}`,
    ]
      .filter((part) => part.length > 0)
      .join("\n"),
  );

  const advisory = cycle.advisoryFailures.map(
    (run) =>
      `advisory gate ${run.gateId} (${run.title}) is over budget: ${run.detail}\n` +
      `evidence record: ${run.record} kind gate-run:${run.gateId}\n` +
      "This does not block. Submit a claim citing that record to justify the size.",
  );

  return [...sections, ...advisory].join("\n\n");
}
