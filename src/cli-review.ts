import { type ProbeRun, type ReviewProbe, readAnswers } from "./agent-review.ts";
import { probeVerifier, type TaskGoalContext } from "./cli-task-goal.ts";
import { asJsonValue, digestOfJson } from "./evidence/canonical-json.ts";
import {
  declareDerivedGoalContract,
  freezeGoalContract,
  type GoalContract,
} from "./evidence/goal-contract.ts";
import { patchAgainstBase } from "./gates/scratch-index.ts";
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
          return { kind: "did-not-load", detail: `the probe program did not load: ${tail}` };
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
