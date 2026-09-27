import type { Clock } from "./core/clock.ts";
import { asJsonValue, digestOfBytes } from "./evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "./evidence/goal-contract.ts";
import { recordGoalAssessment } from "./evidence/run-assessment.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { harnessChildEnvironment } from "./exec/child-environment.ts";
import type { ContainerBackendOptions } from "./exec/container-backend.ts";
import { recordedContainerBackend } from "./exec/runtime-resource.ts";
import type { GateDefinition } from "./gates/gate-definition.ts";
import { verifyIndependently } from "./gates/independent-verification.ts";
import { createNodeCommandRunner } from "./gates/node-command-runner.ts";
import { inspectionParser } from "./gates/parsers.ts";
import { diffAgainstBase } from "./gates/scratch-index.ts";

export interface TaskGoalContext {
  readonly contract: GoalContract;
  readonly workspace: string;
  readonly baseCommit: string;
  readonly evidence: EvidenceRecorder;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  readonly isolation: ContainerBackendOptions | null;
  readonly install: boolean;
}
async function check(context: TaskGoalContext, patch: string) {
  return verifyIndependently({
    repositoryRoot: context.workspace,
    checkoutRoot: context.evidence.directory,
    baseCommit: context.baseCommit,
    patch,
    commands: createNodeCommandRunner(
      context.clock,
      harnessChildEnvironment(),
      undefined,
      context.signal,
    ),
    clock: context.clock,
    signal: context.signal,
    goal: { contract: context.contract, evidence: context.evidence, tree: "" },
    installDependencies: context.install,
    commandsForCheckout: async (checkout) =>
      createNodeCommandRunner(
        context.clock,
        harnessChildEnvironment(),
        context.isolation === null
          ? undefined
          : recordedContainerBackend(
              { ...context.isolation, workspaceRoot: checkout },
              context.evidence,
            ),
        context.signal,
      ),
  });
}

/** Establish required base behavior before any implementation call can consume its budget. */
export async function preflightTaskGoal(context: TaskGoalContext): Promise<void> {
  const kind = context.contract.preset?.kind;
  if (kind !== "bugfix" && kind !== "refactor") return;
  const result = await check(context, "");
  await context.evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      rule: "preset-preflight-v1",
      sourceBase: context.baseCommit,
      ...result,
    }),
  });
  if (result.goalAcceptance?.presetControl?.accepted !== true)
    throw new Error(
      `${kind} base control was not established; repair the reproducer or prepared environment before model spending`,
    );
  if (result.unmeasured)
    throw new Error(
      `preset setup is unmeasured: ${result.advice || result.refusal}; prepare required tools before model spending`,
    );
}

/** Project exact final-source acceptance into the recorded worker assessment. */
export async function finalizeTaskGoal(context: TaskGoalContext) {
  const patch = await diffAgainstBase({
    workspaceRoot: context.workspace,
    baseRef: context.baseCommit,
  });
  const result = await check(context, patch);
  const record = await context.evidence.record({
    type: "independent-verification",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      ...result,
      sourcePatchDigest: digestOfBytes(patch),
      sourceBase: context.baseCommit,
    }),
  });
  return recordGoalAssessment(context.evidence, record.record.payloadDigest);
}

/** Feed captured behavior failures into the same bounded worker repair cycle. */
export function taskGoalGate(context: TaskGoalContext): GateDefinition {
  const digest = freezeGoalContract(context.contract).digest;
  return {
    id: "task-acceptance",
    title: `sealed goal ${digest}`,
    severity: "blocking",
    capability: "dynamic",
    parserName: "inspection",
    parse: inspectionParser,
    source: {
      kind: "inspection",
      inspect: async () => {
        const started = context.clock.now();
        const patch = await diffAgainstBase({
          workspaceRoot: context.workspace,
          baseRef: context.baseCommit,
        });
        const result = await check(context, patch);
        await context.evidence.record({
          type: "independent-verification",
          actor: "harness",
          provenance: ["tool-output"],
          payload: asJsonValue({
            ...result,
            sourcePatchDigest: digestOfBytes(patch),
            sourceBase: context.baseCommit,
          }),
        });
        const findings =
          result.goalAcceptance?.checkResults?.map(({ id, status, detail }) => ({
            id,
            status,
            detail,
          })) ?? [];
        const unavailable = result.unmeasured || result.task === "unjudged";
        return {
          exitCode: result.verified ? 0 : 1,
          unavailable: null,
          durationMs: context.clock.now() - started,
          stdout: JSON.stringify({ regression: result.regression, task: result.task, findings }),
          stderr: unavailable
            ? `setup unavailable: ${result.advice || result.refusal || "required acceptance instrument is unmeasured"}`
            : "",
        };
      },
    },
  };
}
