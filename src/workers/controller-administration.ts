import type { Clock } from "../core/clock.ts";
import { openRunStore } from "../durable/run-store.ts";
import { asJsonValue, digestOfJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { controllerEvents } from "./controller-events.ts";

/** Administrative state is a projection; accepted work and usage authority remain on the checked chain. */
export function controllerAdministration(options: {
  evidence: EvidenceRecorder;
  path: string;
  runId: string;
  objective: string;
  clock: Clock;
  maxTokens: number;
}) {
  const store = openRunStore(options.path);
  const start = controllerEvents(options.evidence).find((event) => event.kind === "run-started");
  if (start === undefined)
    throw new Error("administration requires the original controller budget declaration");
  store.startRun({
    runId: options.runId,
    specDigest: digestOfJson(asJsonValue(start)),
    task: options.objective,
    startedAt: start.startedAt,
  });
  store.setBudget({ runId: options.runId, tokens: options.maxTokens });
  let consumed = 0;
  const synchronize = () => {
    for (const event of controllerEvents(options.evidence).slice(consumed)) {
      if (event.kind === "usage-reserved") {
        const existing = store.steps(options.runId).find((step) => step.stepId === event.id);
        if (existing === undefined) {
          if (
            !store.reserve({
              runId: options.runId,
              stepId: event.id,
              tokens: event.inputAllowance + event.outputAllowance,
            })
          )
            throw new Error(
              "administrative reservation differs from the controller budget; reconcile before dispatch",
            );
          store.beginStep({
            runId: options.runId,
            stepId: event.id,
            kind: event.activity,
            idempotencyKey: digestOfJson(asJsonValue(event)),
            at: options.clock.now(),
          });
        }
      }
      if (event.kind === "usage-settled") {
        if (event.status === "reported" || event.status === "not-started") {
          if (event.inputTokens === null || event.outputTokens === null)
            throw new Error("measured administrative settlement has no reported usage");
          store.settleReservation({
            runId: options.runId,
            stepId: event.id,
            tokenCount: event.inputTokens + event.outputTokens,
          });
          store.finishStep({
            runId: options.runId,
            stepId: event.id,
            resultDigest: digestOfJson(asJsonValue(event)),
            at: options.clock.now(),
          });
        } else
          store.failStep({
            runId: options.runId,
            stepId: event.id,
            reason: event.detail,
            at: options.clock.now(),
          });
      }
      consumed += 1;
    }
  };
  return {
    synchronize,
    aborted: () => store.run(options.runId)?.state === "aborted",
    finish(complete: boolean, detail: string) {
      synchronize();
      if (store.run(options.runId)?.state === "aborted") return;
      if (complete) store.finishRun(options.runId, options.clock.now());
      else store.interruptRun(options.runId, detail, options.clock.now());
    },
    close: () => store.close(),
  };
}
