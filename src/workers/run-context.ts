import { z } from "zod";
import type { Clock } from "../core/clock.ts";
import { withModelCancellation } from "../core/model-cancellation.ts";
import type { ModelClient } from "../core/model-client.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { createResourcePool, type ResourcePool } from "../exec/resource-pool.ts";
import { controllerEvents, recordControllerEvent } from "./controller-events.ts";

export interface RunContext {
  readonly signal: AbortSignal;
  readonly tests: ResourcePool;
  remainingWallMs(): number;
  accounting(): { spent: number; reserved: number; unknownCalls: number; remaining: number };
  model(activity: string, client: ModelClient): ModelClient;
  stop(reason: string): Promise<void>;
  dispose(): void;
}

/** Reopening spends the original ceiling; unresolved usage cannot become free retries. */
export async function createRunContext(options: {
  evidence: EvidenceRecorder;
  clock: Clock;
  runId: string;
  maxTokens: number;
  maxWallMs: number;
  modelConcurrency: number;
  testConcurrency: number;
  signal: AbortSignal;
}): Promise<RunContext> {
  const events = controllerEvents(options.evidence);
  const starts = events.filter((event) => event.kind === "run-started");
  if (starts.length > 1)
    throw new Error("controller has multiple run declarations; preserve history and reconcile");
  const declared = starts[0] ?? {
    kind: "run-started" as const,
    version: 1 as const,
    runId: options.runId,
    startedAt: options.clock.now(),
    deadlineAt: options.clock.now() + options.maxWallMs,
    maxTokens: options.maxTokens,
    modelConcurrency: options.modelConcurrency,
    testConcurrency: options.testConcurrency,
  };
  if (
    declared.runId !== options.runId ||
    declared.maxTokens !== options.maxTokens ||
    declared.modelConcurrency !== options.modelConcurrency ||
    declared.testConcurrency !== options.testConcurrency
  ) {
    throw new Error("resume must preserve the original controller budget and resource policy");
  }
  if (starts.length === 0) await recordControllerEvent(options.evidence, declared);
  const reservations = new Map<string, { allowance: number; unknown: boolean }>();
  const reservedIds = new Set<string>();
  const settledIds = new Set<string>();
  let spent = 0;
  let sequence = 0;
  for (const event of events) {
    if (event.kind === "usage-reserved") {
      if (reservedIds.has(event.id))
        throw new Error(`duplicate usage reservation ${event.id}; reconcile history`);
      reservedIds.add(event.id);
      reservations.set(event.id, {
        allowance: event.inputAllowance + event.outputAllowance,
        unknown: false,
      });
      sequence += 1;
    }
    if (event.kind === "usage-settled") {
      if (settledIds.has(event.id))
        throw new Error(`duplicate settlement ${event.id}; reconcile history`);
      settledIds.add(event.id);
      const reserved = reservations.get(event.id);
      if (reserved === undefined)
        throw new Error(`settlement without reservation ${event.id}; reconcile history`);
      if (event.status === "unknown") reserved.unknown = true;
      else {
        if (event.inputTokens === null || event.outputTokens === null)
          throw new Error(`reported usage missing for ${event.id}`);
        spent += event.inputTokens + event.outputTokens;
        reservations.delete(event.id);
      }
    }
  }
  const cancellation = new AbortController();
  const deadlineRelease = new AbortController();
  const signal = AbortSignal.any([options.signal, cancellation.signal]);
  const remainingWallMs = () => Math.max(0, declared.deadlineAt - options.clock.now());
  const models = createResourcePool(declared.modelConcurrency);
  const tests = createResourcePool(declared.testConcurrency);
  const accounting = () => {
    const pending = [...reservations.values()];
    const reserved = pending.reduce((sum, reservation) => sum + reservation.allowance, 0);
    return {
      spent,
      reserved,
      unknownCalls: pending.filter((reservation) => reservation.unknown).length,
      remaining: Math.max(0, declared.maxTokens - spent - reserved),
    };
  };
  const record = async (event: Parameters<typeof recordControllerEvent>[1]) => {
    try {
      await recordControllerEvent(options.evidence, event);
    } catch (cause) {
      cancellation.abort(cause);
      throw cause;
    }
  };
  const stop = async (reason: string) => {
    if (cancellation.signal.aborted) return;
    cancellation.abort(new Error(reason));
    await record({ kind: "stop-requested", reason });
  };
  if (reservations.size > 0)
    throw new Error(
      "unresolved provider usage requires reconciliation before resuming; original reservations retained",
    );
  // Deadline cancellation is immediate; its durable terminal observation is awaited by the controller.
  void options.clock.sleep(remainingWallMs(), deadlineRelease.signal, "deadline").then(() => {
    if (!deadlineRelease.signal.aborted)
      cancellation.abort(new Error("shared wall budget exhausted"));
  });
  return {
    signal,
    tests,
    accounting,
    remainingWallMs,
    stop,
    dispose: () => deadlineRelease.abort(),
    model(activity, client) {
      return {
        modelId: client.modelId,
        recordsCancellation: true,
        generate: (request) =>
          models.run(
            async () => {
              signal.throwIfAborted();
              const callSignal = AbortSignal.any([signal, request.abortSignal]);
              callSignal.throwIfAborted();
              if (remainingWallMs() <= 0) {
                await stop("shared wall budget exhausted");
                signal.throwIfAborted();
              }
              const inputAllowance =
                Buffer.byteLength(
                  JSON.stringify({
                    system: request.system,
                    messages: request.messages,
                    tools: request.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      schema: z.toJSONSchema(tool.inputSchema),
                    })),
                  }),
                ) +
                256 * (request.messages.length + request.tools.length + 1);
              const outputAllowance = Math.min(
                request.maxOutputTokens,
                accounting().remaining - inputAllowance,
              );
              if (outputAllowance < 1) {
                await stop("shared token budget cannot reserve the input and output allowance");
                signal.throwIfAborted();
              }
              const id = `model-${++sequence}`;
              reservations.set(id, { allowance: inputAllowance + outputAllowance, unknown: false });
              await record({
                kind: "usage-reserved",
                id,
                activity,
                inputAllowance,
                outputAllowance,
                estimator: "utf8-bytes-plus-framing",
              });
              let response: Awaited<ReturnType<ModelClient["generate"]>>;
              try {
                const pending = client.generate({
                  ...request,
                  maxOutputTokens: outputAllowance,
                  abortSignal: callSignal,
                });
                response =
                  client.recordsCancellation === true
                    ? await pending
                    : await withModelCancellation(pending, callSignal);
              } catch (cause) {
                reservations.set(id, {
                  allowance: inputAllowance + outputAllowance,
                  unknown: true,
                });
                await record({
                  kind: "usage-settled",
                  id,
                  status: "unknown",
                  inputTokens: null,
                  outputTokens: null,
                  detail: "provider call failed or was interrupted; billed usage is unknown",
                });
                await stop("unknown provider usage; reconciliation is required");
                throw cause;
              }
              const unknown =
                response.usageStatus === "unknown" ||
                response.providerAttempts?.some((attempt) => attempt.usage === "unknown");
              await record({
                kind: "usage-settled",
                id,
                status: unknown ? "unknown" : "reported",
                inputTokens: unknown ? null : response.inputTokens,
                outputTokens: unknown ? null : response.outputTokens,
                detail: unknown
                  ? "provider did not report complete usage"
                  : "provider-reported usage settled",
              });
              if (unknown) {
                reservations.set(id, {
                  allowance: inputAllowance + outputAllowance,
                  unknown: true,
                });
                await stop("unknown provider usage; reconciliation is required");
              } else {
                reservations.delete(id);
                spent += response.inputTokens + response.outputTokens;
                if (spent >= declared.maxTokens) await stop("shared token budget exhausted");
              }
              return response;
            },
            AbortSignal.any([signal, request.abortSignal]),
          ),
      };
    },
  };
}
