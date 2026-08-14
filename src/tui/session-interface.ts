import { render } from "ink";
import { createElement } from "react";
import type { LoopEvent } from "../core/loop-events.ts";
import { describeLoopEvent } from "./plain-lines.ts";
import { SessionScreen } from "./screen.ts";
import { createSessionStore } from "./session-store.ts";

interface SessionInterface {
  emit(event: LoopEvent): void;
  stop(): Promise<void>;
}

interface SessionInterfaceOptions {
  readonly task: string;
  readonly isTty: boolean;
  readonly writeLine: (line: string) => void;
}

/**
 * Picks the single-screen Ink view on a TTY and plain lines everywhere else, so piped
 * output stays readable and CI never renders cursor control codes.
 */
export function startSessionInterface(options: SessionInterfaceOptions): SessionInterface {
  if (!options.isTty) {
    return {
      emit(event: LoopEvent): void {
        const line = describeLoopEvent(event);
        if (line !== null) {
          options.writeLine(line);
        }
      },
      stop: () => Promise.resolve(),
    };
  }

  const store = createSessionStore();
  const instance = render(createElement(SessionScreen, { store, task: options.task }));

  return {
    emit(event: LoopEvent): void {
      store.apply(event);
    },
    async stop(): Promise<void> {
      instance.unmount();
      await instance.waitUntilExit();
    },
  };
}
