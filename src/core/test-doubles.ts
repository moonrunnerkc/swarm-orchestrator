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
  // A sleep armed with a cancel signal is a deadline, and a deadline is not something a test
  // clock should wait through on its own: it settles when the test advances past it, or when
  // whatever armed it lets go. A plain sleep is a wait the caller means to take, and moves
  // the clock as before.
  const deadlines: { at: number; settle: () => void }[] = [];
  const settleDue = () => {
    for (const deadline of deadlines.splice(0)) {
      if (deadline.at <= current) {
        deadline.settle();
      } else {
        deadlines.push(deadline);
      }
    }
  };

  return {
    now: () => current,
    sleep(milliseconds: number, cancel?: AbortSignal): Promise<void> {
      if (cancel === undefined) {
        sleeps.push(milliseconds);
        current += milliseconds;
        return Promise.resolve();
      }
      return new Promise((settle) => {
        const deadline = { at: current + milliseconds, settle };
        deadlines.push(deadline);
        cancel.addEventListener(
          "abort",
          () => {
            deadlines.splice(deadlines.indexOf(deadline), 1);
            settle();
          },
          { once: true },
        );
      });
    },
    advance(milliseconds: number): void {
      current += milliseconds;
      settleDue();
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
