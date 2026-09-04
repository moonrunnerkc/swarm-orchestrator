import { createElement } from "react";
import type { Clock } from "../core/clock.ts";
import { CalibrateScreen } from "./calibrate-screen.ts";
import { type CalibrateStore, createCalibrateStore } from "./calibrate-store.ts";
import { type CalibrateEvent, describeVerdict } from "./calibrate-view.ts";
import type { Theme } from "./theme.ts";

/**
 * The sweep's screen, or the plain lines it replaces.
 *
 * The same fork the run has: a terminal with the interface on gets the screen, and everything
 * else gets one line per event on stdout. Off a terminal that is not a degraded view, it is the
 * right one: a sweep watched through `tail -f` on a log was how the 08-23 calibration was
 * watched, and a screen redrawing into a file would make that log unreadable.
 */

export interface CalibrateInterface {
  apply(event: CalibrateEvent): void;
  stop(): Promise<void>;
}

interface CalibrateInterfaceOptions {
  readonly isTty: boolean;
  readonly interactive: boolean;
  readonly theme: Theme;
  readonly clock: Clock;
  readonly bundleDirectory: string;
  readonly writeLine: (line: string) => void;
  /** Injected so a test can drive the whole thing without a terminal. */
  readonly render?: typeof import("ink").render;
}

export function startCalibrateInterface(options: CalibrateInterfaceOptions): CalibrateInterface {
  const store = createCalibrateStore();

  if (!options.isTty || !options.interactive) {
    return { apply: (event) => plainLine(event, options.writeLine), stop: () => Promise.resolve() };
  }

  return renderScreen(store, options);
}

function renderScreen(
  store: CalibrateStore,
  options: CalibrateInterfaceOptions,
): CalibrateInterface {
  const startedAt = options.clock.now();
  const element = () =>
    createElement(CalibrateScreen, {
      store,
      theme: options.theme,
      bundleDirectory: options.bundleDirectory,
      elapsedMs: () => options.clock.now() - startedAt,
    });

  // Imported here rather than at the top so a non-interactive run never loads a renderer.
  const render = options.render;
  if (render === undefined) {
    return {
      apply: (event) => plainLine(event, options.writeLine),
      stop: () => Promise.resolve(),
    };
  }

  const instance = render(element());
  // Redrawn on every event rather than on a timer: a sweep's events are minutes apart, and a
  // timer would redraw a screen nothing had changed on.
  return {
    apply(event: CalibrateEvent): void {
      store.apply(event);
      instance.rerender(element());
    },
    async stop(): Promise<void> {
      instance.unmount();
      await instance.waitUntilExit();
    },
  };
}

/**
 * One line per event, which is what a log wants. Deliberately the same facts the screen shows
 * and in the same words, so a person reading the log and a person watching the screen are
 * reading one account of the run.
 */
function plainLine(event: CalibrateEvent, writeLine: (line: string) => void): void {
  if (event.type === "plan") {
    writeLine(
      `calibrating ${event.plan.models.length} model(s) over ${event.plan.cases} case(s), ` +
        `${event.plan.repeats} repeat(s) each`,
    );
    return;
  }
  if (event.type === "run-started") {
    return;
  }
  const { outcome } = event;
  writeLine(
    `  ${outcome.model}  ${outcome.caseId} #${outcome.repeat}  ${describeVerdict(outcome)}`,
  );
}
