import { Box, Text } from "ink";
import { createElement, type ReactElement, useEffect, useState } from "react";
import type { SessionStore } from "./session-store.ts";
import type { SessionView } from "./session-view.ts";

/** How much of the action stream stays on screen. Older lines scroll out of the pane. */
const visibleActions = 12;

export interface SessionScreenProps {
  readonly store: SessionStore;
  readonly task: string;
}

/**
 * One screen: the plan on top, the live action stream below, status last. Written with
 * createElement rather than JSX so the CLI runs from source without a build step.
 */
export function SessionScreen({ store, task }: SessionScreenProps): ReactElement {
  const [view, setView] = useState<SessionView>(store.getView());
  useEffect(() => store.subscribe(setView), [store]);

  const actions = view.actions.slice(-visibleActions);

  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Text, { key: "task", bold: true }, `swarm: ${task}`),
    createElement(
      Box,
      { key: "plan", flexDirection: "column", marginTop: 1 },
      createElement(Text, { dimColor: true }, "plan"),
      createElement(
        Text,
        null,
        view.plan.length === 0 ? "(waiting for the first turn)" : view.plan,
      ),
    ),
    createElement(
      Box,
      { key: "actions", flexDirection: "column", marginTop: 1 },
      createElement(Text, { dimColor: true }, "actions"),
      ...actions.map((action, index) =>
        createElement(Text, { key: `${index}-${action}` }, `  ${action}`),
      ),
    ),
    // Never green: nothing in this phase is harness-verified, so nothing may look verified.
    createElement(
      Text,
      { key: "status", color: view.finished ? "cyan" : "yellow" },
      `\n${view.status}`,
    ),
  );
}
