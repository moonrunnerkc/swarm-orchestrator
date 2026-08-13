import type { Clock } from "./clock.ts";
import type { ToolCallOutcome } from "./model-client.ts";
import type { RandomSource } from "./random-source.ts";
import type { ToolInvocation, ToolInvoker } from "./tool-invoker.ts";

export interface TestClock extends Clock {
  advance(milliseconds: number): void;
  readonly sleeps: readonly number[];
}

/** A clock that only moves when a test says so, or when the loop sleeps between retries. */
export function createTestClock(start = 0): TestClock {
  let current = start;
  const sleeps: number[] = [];

  return {
    now: () => current,
    sleep(milliseconds: number): Promise<void> {
      sleeps.push(milliseconds);
      current += milliseconds;
      return Promise.resolve();
    },
    advance(milliseconds: number): void {
      current += milliseconds;
    },
    sleeps,
  };
}

/** A fixed draw, so a jittered backoff produces the same delay on every run. */
export function createFixedRandom(value = 0.5): RandomSource {
  return { next: () => value };
}

export interface RecordingToolInvoker extends ToolInvoker {
  readonly invocations: readonly ToolInvocation[];
}

export function createRecordingToolInvoker(
  respond: (invocation: ToolInvocation) => string = () => "ok",
): RecordingToolInvoker {
  const invocations: ToolInvocation[] = [];

  return {
    invocations,
    invoke(invocation: ToolInvocation): Promise<ToolCallOutcome> {
      invocations.push(invocation);
      return Promise.resolve({
        callId: invocation.callId,
        toolName: invocation.toolName,
        output: respond(invocation),
        failed: false,
      });
    },
  };
}
