import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { asJsonValue } from "../evidence/canonical-json.ts";
import type { GoalContract } from "../evidence/goal-contract.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import {
  type IndependentVerification,
  verifyIndependently,
} from "../gates/independent-verification.ts";
import { createNodeCommandRunner } from "../gates/node-command-runner.ts";
import { parseUnifiedDiff } from "../gates/unified-diff.ts";
import { controllerEvents } from "./controller-events.ts";
import { recordTransition } from "./controller-state.ts";
import { type GoalCandidate, type GoalSelection, selectGoalCandidate } from "./goal-selection.ts";
import type { ParallelRunOptions, WorkerResult } from "./parallel-run.ts";

const execute = promisify(execFile);

/** Every eligible alternative is checked in a fresh verifier workspace before its cost can matter. */
export async function verifyGoalCandidates(
  workers: readonly WorkerResult[],
  options: ParallelRunOptions & { goalContract: GoalContract },
): Promise<GoalSelection> {
  const candidates: GoalCandidate[] = [];
  for (const worker of workers) {
    options.abortSignal.throwIfAborted();
    const git = async (args: readonly string[]) =>
      (
        await execute("git", [...args], {
          cwd: options.repositoryRoot,
          env: harnessChildEnvironment().variables,
          signal: options.abortSignal,
          timeout: 30000,
          maxBuffer: 64000000,
        })
      ).stdout;
    let verification: IndependentVerification | null = null;
    let verificationRecord: string | null = null;
    let changedLines = 0;
    if (worker.green && worker.commit !== null) {
      const tree = (await git(["rev-parse", `${worker.commit}^{tree}`])).trim();
      const patch = await git(["diff", "--binary", worker.baseCommit, worker.commit]);
      changedLines = parseUnifiedDiff(patch).reduce(
        (sum, file) => sum + file.addedLines.length + file.removedLines.length,
        0,
      );
      verification = await verifyIndependently({
        repositoryRoot: options.repositoryRoot,
        baseCommit: worker.baseCommit,
        patch,
        immutablePaths: options.immutablePaths ?? [],
        clock: options.clock,
        timeoutMs: Math.min(120000, options.remainingWallMs?.() ?? 120000),
        commands: createNodeCommandRunner(
          options.clock,
          harnessChildEnvironment(),
          undefined,
          options.abortSignal,
          options.runContext?.tests,
        ),
        ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
        ...(options.isolation === undefined
          ? {}
          : {
              commandsForCheckout: async (checkout: string) =>
                createNodeCommandRunner(
                  options.clock,
                  harnessChildEnvironment(),
                  options.isolation?.(checkout),
                  options.abortSignal,
                  options.runContext?.tests,
                ),
            }),
        goal: { contract: options.goalContract, evidence: options.coordinator, tree },
      });
      const captured = await options.coordinator.record({
        type: "goal-candidate-verification",
        actor: "harness",
        provenance: ["tool-output"],
        payload: asJsonValue({
          workerId: worker.workerId,
          baseCommit: worker.baseCommit,
          tree,
          changedFiles: worker.changedFiles,
          changedLines,
          verification,
        }),
      });
      verificationRecord = captured.record.payloadDigest;
      if (
        !verification.verified ||
        verification.checks.some((check) => check.status === "failed")
      ) {
        const requirements =
          verification.goalAcceptance?.obligations
            .filter((obligation) => obligation.status !== "accepted")
            .map((obligation) => `${obligation.id}: ${obligation.status}`) ?? [];
        const failures = verification.checks
          .filter((check) => check.status === "failed")
          .map((check) => `${check.id}: ${check.detail}`);
        await recordTransition(options.coordinator, {
          kind: "candidate-refused",
          workerId: worker.workerId,
          observation: verificationRecord,
          reason: `whole-goal acceptance refused: ${[verification.refusal, ...requirements, ...failures, verification.advice].filter(Boolean).join("; ")}`,
        });
      }
    }
    const events = controllerEvents(options.coordinator);
    const calls = events.filter(
      (event) => event.kind === "usage-reserved" && event.activity === worker.workerId,
    );
    let tokenCount: number | null = calls.length === 0 ? null : 0;
    for (const call of calls) {
      if (call.kind !== "usage-reserved") continue;
      const settled = events.find(
        (event) => event.kind === "usage-settled" && event.id === call.id,
      );
      if (
        settled?.kind !== "usage-settled" ||
        settled.status !== "reported" ||
        settled.inputTokens === null ||
        settled.outputTokens === null
      ) {
        tokenCount = null;
        break;
      }
      tokenCount = (tokenCount ?? 0) + settled.inputTokens + settled.outputTokens;
    }
    candidates.push({
      workerId: worker.workerId,
      baseCommit: worker.baseCommit,
      attemptIndex: worker.attemptIndex,
      regressionPassed:
        worker.green &&
        verification?.regression === "pass" &&
        !verification.checks.some((check) => check.status === "failed"),
      obligations:
        verification?.goalAcceptance?.obligations.map((obligation) => ({
          id: obligation.id,
          accepted: obligation.status === "accepted",
        })) ?? [],
      tokenCount,
      changedFiles: worker.changedFiles,
      changedLines,
      verification: verificationRecord,
    });
  }
  const selection = selectGoalCandidate(
    workers[0]?.taskId ?? "goal",
    options.goalContract,
    candidates,
  );
  await options.coordinator.record({
    type: "goal-attempt-selection",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue(selection),
  });
  return selection;
}
