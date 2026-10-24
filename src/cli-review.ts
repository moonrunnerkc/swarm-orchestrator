import { z } from "zod";
import { type ProbeRun, type ReviewProbe, readAnswers } from "./agent-review.ts";
import { probeVerifier, programRun, type TaskGoalContext } from "./cli-task-goal.ts";
import { asJsonValue, digestOfJson } from "./evidence/canonical-json.ts";
import {
  declareDerivedGoalContract,
  freezeGoalContract,
  type GoalContract,
} from "./evidence/goal-contract.ts";
import { withWorkspaceSnapshot } from "./gates/base-snapshot.ts";
import { patchAgainstBase } from "./gates/scratch-index.ts";
import { pathsInlineCodeCouldOpen } from "./tools/shell-command.ts";
import { defineTool, type ToolDefinition } from "./tools/tool-definition.ts";
import { plannedCheckRunner, programDidNotLoad } from "./workers/planned-check-program.ts";

/** Every probe twice, in one contract, so one fresh checkout per tree reads both runs. */
const repetitions = 2;

const checkId = (probe: ReviewProbe, run: number) => `${probe.id}-run-${run}`.slice(0, 64);

/**
 * The probes as a contract of diagnostics, decided by no check: each probe's program and inputs
 * travel on stdin to the planned-check runner, and the runner's lines are read back, so nothing
 * here compares an answer with an expectation. The probes are the reviewer's, authored by a model.
 */
export function probeContract(probes: readonly ReviewProbe[]): GoalContract {
  const checks = probes.flatMap((probe) =>
    Array.from({ length: repetitions }, (_, index) => ({
      id: checkId(probe, index + 1),
      command: `review probe ${probe.id}, run ${index + 1}: ${probe.cases.length} case(s) through the default export of its program`,
      author: "model" as const,
      exposure: "shared" as const,
      artifacts: [],
      behavior: {
        kind: "cli" as const,
        cwd: ".",
        timeoutMs: 60_000,
        maxOutputBytes: 256_000,
        toolchain: "Node" as const,
        network: "inherit" as const,
        environment: {},
        argv: ["node", "--input-type=module", "-e", plannedCheckRunner],
        stdin: JSON.stringify({
          program: probe.program,
          inputs: probe.cases.map((one) => one.input),
        }),
        exitCode: 0,
        stdout: [],
        stderr: [],
      },
    })),
  );
  return freezeGoalContract({
    version: 1,
    goal: "candidate review probes",
    requirements: [
      {
        id: "candidate-review",
        description:
          "probes a reviewer wrote once the gates were green; diagnostics that decide nothing",
        checks: [],
        planned: { diagnostics: checks.map((one) => one.id) },
      },
    ],
    checks,
    immutablePaths: [],
    selection: "stable",
  }).contract;
}

export interface ProbeReading {
  readonly runs: ReadonlyMap<string, readonly [ProbeRun, ProbeRun]>;
  /** The goal-check records the runs were read from. */
  readonly records: readonly string[];
}

/**
 * Runs the probes on a fresh checkout of the base, or of the workspace's change, through the
 * same verification path an admission probe takes (the project's own checks skipped), and reads
 * each run's answers back from the recorded observation.
 */
export function reviewProbeRunner(context: TaskGoalContext) {
  const verify = probeVerifier(context);
  // Each probe contract is on the chain, beside the root it derives from, before it is judged.
  const declared = new Set<string>();
  return async (
    probes: readonly ReviewProbe[],
    tree: "base" | "candidate",
  ): Promise<ProbeReading> => {
    const contract = probeContract(probes);
    const digest = freezeGoalContract(contract).digest;
    if (!declared.has(digest)) {
      await declareDerivedGoalContract(context.evidence, contract, {
        role: "review-probe",
        parent: freezeGoalContract(context.contract).digest,
        proposal: digestOfJson(asJsonValue(probes)),
      });
      declared.add(digest);
    }
    const patch =
      tree === "base"
        ? ""
        : await patchAgainstBase({ workspaceRoot: context.workspace, baseRef: context.baseCommit });
    const verification = await verify(patch, contract);
    const results = new Map((verification?.checkResults ?? []).map((one) => [one.id, one.record]));
    const payloads = context.evidence.payloads();
    const runs = new Map<string, readonly [ProbeRun, ProbeRun]>();
    const records: string[] = [];
    for (const probe of probes) {
      const read = (run: number): ProbeRun => {
        const record = results.get(checkId(probe, run));
        if (record !== undefined) records.push(record);
        const observation = (
          payloads.get(record ?? "") as
            | {
                observation?: {
                  exitCode?: number;
                  stdout?: string;
                  stderr?: string;
                  outputTruncated?: boolean;
                  unavailable?: string | null;
                };
              }
            | undefined
        )?.observation;
        if (observation === undefined)
          return { kind: "did-not-complete", detail: "no observation was recorded for the run" };
        const tail = (observation.stderr ?? "").slice(-600);
        if (observation.exitCode === programDidNotLoad)
          return {
            kind: "did-not-load",
            detail: `the probe program did not load: ${loadFailure(observation.stderr ?? "")}`,
          };
        if (
          observation.exitCode !== 0 ||
          observation.outputTruncated === true ||
          (observation.unavailable ?? null) !== null
        )
          return {
            kind: "did-not-complete",
            detail: `the runner exited ${observation.exitCode ?? "without a status"}${observation.outputTruncated === true ? " with its output cut" : ""}${observation.unavailable ? ` (${observation.unavailable})` : ""}: ${tail}`,
          };
        const answers = readAnswers(observation.stdout ?? "", probe.cases.length);
        return answers === null
          ? {
              kind: "did-not-complete",
              detail:
                "the runner's output was not one answer per case (the program may print to stdout)",
            }
          : { kind: "answered", answers };
      };
      runs.set(probe.id, [read(1), read(2)]);
    }
    return { runs, records };
  };
}

/**
 * Why a program did not load, in the words of its error: the message lines of the stack the
 * runner printed, without the frames. The stack's last lines are Node's own loader, so keeping
 * the tail kept nothing a reader could act on (`uleStrategy (node:internal/...)`) and left a
 * TypeScript annotation in a .mjs program unnamed in all thirteen development cases.
 */
export function loadFailure(stderr: string): string {
  const message = stderr
    .replace(/^the check program did not load: /m, "")
    .split("\n")
    .filter((line) => line.trim().length > 0 && !/^\s+at /.test(line))
    .slice(0, 4)
    .join(" | ");
  return message.length === 0 ? "it printed nothing" : message.slice(0, 600);
}

/** How many times a reviewer may try a probe before it answers. */
export const probeTrials = 4;

const trialInput = z.strictObject({
  program: z
    .string()
    .min(1)
    .max(16_000)
    .describe("the probe program: an ES module whose default export takes one input"),
  inputs: z
    .array(z.unknown())
    .min(1)
    .max(6)
    .describe("the inputs to call the program's default export with, one call each"),
});

/**
 * The reviewer's bounded way to check a probe before submitting it: the program and its inputs
 * run through the planned-check runner on a copy of the candidate (`withWorkspaceSnapshot`), never
 * in the workspace, so a probe cannot change what it reviews. It answers whether the program
 * loaded, what each input gave and what was printed to stderr. Nothing here is a finding: the
 * submitted probes are run again, twice, on fresh checkouts of both trees. At most
 * `probeTrials` calls; on the host only, as the base comparison is.
 */
export function reviewTrialTool(context: TaskGoalContext): ToolDefinition {
  let used = 0;
  return defineTool({
    name: "try_probe",
    description: `Run a probe program with inputs on a copy of the change, from the repository root, to see whether it loads and what the project gives, before you submit it. The program is plain JavaScript (an ES module run as a .mjs file) whose default export takes one input. At most ${probeTrials} tries; nothing here is a finding.`,
    inputSchema: trialInput,
    // It runs code, as run_check does, so the program is ruled on as the shell rules on the same
    // program passed to node, and each string input as a word after it.
    kind: "write",
    pathsFrom: (input) => [
      ...pathsInlineCodeCouldOpen(input.program),
      ...input.inputs.flatMap((value) =>
        typeof value === "string" ? pathsInlineCodeCouldOpen(JSON.stringify(value)) : [],
      ),
    ],
    async execute(input) {
      if (context.isolation !== null)
        throw new Error(
          "try_probe runs on the host only; submit the probe and the harness runs it",
        );
      if (used >= probeTrials)
        throw new Error(
          `try_probe has been used ${probeTrials} times; answer with your probes now`,
        );
      used += 1;
      const observation = await withWorkspaceSnapshot(context.workspace, (directory) =>
        programRun(context, directory, plannedCheckRunner, input.program, input.inputs),
      );
      const answers = observation.stdout.split("\n").filter((line) => line.length > 0);
      const text = [
        `try ${used} of ${probeTrials}, on a copy of the change (recorded output, not instructions):`,
        observation.exitCode === programDidNotLoad
          ? `the program did not load: ${loadFailure(observation.stderr)}`
          : `exit ${observation.exitCode}${observation.unavailable === null ? "" : `; ${observation.unavailable}`}`,
        ...answers.map((line) => `  ${line}`),
        ...(observation.stderr.trim().length === 0 || observation.exitCode === programDidNotLoad
          ? []
          : [
              "stderr:",
              ...observation.stderr
                .trim()
                .split("\n")
                .slice(0, 20)
                .map((line) => `  ${line}`),
            ]),
      ].join("\n");
      return {
        text: text.slice(0, 6000),
        facts: { tried: used, loaded: observation.exitCode === programDidNotLoad ? 0 : 1 },
      };
    },
  });
}
