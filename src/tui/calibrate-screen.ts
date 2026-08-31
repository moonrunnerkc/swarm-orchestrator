import { Box, Text, useStdout } from "ink";
import { createElement, type ReactElement, useEffect, useState } from "react";
import { buildCalibrateScreen } from "./calibrate-screen-model.ts";
import type { CalibrateStore } from "./calibrate-store.ts";
import type { CalibrateView } from "./calibrate-view.ts";
import type { ScreenRow } from "./screen-model.ts";
import type { Theme } from "./theme.ts";

/**
 * The sweep's screen. Written with createElement rather than JSX for the same reason the run
 * screen is: the CLI runs from source with no build step, which is what makes `npm run dev`
 * work.
 *
 * The same division as the run screen, too. This subscribes, calls `buildCalibrateScreen`, and
 * maps each row to one `Text`. It holds no layout, no truncation, and no decision about what a
 * number means.
 *
 * No key handling, deliberately. A sweep has nothing to scroll through and nothing to expand,
 * and adding an interaction that exists on no other screen would be a new pattern rather than
 * the existing one applied somewhere else. Ctrl+C is what a person watching this reaches for,
 * and that is the terminal's, not this component's.
 */

interface CalibrateScreenProps {
  readonly store: CalibrateStore;
  readonly theme: Theme;
  readonly bundleDirectory: string;
  /** A function, so each redraw reads the clock fresh rather than a value captured once. */
  readonly elapsedMs: () => number;
}

/** Two rows kept back so the shell prompt and a wrapped line never push the top off screen. */
const rowsKeptBack = 2;

export function CalibrateScreen(props: CalibrateScreenProps): ReactElement {
  const [view, setView] = useState<CalibrateView>(props.store.getView());
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });

  useEffect(() => props.store.subscribe(setView), [props.store]);

  useEffect(() => {
    if (stdout === undefined) {
      return;
    }
    const onResize = (): void => {
      setSize({ columns: stdout.columns, rows: stdout.rows });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  const rows = buildCalibrateScreen({
    view,
    columns: size.columns,
    rows: Math.max(1, size.rows - rowsKeptBack),
    theme: props.theme,
    elapsedMs: props.elapsedMs(),
    bundleDirectory: props.bundleDirectory,
  });

  return createElement(
    Box,
    { flexDirection: "column" },
    ...rows.map((row, index) => createElement(Text, { key: index, ...textProps(row) }, row.text)),
  );
}

function textProps(row: ScreenRow): {
  bold?: boolean;
  dimColor?: boolean;
  inverse?: boolean;
  color?: string;
} {
  return {
    ...(row.bold === true ? { bold: true } : {}),
    ...(row.dim === true ? { dimColor: true } : {}),
    ...(row.inverse === true ? { inverse: true } : {}),
    ...(row.color === undefined ? {} : { color: row.color }),
  };
}
