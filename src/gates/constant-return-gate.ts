import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  baseCopyPath,
  type ConstantReturnFinding,
  constantReturnFindings,
  exportedFunctionNames,
  isProbeableModule,
  probePayload,
  probeScript,
  readProbeReports,
} from "./behavioral-probe.ts";
import {
  type GateCommandRunner,
  type GateContext,
  type GateDefinition,
  type GateObservation,
  observationFromJson,
  unavailableObservation,
} from "./gate-definition.ts";
import { inspectionParser } from "./parsers.ts";

/**
 * The gate around the behavioral probe: it reports functions that varied with their input
 * before this change and do not after.
 *
 * Advisory on purpose, and this is not a placeholder for blocking later. What the probe
 * measures is real and what it means is not decidable here: a function can legitimately become
 * constant, and the inputs it varies over can be none of the ones a fixed ladder tries. It
 * reports a measurement and a person reads the diff, which is where the constant-return stub
 * has always belonged.
 */

export interface ProbeOutcome {
  readonly findings: readonly ConstantReturnFinding[];
  readonly filesProbed: number;
  /** Why nothing could be probed at all, or null when the probe ran. */
  readonly unavailable: string | null;
}

export type ConstantReturnProbe = (context: GateContext) => Promise<ProbeOutcome>;

export function createConstantReturnGate(probe: ConstantReturnProbe | null): GateDefinition {
  return {
    id: "constant-return",
    title: "no changed function stopped varying with its input",
    severity: "advisory",
    source: {
      kind: "inspection",
      inspect: async (context: GateContext): Promise<GateObservation> => {
        if (probe === null) {
          return unavailableObservation(
            "nothing was configured to run a behavioral probe, so no function was executed",
          );
        }
        const outcome = await probe(context);
        if (outcome.unavailable !== null) {
          return unavailableObservation(outcome.unavailable);
        }
        return observationFromJson(
          {
            detail:
              outcome.findings.length === 0
                ? `${outcome.filesProbed} changed module(s) probed: no changed function stopped ` +
                  "varying with its input"
                : `${outcome.findings.length} changed function(s) returned one value for every ` +
                  "input tried, having returned several before this change: " +
                  outcome.findings
                    .map(
                      (finding) =>
                        `${finding.path}:${finding.name} (${finding.baseDistinct} distinct before, 1 now)`,
                    )
                    .join("; ") +
                  ". This does not block. Read the diff, and submit a claim citing this record " +
                  "if the function is meant to be constant now.",
            findings: outcome.findings.map((finding) => ({ ...finding })),
            justificationRequired: outcome.findings.length > 0,
            measures: {
              constantReturns: outcome.findings.length,
              modulesProbed: outcome.filesProbed,
            },
          },
          outcome.findings.length === 0 ? 0 : 1,
        );
      },
    },
    parse: inspectionParser,
  };
}

interface ProbeDependencies {
  readonly commands: GateCommandRunner;
  /** Where the probe script is written, outside the workspace the probe is measuring. */
  readonly scriptDirectory: string;
  readonly timeoutMs?: number;
}

/**
 * Shorter than a gate's, because this is not a test run. Importing a module runs whatever it
 * does at the top level, and a module that starts a server or waits on input would otherwise
 * hold a gate cycle for the five minutes a test command is allowed. A probe that timed out
 * measured nothing, which is what the arm reports.
 */
const defaultProbeTimeoutMs = 30_000;

/**
 * Runs each changed module twice in one spawned process: once as the change left it, and once
 * as it stood at the base commit.
 *
 * The base version is written beside the file rather than into a directory of its own, because
 * a module's relative imports resolve against where it sits and moving it would turn every
 * probe into a load error. It is removed again whatever happens, including when the spawn
 * fails, because a stray copy in the tree is a file the next gate cycle would read as a change.
 */
export function createFileConstantReturnProbe(deps: ProbeDependencies): ConstantReturnProbe {
  const timeoutMs = deps.timeoutMs ?? defaultProbeTimeoutMs;

  return async (context: GateContext): Promise<ProbeOutcome> => {
    const scriptPath = join(deps.scriptDirectory, "behavioral-probe.mjs");
    await mkdir(deps.scriptDirectory, { recursive: true });
    await writeFile(scriptPath, probeScript, "utf8");

    const findings: ConstantReturnFinding[] = [];
    let filesProbed = 0;

    for (const file of context.changes.files) {
      // Modified only. An added file has no base version, so there is no earlier variance to
      // have lost, and a deleted one has nothing to run.
      if (file.kind !== "modified" || !isProbeableModule(file.path)) {
        continue;
      }
      const baseText = await context.probe.readBase(file.path);
      const currentText = await context.probe.readCurrent(file.path);
      if (baseText === null || currentText === null) {
        continue;
      }
      // Every export the module still declares. The stub this gate exists for edits a body,
      // so the export line it is declared on is not in the diff, and reading the diff found
      // nothing to probe in exactly the case the probe was built for.
      const names = exportedFunctionNames(currentText);
      if (names.length === 0) {
        continue;
      }

      const copy = baseCopyPath(context.workspaceRoot, file.path);
      try {
        await writeFile(copy, baseText, "utf8");
        const observation = await deps.commands.runVouched(
          ["node", scriptPath, probePayload([copy, join(context.workspaceRoot, file.path)], names)],
          { cwd: context.workspaceRoot, timeoutMs },
        );
        const reports = readProbeReports(observation.stdout);
        const [base, submitted] = reports ?? [];
        if (base === undefined || submitted === undefined) {
          continue;
        }
        filesProbed += 1;
        findings.push(...constantReturnFindings(file.path, base, submitted));
      } finally {
        await rm(copy, { force: true });
      }
    }

    return { findings, filesProbed, unavailable: null };
  };
}
