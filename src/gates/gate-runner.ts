import { z } from "zod";
import type { GateStatus, LoopEvent } from "../core/loop-events.ts";
import { claimPayloadSchema } from "../evidence/claim.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
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
  /**
   * The vector the harness spawned, where it spawned one. `command` beside it is a rendering
   * for a reader; this is what ran, argument by argument, and a reviewer comparing the two is
   * comparing the run to its own description.
   */
  argv: z.array(z.string()).nullable(),
  /** The rule that read the bytes below into the status above, by name, so a reader can apply it. */
  parser: z.enum(["exit-code", "no-output", "test-output", "inspection"]),
  stdout: z.string(),
  stderr: z.string(),
  outputTruncated: z.boolean(),
  measures: z.record(z.string(), z.number()),
});

interface GateRun {
  readonly gateId: string;
  /** Whether this gate ran a command or read the diff, which is what "measured" turns on. */
  readonly kind: "command" | "inspection";
  readonly title: string;
  readonly severity: GateSeverity;
  readonly status: GateStatus;
  readonly detail: string;
  readonly measures: GateMeasures;
  readonly observation: GateObservation;
  /** What this gate's runner wrote to the report path it was given, or null for neither. */
  readonly coverageReport: string | null;
  /** The TAP this gate's runner was told to write, or null where none was asked for. */
  readonly testReport: string | null;
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
  /**
   * The TAP the runners wrote this cycle, which is the only place the collected count is read
   * from. Empty abstains, for the same reason and by the same route.
   */
  readonly testReports: readonly string[];
}

export interface GateCycleDependencies {
  readonly commands: GateCommandRunner;
  readonly evidence: EvidenceRecorder;
  readonly emit: (event: LoopEvent) => void;
}

/**
 * Whether anything actually ran over the change.
 *
 * A gate that runs a command executed the code; one that reads the diff can do that over any
 * workspace and cannot vouch for code on its own. So a change every command gate stood down
 * on was never executed by anything: a run wrote three files into a workspace whose declared
 * test command collected no tests, no gate failed, and the strip read green over code nothing
 * had tried. Read off what a gate is rather than which gate it is (invariant 6).
 *
 * A tree nothing touched is measured by definition: there is nothing there to run over.
 */
export function measuredTheChange(cycle: GateCycle): boolean {
  if ((cycle.measures.changedFiles ?? 0) === 0) {
    return true;
  }
  return cycle.runs.some((run) => run.kind === "command" && run.status !== "not-applicable");
}

export function isGreen(cycle: GateCycle): boolean {
  return cycle.blockingFailures.length === 0 && measuredTheChange(cycle);
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
    const { observation, coverageReport, testReport } = await observe(gate, context, deps);
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
      argv: gate.source.kind === "command" ? (gate.source.argv ?? null) : null,
      parser: gate.parserName ?? "exit-code",
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
      kind: gate.source.kind,
      title: gate.title,
      severity: gate.severity,
      status: reading.status,
      detail: reading.detail,
      measures: reading.measures,
      observation,
      coverageReport,
      testReport,
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
    testReports: runs
      .map((run) => run.testReport)
      .filter((report): report is string => report !== null),
  };
}

export interface GateOutput {
  readonly observation: GateObservation;
  readonly coverageReport: string | null;
  readonly testReport: string | null;
}

/**
 * Runs one gate and collects whatever the runner wrote beside its output. The report path is
 * cleared first: a file left behind by an earlier attempt would otherwise be read as this
 * attempt's measurement, which is the same defect as reading stdout, one run later.
 */
export async function observe(
  gate: GateDefinition,
  context: GateContext,
  deps: GateCycleDependencies,
): Promise<GateOutput> {
  if (gate.source.kind === "inspection") {
    return {
      observation: await gate.source.inspect(context),
      coverageReport: null,
      testReport: null,
    };
  }

  const options = {
    cwd: context.workspaceRoot,
    timeoutMs: gate.source.timeoutMs ?? defaultGateTimeoutMs,
  };

  // A command the project declared is read by a shell, because that is what it is. Its streams
  // are whatever it chose to print, so nothing is read off them as a measurement.
  if (gate.source.argv === undefined) {
    return {
      observation: await deps.commands.run(gate.source.command, options),
      coverageReport: null,
      testReport: null,
    };
  }

  // A vector the harness built, spawned as one. The harness picked the reporters, so it knows
  // which stream carries which report, and both arrive down pipes it owns: under process
  // isolation a test's own output is captured by the parent and folded into the reporters'
  // streams as escaped comments, so nothing a test prints reaches either at column zero.
  const observation = await deps.commands.runVouched(gate.source.argv, options);
  return {
    observation,
    coverageReport: observation.stderr,
    testReport: observation.stdout,
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

  // Not a gate's own bytes, because no gate objected: every one of them that runs a command
  // stood down, so there is nothing to quote and nothing yet to fix. Saying so is the only way
  // the loop that reads this can act on it.
  const unmeasured = measuredTheChange(cycle)
    ? []
    : [
        "Nothing ran over this change. Every gate that runs a command stood down: " +
          `${cycle.runs
            .filter((run) => run.kind === "command")
            .map((run) => `${run.gateId} (${run.detail})`)
            .join(", ")}. ` +
          `The ${cycle.measures.changedFiles ?? 0} file(s) this change touched were never ` +
          "executed by anything, so passing the other gates says nothing about whether the " +
          "code works. Write the change in the language the project's declared test command " +
          "runs, and add a test that command actually collects, in the place it looks for " +
          "one. Declare any file you have not already declared before you write it: widening " +
          "the set without recording an amendment fails a different gate, and rewriting the " +
          "work in another language fails this one again.",
      ];

  return [...unmeasured, ...sections, ...advisory].join("\n\n");
}
