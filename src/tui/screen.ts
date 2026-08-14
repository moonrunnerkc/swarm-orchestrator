import { Box, Text } from "ink";
import { createElement, type ReactElement, useEffect, useState } from "react";
import type { SessionStore } from "./session-store.ts";
import type { GateLine, SessionView } from "./session-view.ts";

/** How much of the action stream stays on screen. Older lines scroll out of the pane. */
const visibleActions = 12;

interface SessionScreenProps {
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
    renderGateStrip(view),
    createElement(
      Text,
      { key: "status", color: view.escalated ? "red" : view.finished ? "cyan" : "yellow" },
      `\n${view.status}`,
    ),
  );
}

/**
 * The only place this screen paints green, and it paints it from a gate-run ledger record.
 * Model prose has no route to this pane (invariant 1).
 */
function renderGateStrip(view: SessionView): ReactElement | null {
  if (view.gates.length === 0) {
    return null;
  }

  const attempt =
    view.attempt === null ? "" : `  attempt ${view.attempt.current}/${view.attempt.cap}`;

  return createElement(
    Box,
    { key: "gates", flexDirection: "column", marginTop: 1 },
    createElement(Text, { dimColor: true }, `gates${attempt}`),
    ...view.gates.map((gate) =>
      createElement(Text, { key: gate.gateId, color: gateColor(gate) }, `  ${describeGate(gate)}`),
    ),
  );
}

function gateColor(gate: GateLine): "green" | "red" | "yellow" | "gray" {
  if (gate.status === "passed") {
    return "green";
  }
  if (gate.status === "not-applicable") {
    return "gray";
  }
  return gate.blocking ? "red" : "yellow";
}

function describeGate(gate: GateLine): string {
  const label = gate.status === "not-applicable" ? "n/a" : gate.status;
  return `${label.padEnd(8)} ${gate.gateId}${gate.blocking ? "" : " (advisory)"}: ${firstLine(gate.detail)}`;
}

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > 90 ? `${line.slice(0, 87)}...` : line;
}
