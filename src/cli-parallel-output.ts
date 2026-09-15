import type { Clock } from "./core/clock.ts";
import type { LoopEvent } from "./core/loop-events.ts";
import { asJsonValue, digestOfJson } from "./evidence/canonical-json.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { controllerScreenLines } from "./tui/controller-screen-model.ts";
import { describeLoopEvent } from "./tui/plain-lines.ts";
import { firstLineToWidth } from "./tui/terminal-text.ts";
import { type ControllerView, projectControllerView } from "./workers/controller-view.ts";
import { renderParallelReport } from "./workers/parallel-report.ts";
import type { ParallelRunResult } from "./workers/parallel-run.ts";

export interface ParallelOutput {
  readonly evidence: EvidenceRecorder;
  note(line: string): void;
  loop(workerId: string, event: LoopEvent): void;
  finish(completed: ParallelRunResult, bundleDirectory: string): Promise<void>;
  fail(cause: unknown): void;
  stop(): Promise<void>;
}

/** Plain, JSON and terminal views share the same ledger projection and final assessment. */
export async function startParallelOutput(options: {
  evidence: EvidenceRecorder;
  clock: Clock;
  json: boolean;
  details: boolean;
  interactive: boolean;
  write: (line: string) => void;
  screen?: (
    view: ControllerView,
    now: number,
  ) => { update(view: ControllerView, now: number): void; stop(): Promise<void> };
}): Promise<ParallelOutput> {
  let view = projectControllerView(options.evidence);
  let screen: ReturnType<NonNullable<typeof options.screen>> | undefined;
  if (!options.json && options.interactive && !options.details) {
    if (options.screen !== undefined) screen = options.screen(view, options.clock.now());
    else {
      const [{ render }, { createElement }, { ControllerScreen }] = await Promise.all([
        import("ink"),
        import("react"),
        import("./tui/controller-screen.ts"),
      ]);
      const instance = render(createElement(ControllerScreen, { view, now: options.clock.now() }), {
        exitOnCtrlC: false,
      });
      screen = {
        update: (view, now) => instance.rerender(createElement(ControllerScreen, { view, now })),
        stop: async () => {
          instance.unmount();
          await instance.waitUntilExit();
        },
      };
    }
  }
  let finished = false;
  const json = (event: unknown) =>
    options.write(
      JSON.stringify({ schema: "swarm.controller.event.v1", runId: view.runId, event }),
    );
  let previous = "";
  const show = () => {
    view = projectControllerView(options.evidence);
    const fingerprint = JSON.stringify(view);
    if (fingerprint === previous) return;
    previous = fingerprint;
    if (options.json) json({ type: "progress", view });
    else if (screen !== undefined) screen.update(view, options.clock.now());
    else if (!finished)
      options.write(
        firstLineToWidth(
          `${view.activity}; jobs ${view.jobs.filter((job) => job.state === "accepted").length}/${view.jobs.length}; tokens ${view.usage?.remaining ?? "pending"} remaining`,
          240,
        ),
      );
  };
  const interesting = new Set([
    "controller-launch",
    "controller-event",
    "controller-graph",
    "controller-transition",
    "controller-candidate",
    "controller-assessment",
    "goal-contract",
    "goal-check",
    "independent-verification",
    "bootstrap-stage",
  ]);
  const evidence: EvidenceRecorder = {
    ...options.evidence,
    record: async (entry) => {
      const captured = await options.evidence.record(entry);
      if (interesting.has(entry.type)) show();
      return captured;
    },
  };
  const tick =
    screen === undefined
      ? undefined
      : setInterval(() => {
          screen?.update(view, options.clock.now());
        }, 1000);
  if (!options.json && screen === undefined)
    options.write(firstLineToWidth(`Goal: ${view.goal}`, 240));
  show();
  return {
    evidence,
    note(line) {
      if (options.json) json({ type: "note", text: line });
      else if (screen === undefined) options.write(firstLineToWidth(line, 240));
    },
    loop(workerId, event) {
      if (options.details) {
        if (options.json) json({ type: "worker-event", workerId, event });
        else {
          const line = describeLoopEvent(event);
          if (line !== null) options.write(`[${workerId}] ${line}`);
        }
      } else if (event.type === "execution-envelope") {
        if (options.json)
          json({ type: "execution", workerId, mode: event.mode, lines: event.lines });
        else if (screen === undefined)
          options.write(`[${workerId}] execution: ${event.mode}; envelope retained in evidence`);
      }
    },
    async finish(completed, bundleDirectory) {
      view = projectControllerView(options.evidence);
      if (digestOfJson(asJsonValue(view.outcome)) !== digestOfJson(asJsonValue(completed.outcome)))
        throw new Error("displayed completion differs from the recorded controller assessment");
      finished = true;
      if (tick !== undefined) clearInterval(tick);
      await screen?.stop();
      screen = undefined;
      if (options.json)
        options.write(
          JSON.stringify({
            schema: "swarm.controller.result.v1",
            runId: view.runId,
            outcome: view.outcome,
            assessmentRecord: view.record,
            branch: completed.integrationBranch,
            commit: completed.headCommit,
            bundleDirectory,
            exitCode: completed.outcome.exitCode,
          }),
        );
      else {
        for (const line of controllerScreenLines(view, 240, options.clock.now()))
          options.write(line);
        if (options.details)
          for (const line of renderParallelReport(completed, {
            repositoryRoot: view.repositoryRoot ?? "unavailable",
            baseRef: completed.baseCommit,
          }))
            options.write(line);
        options.write(`Evidence: ${bundleDirectory}`);
      }
    },
    fail(cause) {
      if (finished) return;
      finished = true;
      const error = cause instanceof Error ? cause.message : String(cause);
      if (options.json)
        options.write(
          JSON.stringify({
            schema: "swarm.controller.result.v1",
            runId: view.runId,
            outcome: null,
            error,
            exitCode: 1,
          }),
        );
      else options.write(firstLineToWidth(`Stopped: ${error}`, 240));
    },
    async stop() {
      if (tick !== undefined) clearInterval(tick);
      await screen?.stop();
      screen = undefined;
    },
  };
}
