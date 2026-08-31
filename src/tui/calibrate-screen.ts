import { Box, Text, useStdout } from "ink";
import { createElement, type ReactElement, useEffect, useState } from "react";
import { buildCalibrateScreen } from "./calibrate-screen-model.ts";
import type { CalibrateStore } from "./calibrate-store.ts";
import type { CalibrateView } from "./calibrate-view.ts";
import type { ScreenRow } from "./screen-model.ts";
import type { Theme } from "./theme.ts";

/**
 * The calibrate sweep's screen. Written with createElement rather than JSX for the reason the
 * session screen is: the CLI runs from source with no build step.
 *
 * It subscribes, calls `buildCalibrateScreen`, and maps each row to one `Text`. No `useInput`,
 * because there is nothing to steer: a sweep has no pane to move between, no action stream to
 * filter, and no confirmation to answer. Everything worth testing is in the pure function
 * beside it.
 */

interface CalibrateScreenProps {
  readonly store: CalibrateStore;
  readonly theme: Theme;
  /** How long the sweep has been going. A function, so each redraw reads it fresh. */
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
    rows: Math.max(4, size.rows - rowsKeptBack),
    theme: props.theme,
    elapsedMs: props.elapsedMs(),
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
  color?: string;
} {
  return {
    ...(row.bold === true ? { bold: true } : {}),
    ...(row.dim === true ? { dimColor: true } : {}),
    ...(row.color === undefined ? {} : { color: row.color }),
  };
}
