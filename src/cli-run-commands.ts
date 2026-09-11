import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AbortCommand,
  InspectCommand,
  RepairCommand,
  ResumeCommand,
  RetryStepCommand,
} from "./cli-options.ts";
import { importLegacyRunStore } from "./durable/legacy-run-store.ts";
import { recoveryContext } from "./durable/recovery-context.ts";
import { openRunStore } from "./durable/run-store.ts";
import { defaultSessionRoot } from "./evidence/session.ts";
import { repairRuntimeResources } from "./exec/runtime-resource.ts";
import { exitCodes } from "./machine-output.ts";

/** Where the durable state lives: beside the sessions, outside every workspace. */
export function runStorePath(): string {
  const root = join(defaultSessionRoot(homedir()), "..");
  const destination = join(root, "runs.jsonl");
  importLegacyRunStore(join(root, "runs.db"), destination);
  return destination;
}

function withRunStore<T>(read: (store: ReturnType<typeof openRunStore>) => T): T {
  const store = openRunStore(runStorePath());
  try {
    return read(store);
  } finally {
    store.close();
  }
}

export function listRuns(): Promise<number> {
  const runs = withRunStore((store) => store.listRuns());
  if (runs.length === 0) {
    process.stdout.write("no runs are stored on this machine yet.\n");
    return Promise.resolve(exitCodes.acceptable);
  }
  for (const run of runs) {
    process.stdout.write(
      `${run.runId}  ${run.state.padEnd(12)} ${new Date(run.startedAt).toISOString()}  ${run.task}\n`,
    );
  }
  return Promise.resolve(exitCodes.acceptable);
}

export function inspectRun(options: InspectCommand): Promise<number> {
  const found = withRunStore((store) => ({
    run: store.run(options.runId),
    steps: store.steps(options.runId),
    leases: store.leases(options.runId),
    interrupted: store.run(options.runId) === null ? null : store.interrupted(options.runId),
    remainingTokens:
      store.run(options.runId) === null ? null : store.remainingTokens(options.runId),
  }));

  if (found.run === null) {
    process.stderr.write(`no run named ${options.runId} is stored here. Try swarm list-runs\n`);
    return Promise.resolve(exitCodes.invalidRequest);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ schema: "swarm.inspect.v1", ...found })}\n`);
    return Promise.resolve(exitCodes.acceptable);
  }

  process.stdout.write(
    `${found.run.runId}\n` +
      `  state:  ${found.run.state}\n` +
      `  task:   ${found.run.task}\n` +
      `  spec:   ${found.run.specDigest}\n` +
      `  tokens: ${found.remainingTokens === null ? "no budget set" : `${found.remainingTokens} left`}\n` +
      `  steps:  ${found.steps.length}\n`,
  );
  for (const step of found.steps) {
    process.stdout.write(
      `    ${step.state.padEnd(12)} ${step.stepId} (attempt ${step.attempt})${
        step.detail === null ? "" : `: ${step.detail}`
      }\n`,
    );
  }
  if ((found.interrupted?.steps.length ?? 0) > 0) {
    process.stdout.write(
      `\n${found.interrupted?.steps.length} step(s) were in flight when this run stopped, ` +
        `holding ${found.interrupted?.leases.length} lease(s). ` +
        `swarm repair ${options.runId} releases them; swarm resume ${options.runId} takes it up.\n`,
    );
  }
  return Promise.resolve(exitCodes.acceptable);
}

export async function resumeRun(
  options: ResumeCommand,
  execute?: (context: Awaited<ReturnType<typeof recoveryContext>>) => Promise<number>,
): Promise<number> {
  await repairRuntimeResources(defaultSessionRoot(homedir()), options.runId);
  const context = await recoveryContext(defaultSessionRoot(homedir()), options.runId);
  if (execute === undefined)
    throw new Error("resume requires an execution handler; no work was restarted");
  if (context.remainingTokens <= 0)
    throw new Error("the original token budget is exhausted; start a new authorized run");
  const outcome = withRunStore((store) => {
    const run = store.run(options.runId);
    if (run === null) {
      return null;
    }
    const repaired = store.repair(options.runId, Date.now());
    return { run, repaired, steps: store.steps(options.runId) };
  });

  if (outcome === null) {
    process.stderr.write(`no run named ${options.runId} is stored here. Try swarm list-runs\n`);
    return Promise.resolve(exitCodes.invalidRequest);
  }

  const owed = outcome.steps.filter(
    (step) => step.state === "interrupted" || step.state === "failed",
  );
  process.stdout.write(
    `${options.runId}: released ${outcome.repaired.releasedLeases} lease(s), ` +
      `reopened ${outcome.repaired.reopenedSteps} step(s).\n` +
      (owed.length === 0
        ? "no unfinished recorded steps; this does not establish task completion.\n"
        : `${owed.length} step(s) still owed: ${owed.map((step) => step.stepId).join(", ")}.\n` +
          "Continuing from the verified execution history.\n"),
  );
  return execute(context);
}

export function retryStep(
  options: RetryStepCommand,
  execute?: (context: Awaited<ReturnType<typeof recoveryContext>>) => Promise<number>,
): Promise<number> {
  const outcome = withRunStore((store) => {
    const step = store.steps(options.runId).find((one) => one.stepId === options.stepId);
    if (step === undefined) {
      return null;
    }
    if (step.state === "done") {
      return { step, restarted: false };
    }
    if (!["read", "list", "search"].includes(step.kind))
      throw new Error(
        `step ${step.stepId} may have an external effect; reconcile it before retrying`,
      );
    return { step, restarted: true };
  });

  if (outcome === null) {
    process.stderr.write(
      `run ${options.runId} has no step named ${options.stepId}. Try swarm inspect ${options.runId}\n`,
    );
    return Promise.resolve(exitCodes.invalidRequest);
  }
  process.stdout.write(
    outcome.restarted
      ? `${options.stepId} is eligible for retry; reconstructing the recorded execution.\n`
      : `${options.stepId} already completed, so it was not run again. Its result stands.\n`,
  );
  return outcome.restarted
    ? resumeRun({ command: "resume", runId: options.runId }, execute)
    : Promise.resolve(exitCodes.acceptable);
}

export function abortRun(options: AbortCommand): Promise<number> {
  const found = withRunStore((store) => {
    if (store.run(options.runId) === null) {
      return false;
    }
    store.abortRun(options.runId, "aborted from the command line", Date.now());
    return true;
  });
  if (!found) {
    process.stderr.write(`no run named ${options.runId} is stored here.\n`);
    return Promise.resolve(exitCodes.invalidRequest);
  }
  process.stdout.write(
    `${options.runId} has a recorded abort request. An active run observes it and stops its execution paths.\n`,
  );
  return Promise.resolve(exitCodes.acceptable);
}

export async function repairRun(options: RepairCommand): Promise<number> {
  await repairRuntimeResources(defaultSessionRoot(homedir()), options.runId);
  const repaired = withRunStore((store) =>
    store.run(options.runId) === null ? null : store.repair(options.runId, Date.now()),
  );
  if (repaired === null) {
    process.stderr.write(`no run named ${options.runId} is stored here.\n`);
    return Promise.resolve(exitCodes.invalidRequest);
  }
  process.stdout.write(
    `${options.runId}: released ${repaired.releasedLeases} lease(s), ` +
      `reopened ${repaired.reopenedSteps} step(s).\n`,
  );
  return Promise.resolve(exitCodes.acceptable);
}
