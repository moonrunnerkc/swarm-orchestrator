import { render } from "ink";
import { createElement } from "react";
import type { Clock } from "../core/clock.ts";
import type { CalibrationRepeatObservation } from "../select/calibration-run.ts";
import { CalibrateScreen } from "./calibrate-screen.ts";
import { createCalibrateStore } from "./calibrate-store.ts";
import type { CalibrateInFlight, CalibratePlan } from "./calibrate-view.ts";
import type { Theme } from "./theme.ts";

/**
 * The calibrate sweep's interface: the screen on a terminal, and nothing on anything else.
 *
 * Same shape as the session interface and the same rule, that every interactive feature is
 * TTY-only and degrades to the stream below. What differs is what the stream below already
 * was: the sweep printed one line before it started and its report after it, and that is left
 * exactly as it stood. Adding progress lines to the piped path would change output somebody's
 * log is already being read through, and the thing that was missing was a screen.
 */

export interface CalibrateInterface {
  planned(plan: CalibratePlan): void;
  repeatStarted(run: Omit<CalibrateInFlight, "startedAtMs">): void;
  repeatFinished(observation: CalibrationRepeatObservation): void;
  settled(pick: string | null): void;
  stop(): Promise<void>;
}

export interface CalibrateInterfaceOptions {
  readonly isTty: boolean;
  readonly interactive: boolean;
  readonly clock: Clock;
  readonly theme: Theme;
}

/** How often the screen redraws. Fast enough to turn a spinner and no faster. */
const tickMs = 150;

export function startCalibrateInterface(options: CalibrateInterfaceOptions): CalibrateInterface {
  return options.isTty && options.interactive ? interactive(options) : silent();
}

/**
 * Off a terminal there is no screen and no substitute for one. The caller writes what it
 * always wrote, so a piped run is byte-identical to what it was.
 */
function silent(): CalibrateInterface {
  return {
    planned: () => {},
    repeatStarted: () => {},
    repeatFinished: () => {},
    settled: () => {},
    stop: () => Promise.resolve(),
  };
}

function interactive(options: CalibrateInterfaceOptions): CalibrateInterface {
  const store = createCalibrateStore();
  const startedAt = options.clock.now();
  let ticking = true;
  let mounted = true;

  const elapsedMs = (): number => options.clock.now() - startedAt;
  const element = () => createElement(CalibrateScreen, { store, theme: options.theme, elapsedMs });

  const instance = render(element(), { exitOnCtrlC: false });

  // The elapsed counter, off the injected clock rather than a timer of its own, so the one
  // ambient thing the screen needs still enters at the composition root (invariant 8).
  void (async () => {
    while (ticking) {
      await options.clock.sleep(tickMs);
      if (!ticking || !mounted) {
        return;
      }
      instance.rerender(element());
    }
  })();

  const apply = (redraw: () => void): void => {
    redraw();
    if (mounted) {
      instance.rerender(element());
    }
  };

  return {
    planned(plan: CalibratePlan): void {
      apply(() => store.apply({ type: "planned", plan }));
    },
    repeatStarted(run): void {
      apply(() =>
        store.apply({
          type: "repeat-started",
          run: { ...run, startedAtMs: options.clock.now() },
        }),
      );
    },
    repeatFinished(observation: CalibrationRepeatObservation): void {
      apply(() => store.apply({ type: "repeat-finished", observation }));
    },
    settled(pick: string | null): void {
      apply(() => store.apply({ type: "settled", pick }));
    },
    async stop(): Promise<void> {
      ticking = false;
      if (mounted) {
        mounted = false;
        instance.unmount();
      }
      await instance.waitUntilExit();
    },
  };
}
