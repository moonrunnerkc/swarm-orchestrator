import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Clock } from "../core/clock.ts";
import { runAgentLoop } from "../core/loop.ts";
import type { ModelClient, ModelRequest, ModelResponse } from "../core/model-client.ts";
import type { RandomSource } from "../core/random-source.ts";
import type { StopReason } from "../core/termination.ts";
import { createRecordingModelClient } from "../evidence/model-call-recording.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { GateCommandRunner } from "../gates/gate-definition.ts";
import { createToolChokepoint } from "../tools/chokepoint.ts";
import { createLedgerChokepointRecorder } from "../tools/chokepoint-record.ts";
import { createSandbox, defaultShellAllowlist } from "../tools/sandbox.ts";
import { createWorkspaceTools } from "../tools/workspace-tools.ts";
import type { CalibrationCase } from "./calibration-case.ts";
import { caseDigest } from "./calibration-case.ts";
import {
  type ModelCallTally,
  payloadsSince,
  type ToolCallTally,
  type TurnContentTally,
  tallyModelCalls,
  tallyToolCalls,
  tallyTurnContent,
} from "./calibration-measures.ts";

/** Resident bytes of whatever is serving the model, or null when nothing reports it. */
export type MemoryProbe = () => Promise<number | null>;

export interface CalibrationRepeatObservation {
  readonly caseId: string;
  readonly caseDigest: string;
  readonly taskClass: CalibrationCase["taskClass"];
  readonly model: string;
  readonly repeat: number;
  /** Left in place for the caller to clear, so a failed repeat can be looked at. */
  readonly workspace: string;
  readonly stopReason: StopReason;
  readonly steps: number;
  /**
   * Whether the model ever answered. A repeat whose every dispatch failed produced no
   * measurement of the model, only of the backend refusing it, so it is absence of evidence
   * and is filtered out of every dimension rather than folded in as a zero.
   */
  readonly executed: boolean;
  /** Why the repeat measured nothing, or null when it measured something. */
  readonly abstention: RepeatAbstention | null;
  readonly gateExitCode: number;
  readonly gatePassed: boolean;
  readonly toolCalls: ToolCallTally;
  readonly modelCalls: ModelCallTally;
  readonly peakMemoryBytes: number | null;
  /** The record these numbers were written to, which the summary's claim cites. */
  readonly record: string;
}

/**
 * A repeat that is not evidence about the model, and which of the two ways it got there. A
 * reason code rather than a sentence, because the summary and the report both branch on it and
 * a reader downstream should never have to parse prose to know a run measured nothing.
 */
export interface RepeatAbstention {
  readonly reason: "no-turn-recorded" | "every-turn-empty";
  readonly turns: number;
  readonly emptyTurns: number;
  /** Turns whose record carried no harness reading, which are not evidence of an answer. */
  readonly unreadTurns: number;
  readonly emptyReasons: Readonly<Record<string, number>>;
}

export interface CalibrationRunDependencies {
  readonly evidence: EvidenceRecorder;
  readonly clock: Clock;
  readonly random: RandomSource;
  /** A fresh client per repeat: a client that carries state across repeats is not repeating. */
  readonly createModel: (modelSpec: string) => ModelClient;
  readonly commands: GateCommandRunner;
  readonly probeMemory: MemoryProbe;
  /** Parent of the per-repeat scratch workspaces. */
  readonly scratchRoot: string;
  readonly maxSteps: number;
  readonly abortSignal: AbortSignal;
}

interface CalibrationRepeatRequest {
  readonly case: CalibrationCase;
  readonly modelSpec: string;
  readonly repeat: number;
}

const calibrationSystemPrompt = [
  "You are a coding agent working inside one small workspace directory.",
  "Use the tools to read what is there and change it. Read before you edit.",
  "Make the smallest change that satisfies the task, and do not weaken any test to do it.",
  "When the work is done, reply with a short summary and no tool calls.",
].join(" ");

const gateTimeoutMs = 120_000;

/**
 * Pinned on the wire rather than left to the backend, so the report can say what the
 * distribution was drawn under. Decoding stays stochastic on purpose: calibration is
 * measuring a spread, and a temperature of zero would measure one point and call it a model.
 */
export const calibrationSampling = { temperature: 0.7, topP: 0.95 } as const;

/**
 * A seed per repeat, derived from the case, the model and the repeat number, so the seeds a
 * run used are re-derivable from the report rather than lost with the process. Distinct per
 * repeat by construction: the same seed three times would be one sample recorded three ways.
 */
export function seedForRepeat(caseId: string, modelSpec: string, repeat: number): number {
  let hash = 2_166_136_261;
  for (const character of `${caseId}::${modelSpec}::${repeat}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * One case, one model, once. Everything it reports is counted off the records the run itself
 * produced, so a reviewer holding the bundle can re-derive every number rather than taking
 * the summary's word for it (section 3.9).
 */
export async function runCalibrationRepeat(
  request: CalibrationRepeatRequest,
  deps: CalibrationRunDependencies,
): Promise<CalibrationRepeatObservation> {
  const workspace = join(
    deps.scratchRoot,
    `${request.case.id}--${slug(request.modelSpec)}--${request.repeat}`,
  );
  await seedWorkspace(workspace, request.case);

  const sandbox = createSandbox({
    workspaceRoot: workspace,
    homeDir: workspace,
    shellAllowlist: defaultShellAllowlist,
    deniedRoots: [],
  });
  const definitions = createWorkspaceTools(sandbox);
  const peak = { bytes: null as number | null };

  const model = createRecordingModelClient(
    sampleMemoryAround(deps.createModel(request.modelSpec), deps.probeMemory, peak),
    deps.evidence,
  );

  const fromIndex = deps.evidence.records().length;

  const outcome = await runAgentLoop(request.case.prompt, {
    model,
    toolInvoker: createToolChokepoint({
      definitions,
      sandbox,
      // Nothing to ask: calibration is unattended, so a call needing a human is refused and
      // counted, which is itself a fact about the model.
      confirm: () => Promise.resolve(false),
      recorder: createLedgerChokepointRecorder(deps.evidence),
    }),
    toolSchemas: definitions,
    clock: deps.clock,
    random: deps.random,
    emit: () => {},
    budget: { maxSteps: deps.maxSteps, maxTokens: 250_000, maxWallTimeMs: 5 * 60 * 1000 },
    abortSignal: deps.abortSignal,
    systemPrompt: calibrationSystemPrompt,
    maxOutputTokens: 4096,
    sampling: {
      ...calibrationSampling,
      seed: seedForRepeat(request.case.id, request.modelSpec, request.repeat),
    },
    retryPolicy: { attempts: 2, baseDelayMs: 250, maxJitterRatio: 0.5 },
  });

  const gate = await deps.commands.run(request.case.gateCommand, {
    cwd: workspace,
    timeoutMs: gateTimeoutMs,
  });

  const produced = payloadsSince(deps.evidence, fromIndex);
  const toolCalls = tallyToolCalls(produced);
  const modelCalls = tallyModelCalls(produced);
  // Answered rather than dispatched: a runtime can return a turn carrying nothing, and a
  // repeat made only of those measured the runtime, not the model. Counted off the turn
  // readings in the records rather than off the loop's own tally, so what makes a repeat
  // executed is the same thing a reviewer holding the bundle can recount.
  const turns = tallyTurnContent(produced);
  const executed = turns.answered > 0;
  const abstention = executed ? null : abstentionFor(turns);

  const recorded = await deps.evidence.record({
    type: "calibration-run",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      caseId: request.case.id,
      caseDigest: caseDigest(request.case),
      taskClass: request.case.taskClass,
      model: request.modelSpec,
      repeat: request.repeat,
      stopReason: outcome.stopReason,
      steps: outcome.steps,
      answeredSteps: outcome.answeredSteps,
      turnsRecorded: turns.turns,
      turnsAnswered: turns.answered,
      turnsEmpty: turns.empty,
      turnsUnread: turns.unread,
      executed,
      // Null when the repeat measured something. Present, with a code, when it did not, so
      // an abstention is in the bundle rather than only in the shape of a missing number.
      abstention:
        abstention === null
          ? null
          : {
              reason: abstention.reason,
              turns: abstention.turns,
              emptyTurns: abstention.emptyTurns,
              unreadTurns: abstention.unreadTurns,
              emptyReasons: { ...abstention.emptyReasons },
            },
      gateCommand: request.case.gateCommand,
      gateExitCode: gate.exitCode,
      gatePassed: gate.exitCode === 0,
      toolCallsAttempted: toolCalls.attempted,
      toolCallsMalformed: toolCalls.malformed,
      toolCallValidity: toolCalls.validityRate,
      writesAttempted: toolCalls.writesAttempted,
      writesApplied: toolCalls.writesApplied,
      patchApply: toolCalls.applyRate,
      modelCalls: modelCalls.calls,
      outputTokens: modelCalls.outputTokens,
      responseTimeMs: modelCalls.responseTimeMs,
      tokensPerSecond: modelCalls.tokensPerSecond,
      firstTokenMs: modelCalls.firstTokenMs,
      peakMemoryBytes: peak.bytes,
    },
  });

  return {
    caseId: request.case.id,
    caseDigest: caseDigest(request.case),
    taskClass: request.case.taskClass,
    model: request.modelSpec,
    repeat: request.repeat,
    workspace,
    stopReason: outcome.stopReason,
    steps: outcome.steps,
    executed,
    abstention,
    gateExitCode: gate.exitCode,
    gatePassed: gate.exitCode === 0,
    toolCalls,
    modelCalls,
    peakMemoryBytes: peak.bytes,
    record: recorded.record.payloadDigest,
  };
}

/**
 * No turn at all and every turn empty are different failures with different owners: the first
 * is a dispatch that never happened, and the second is a backend or a pairing answering with
 * nothing. Both are abstentions, and saying which is the point of the code.
 */
function abstentionFor(turns: TurnContentTally): RepeatAbstention {
  return {
    reason: turns.turns === 0 ? "no-turn-recorded" : "every-turn-empty",
    turns: turns.turns,
    emptyTurns: turns.empty,
    unreadTurns: turns.unread,
    emptyReasons: turns.emptyReasons,
  };
}

async function seedWorkspace(workspace: string, one: CalibrationCase): Promise<void> {
  await mkdir(workspace, { recursive: true });
  for (const [path, contents] of Object.entries(one.seed)) {
    const absolute = resolve(workspace, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  }
}

/**
 * Samples around every model call rather than on a timer: the runtime holds the model resident
 * while it is generating, which is when the number is worth having, and a timer would need a
 * second clock the rest of the run does not have.
 */
function sampleMemoryAround(
  model: ModelClient,
  probeMemory: MemoryProbe,
  peak: { bytes: number | null },
): ModelClient {
  return {
    modelId: model.modelId,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const response = await model.generate(request);
      const reading = await probeMemory();
      if (reading !== null && (peak.bytes === null || reading > peak.bytes)) {
        peak.bytes = reading;
      }
      return response;
    },
  };
}

/** Model ids carry colons and slashes; a directory name may not. */
function slug(modelSpec: string): string {
  return modelSpec.replace(/[^A-Za-z0-9._-]+/g, "-");
}
