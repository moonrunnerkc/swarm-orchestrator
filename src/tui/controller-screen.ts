import { Box, Text, useStdout } from "ink";
import { createElement, type ReactElement, useEffect, useState } from "react";
import type { ControllerView } from "../workers/controller-view.ts";
import { controllerScreenLines } from "./controller-screen-model.ts";

/** The renderer holds terminal dimensions only; acceptance stays in the recorded assessment. */
export function ControllerScreen(props: { view: ControllerView; now: number }): ReactElement {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    const resize = () => setColumns(stdout.columns ?? 80);
    stdout.on("resize", resize);
    return () => {
      stdout.off("resize", resize);
    };
  }, [stdout]);
  return createElement(
    Box,
    { flexDirection: "column" },
    ...controllerScreenLines(props.view, columns, props.now).map((line, index) =>
      createElement(Text, { key: index }, line),
    ),
  );
}
