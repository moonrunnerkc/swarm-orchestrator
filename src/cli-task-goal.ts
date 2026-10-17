import type { Clock } from "./core/clock.ts";
import { asJsonValue, digestOfBytes } from "./evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "./evidence/goal-contract.ts";
import { recordGoalAssessment } from "./evidence/run-assessment.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { harnessChildEnvironment } from "./exec/child-environment.ts";
import type { ContainerBackendOptions } from "./exec/container-backend.ts";
import { recordedContainerBackend } from "./exec/runtime-resource.ts";
import type { GateSetOptions } from "./gates/default-gates.ts";
import type { GateDefinition, GateOverride } from "./gates/gate-definition.ts";
import type { ChallengePolicy } from "./gates/goal-challenges.ts";
import {
  type IndependentVerification,
  refusedVerification,
  verifyIndependently,
} from "./gates/independent-verification.ts";
import { createNodeCommandRunner } from "./gates/node-command-runner.ts";
import { inspectionParser } from "./gates/parsers.ts";
import { diffAgainstBase, patchAgainstBase } from "./gates/scratch-index.ts";
import { VerificationRefusalError } from "./gates/verification-refusal.ts";

export interface TaskGoalContext {
  readonly contract: GoalContract;
  readonly workspace: string;
  readonly baseCommit: string;
  readonly evidence: EvidenceRecorder;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  readonly isolation: ContainerBackendOptions | null;
  readonly install: boolean;
  /** The lockfile setup installs from where the checkout holds several. */
  readonly lockfile?: string;
  /**
   * The gate commands the run was configured with (swarm.toml `[gates]`), so the fresh checkout
   * judges the candidate by the gates the run sealed. Without them the verifier assembled its
   * own gates from the checkout's manifest, and a run whose sealed `tests` gate was the
   * project's node suite was refused on the browser suite its manifest's `test` script runs:
   * the checkout had no swarm.toml, the workspace's being untracked, and nothing else carried
   * the override across.
   */
  readonly commandOverrides?: Readonly<Record<string, GateOverride>>;
  /** How the requirement checks are challenged; absent is off. */
  readonly challengePolicy?: ChallengePolicy;
}

/** The gate options the verification shares with the run: its lockfile and its command overrides. */
function verificationGateOptions(context: TaskGoalContext): GateSetOptions | undefined {
  const options: GateSetOptions = {
    ...(context.lockfile === undefined ? {} : { lockfile: context.lockfile }),
    ...(context.commandOverrides === undefined || Object.keys(context.commandOverrides).length === 0
      ? {}
      : { commandOverrides: context.commandOverrides }),
  };
  return Object.keys(options).length === 0 ? undefined : options;
}
async function check(
  context: TaskGoalContext,
  patch: string,
  override?: {
    readonly contract: GoalContract;
    readonly challengePolicy: ChallengePolicy;
    readonly repositoryChecks?: "skip";
  },
): Promise<IndependentVerification> {
  try {
    return await verify(context, patch, override);
  } catch (cause) {
    // A policy decision against the change, named, is a result the gate feeds back and the
    // final assessment records; thrown through, it ended the run with no verdict at all.
    if (cause instanceof VerificationRefusalError) return refusedVerification(cause.message);
    throw cause;
  }
}

async function verify(
  context: TaskGoalContext,
  patch: string,
  override?: {
    readonly contract: GoalContract;
    readonly challengePolicy: ChallengePolicy;
    readonly repositoryChecks?: "skip";
  },
) {
  const gateOptions = verificationGateOptions(context);
  return verifyIndependently({
    repositoryRoot: context.workspace,
    // Shared with a container runtime where there is one; on the host, the system temporary
    // directory, outside any hidden path (see checkoutRoot).
    ...(context.isolation === null ? {} : { checkoutRoot: context.evidence.directory }),
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
    goal: {
      contract: override?.contract ?? context.contract,
      evidence: context.evidence,
      tree: "",
      challengePolicy: override?.challengePolicy ?? context.challengePolicy ?? "off",
    },
    ...(override?.repositoryChecks === undefined
      ? {}
      : { repositoryChecks: override.repositoryChecks }),
    installDependencies: context.install,
    ...(gateOptions === undefined ? {} : { gateOptions }),
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

/**
 * Establish the acceptance instrument on the base before any implementation call can consume
 * its budget: a bugfix or refactor needs its base control, and every contract needs checks
 * that can run here at all. A check whose toolchain is missing, or a fresh checkout that cannot
 * be prepared, is found now, with the remedy named, rather than after the model has spent the
 * interesting part of the budget. Upgrades are excluded: their checks assert the installed
 * version, which the base cannot have, and their authorization is enforced per candidate.
 */
export async function preflightTaskGoal(context: TaskGoalContext): Promise<void> {
  const kind = context.contract.preset?.kind;
  if (kind === "upgrade") return;
  const result = await check(context, "", { contract: context.contract, challengePolicy: "off" });
  const cannotRun = (result.goalAcceptance?.checkResults ?? []).filter(
    (check) => check.status === "unjudged",
  );
  const passesOnBase = (result.goalAcceptance?.checkResults ?? [])
    .filter((check) => check.status === "accepted")
    .map((check) => check.id);
  await context.evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      rule: kind === undefined ? "goal-preflight-v1" : "preset-preflight-v1",
      sourceBase: context.baseCommit,
      ...(kind === undefined
        ? { cannotRun: cannotRun.map((check) => check.id), passesOnBase }
        : {}),
      ...result,
    }),
  });
  if (result.refusal !== null)
    throw new Error(
      `the acceptance checks cannot be established on the base: ${result.refusal}; repair the prepared environment before model spending`,
    );
  if (
    (kind === "bugfix" || kind === "refactor") &&
    result.goalAcceptance?.presetControl?.accepted !== true
  )
    throw new Error(
      `${kind} base control was not established; repair the reproducer or prepared environment before model spending`,
    );
  if (result.unmeasured)
    throw new Error(
      `${kind ?? "goal"} setup is unmeasured: ${result.advice || result.refusal}; prepare required tools before model spending`,
    );
  if (kind === undefined && cannotRun.length > 0)
    throw new Error(
      `acceptance check(s) cannot run here: ${cannotRun.map((check) => `${check.id} (${check.detail.split("\n")[0]})`).join("; ")}; prepare the tools they need before model spending`,
    );
}

/** What a goal preflight observed on the base, for the terminal: which checks already pass there. */
export function describeGoalPreflight(evidence: EvidenceRecorder): readonly string[] {
  const record = evidence
    .records()
    .findLast(
      (entry) =>
        entry.type === "verification-command" &&
        (evidence.payloads().get(entry.payloadDigest) as { rule?: string } | undefined)?.rule ===
          "goal-preflight-v1",
    );
  const payload = evidence.payloads().get(record?.payloadDigest ?? "") as
    | { passesOnBase?: string[] }
    | undefined;
  if (payload === undefined) return [];
  return payload.passesOnBase === undefined || payload.passesOnBase.length === 0
    ? ["preflight: every sealed check fails on the base, so a pass will mean the change did it"]
    : [
        `preflight: ${payload.passesOnBase.join(", ")} already pass on the base; a pass there is not evidence the change did anything`,
      ];
}

/** Project exact final-source acceptance into the recorded worker assessment. */
export async function finalizeTaskGoal(context: TaskGoalContext) {
  const patch = await patchAgainstBase({
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
      // The source as the worker's own diff record names it (zero-context), beside the digest of
      // the full-context patch the fresh checkout applied: two readings of one working tree.
      sourcePatchDigest: digestOfBytes(
        await diffAgainstBase({ workspaceRoot: context.workspace, baseRef: context.baseCommit }),
      ),
      appliedPatchDigest: digestOfBytes(patch),
      sourceBase: context.baseCommit,
    }),
  });
  return recordGoalAssessment(context.evidence, record.record.payloadDigest);
}

/** The candidate as it stands, judged under a contract with its checks challenged, and recorded. */
export async function verifyCandidateUnder(
  context: TaskGoalContext,
  contract: GoalContract,
  challengePolicy: ChallengePolicy,
) {
  const patch = await patchAgainstBase({
    workspaceRoot: context.workspace,
    baseRef: context.baseCommit,
  });
  const result = await check(context, patch, { contract, challengePolicy });
  await context.evidence.record({
    type: "independent-verification",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      ...result,
      // The source as the worker's own diff record names it (zero-context), beside the digest of
      // the full-context patch the fresh checkout applied: two readings of one working tree.
      sourcePatchDigest: digestOfBytes(
        await diffAgainstBase({ workspaceRoot: context.workspace, baseRef: context.baseCommit }),
      ),
      appliedPatchDigest: digestOfBytes(patch),
      sourceBase: context.baseCommit,
    }),
  });
  return result;
}

/**
 * A contract's checks on a fresh checkout of the unchanged base, after the repository's own
 * checks, exactly as the acceptance gate and the final verification run them. A planned check is
 * admitted by this, not by a probe that skips the build: one that imports the project's built
 * output could not run under the probe and would have run under acceptance.
 */
export function baseVerifier(context: TaskGoalContext) {
  return async (contract: GoalContract) =>
    (await check(context, "", { contract, challengePolicy: "off" })).goalAcceptance;
}

/** One admission probe: a patch on a fresh checkout of the base, only the probe contract judged. */
export function probeVerifier(context: TaskGoalContext) {
  return async (patch: string, contract: GoalContract) =>
    (await check(context, patch, { contract, challengePolicy: "off", repositoryChecks: "skip" }))
      .goalAcceptance;
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
        const patch = await patchAgainstBase({
          workspaceRoot: context.workspace,
          baseRef: context.baseCommit,
        });
        // The acceptance gate the agent iterates against judges the checks; challenging them is
        // the final verification's, and the strengthening loop's, not every attempt's.
        const result = await check(context, patch, {
          contract: context.contract,
          challengePolicy: "off",
        });
        await context.evidence.record({
          type: "independent-verification",
          actor: "harness",
          provenance: ["tool-output"],
          payload: asJsonValue({
            ...result,
            // The source as the worker's own diff record names it (zero-context), beside the digest of
            // the full-context patch the fresh checkout applied: two readings of one working tree.
            sourcePatchDigest: digestOfBytes(
              await diffAgainstBase({
                workspaceRoot: context.workspace,
                baseRef: context.baseCommit,
              }),
            ),
            appliedPatchDigest: digestOfBytes(patch),
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
        // A refusal is a decision against the change and reads as one; an unmeasured setup is
        // something to prepare. The repair feedback is this text, so the two must not be confused.
        // The findings again as plain lines: inside the JSON above, a check's detail reaches the
        // repair brief escaped, and a worker reads the line it got wrong more easily here.
        const failed = findings
          .filter((finding) => finding.status !== "accepted")
          .map((finding) => `check ${finding.id} ${finding.status}: ${finding.detail}`);
        const stderr =
          result.refusal !== null && !result.unmeasured
            ? `refused: ${result.refusal}`
            : unavailable
              ? `setup unavailable: ${result.advice || result.refusal || "required acceptance instrument is unmeasured"}`
              : failed.join("\n");
        return {
          exitCode: result.verified ? 0 : 1,
          unavailable: null,
          durationMs: context.clock.now() - started,
          stdout: JSON.stringify({ regression: result.regression, task: result.task, findings }),
          stderr,
        };
      },
    },
  };
}
