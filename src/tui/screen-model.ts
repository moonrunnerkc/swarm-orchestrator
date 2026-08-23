import type { ConfirmationRequest } from "../tools/chokepoint.ts";
import { formatElapsed } from "./elapsed.ts";
import { describeEvidence, type EvidenceSummary } from "./evidence-panel.ts";
import { type KeyAction, type KeyBindings, keyActionDescriptions } from "./key-bindings.ts";
import { type Layout, visibleWindow } from "./layout.ts";
import type { ActionRow, GateLine, SessionView } from "./session-view.ts";
import { firstLineToWidth, padToWidth, truncateToWidth } from "./terminal-text.ts";
import type { Theme } from "./theme.ts";
import type { ViewState } from "./view-state.ts";

/**
 * The screen as a list of rows. Every row is already truncated to the width it will be drawn
 * at, so nothing wraps and the component that renders this holds no logic: it maps a row to
 * one Ink `Text` and stops. That is what makes the screen table-testable at four widths and
 * two colour modes without a test renderer.
 */
export interface ScreenRow {
  readonly text: string;
  readonly color?: string | undefined;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly inverse?: boolean;
}

export interface ScreenInput {
  readonly view: SessionView;
  readonly state: ViewState;
  readonly layout: Layout;
  readonly theme: Theme;
  readonly bindings: KeyBindings;
  readonly task: string;
  readonly workspace: string;
  readonly confirmation: ConfirmationRequest | null;
  /** Present once the run has finished and the bundle has been written. */
  readonly evidence: EvidenceSummary | null;
}

export function buildScreen(input: ScreenInput): readonly ScreenRow[] {
  const { layout } = input;

  const body =
    input.confirmation !== null
      ? confirmationRows(input, input.confirmation)
      : input.state.helpOpen
        ? helpRows(input)
        : input.state.evidenceOpen && input.evidence !== null
          ? evidenceRows(input, input.evidence)
          : streamRows(input);

  // Truncated once, here, so no row can exceed the width whatever built it.
  return [
    ...headerRows(input),
    ...body,
    statusRow(input),
    ...(layout.showHint ? [hintRow(input)] : []),
  ].map((row) => ({ ...row, text: truncateToWidth(row.text, layout.columns) }));
}

function headerRows(input: ScreenInput): readonly ScreenRow[] {
  const { layout, view, state } = input;
  const paused = state.paused ? "  [paused]" : "";
  const rows: ScreenRow[] = [
    { text: `swarm  ${input.task}${paused}`, bold: true, color: input.theme.color("accent") },
  ];

  if (layout.showHeaderDetail) {
    const facts = [
      view.modelId ?? "no model call yet",
      input.workspace,
      formatElapsed(state.elapsedMs),
      `step ${view.steps}`,
      view.tokensUsed === 0 ? "tokens at the end" : `${view.tokensUsed} tokens`,
      ...(view.attempt === null ? [] : [`attempt ${view.attempt.current}/${view.attempt.cap}`]),
      ...(view.ratchetRejected === 0 && view.ratchetAccepted === 0
        ? []
        : [`ratchet +${view.ratchetAccepted}/-${view.ratchetRejected}`]),
    ];
    rows.push({ text: `  ${facts.join("  ")}`, dim: true });
  }

  return rows;
}

function streamRows(input: ScreenInput): readonly ScreenRow[] {
  const { layout, state, view } = input;
  const rows: ScreenRow[] = [];

  if (layout.planRows > 0) {
    if (layout.showLabels) {
      rows.push(label("plan", input));
    }
    const planLines =
      view.plan.length === 0 ? ["(waiting for the first turn)"] : view.plan.split("\n");
    for (const line of planLines.slice(0, layout.planRows)) {
      rows.push({ text: `  ${firstLineToWidth(line, layout.contentColumns)}` });
    }
  }

  const filtered = filterActions(view.actions, state.filter);
  if (layout.showLabels) {
    rows.push(label(actionsLabel(input, filtered.length), input));
  }

  const window = visibleWindow(filtered, layout.actionRows, state.scrollBack);
  if (window.rows.length === 0) {
    rows.push({ text: "  (nothing yet)", dim: true });
  }
  window.rows.forEach((action, offset) => {
    const index = window.firstIndex + offset;
    const selected = state.focus === "actions" && index === selectedIndex(filtered.length, state);
    rows.push({
      text: `  ${firstLineToWidth(action.summary, layout.contentColumns)}`,
      color: action.failed ? input.theme.failed.color : undefined,
      inverse: selected,
    });
  });

  if (layout.detailRows > 0 && state.expanded) {
    rows.push(...detailRows(input, filtered));
  }

  rows.push(...gateRows(input));
  return rows;
}

function detailRows(input: ScreenInput, filtered: readonly ActionRow[]): readonly ScreenRow[] {
  const { layout, state, view } = input;
  const rows: ScreenRow[] = [];

  if (state.focus === "gates") {
    const gate = view.gates[selectedIndex(view.gates.length, state) ?? 0];
    if (gate === undefined) {
      return rows;
    }
    if (layout.showLabels) {
      rows.push(label(`${gate.gateId} detail`, input));
    }
    for (const line of gate.detail.split("\n").slice(0, layout.detailRows - 1)) {
      rows.push({ text: `  ${truncateToWidth(line, layout.contentColumns)}` });
    }
    // The digest is what makes the line above checkable rather than trustworthy.
    rows.push({
      text: `  record ${truncateToWidth(gate.record, Math.max(8, layout.contentColumns - 7))}`,
      dim: true,
    });
    return rows;
  }

  const action = filtered[selectedIndex(filtered.length, state) ?? filtered.length - 1];
  if (action === undefined) {
    return rows;
  }
  if (layout.showLabels) {
    rows.push(label(`${action.kind} detail`, input));
  }
  const detailLines = action.detail.split("\n");
  const room = action.record === null ? layout.detailRows : layout.detailRows - 1;
  for (const line of detailLines.slice(0, room)) {
    rows.push({ text: `  ${truncateToWidth(line, layout.contentColumns)}` });
  }
  if (detailLines.length > room) {
    rows.push({ text: `  ... ${detailLines.length - room} more line(s)`, dim: true });
  }
  if (action.record !== null) {
    rows.push({
      text: `  record ${truncateToWidth(action.record, Math.max(8, layout.contentColumns - 7))}`,
      dim: true,
    });
  }
  return rows;
}

function gateRows(input: ScreenInput): readonly ScreenRow[] {
  const { layout, view, state } = input;
  if (layout.gateRows === 0 || view.gates.length === 0) {
    return [];
  }

  const rows: ScreenRow[] = [];
  if (layout.showLabels) {
    const attempt =
      view.attempt === null ? "" : `  attempt ${view.attempt.current}/${view.attempt.cap}`;
    rows.push(label(`gates${attempt}`, input));
  }

  const window = visibleWindow(view.gates, layout.gateRows, 0);
  window.rows.forEach((gate, offset) => {
    const selected = state.focus === "gates" && offset === selectedIndex(view.gates.length, state);
    rows.push({
      text: `  ${describeGate(gate, input)}`,
      color: gateStyle(gate, input).color,
      inverse: selected,
    });
  });
  return rows;
}

/**
 * The one place the screen paints a passing gate, and it paints it from a gate-run ledger
 * record. The word travels with the colour, so the strip reads the same with colour off.
 */
function gateStyle(gate: GateLine, input: ScreenInput) {
  if (gate.status === "passed") {
    return input.theme.passed;
  }
  if (gate.status === "not-applicable") {
    return input.theme.notApplicable;
  }
  return gate.blocking ? input.theme.failed : input.theme.advisory;
}

function describeGate(gate: GateLine, input: ScreenInput): string {
  const { layout } = input;
  const mark = gateStyle(gate, input).label;
  const advisory = gate.blocking ? "" : " (advisory)";
  const head = `${padToWidth(mark, 4)} ${gate.gateId}${advisory}`;
  if (layout.narrow) {
    return truncateToWidth(head, layout.contentColumns);
  }
  return truncateToWidth(
    `${head}: ${firstLineToWidth(gate.detail, layout.contentColumns)}`,
    layout.contentColumns,
  );
}

function statusRow(input: ScreenInput): ScreenRow {
  const { view, theme } = input;
  const color = view.escalated
    ? theme.failed.color
    : view.finished
      ? theme.color("accent")
      : theme.color("advisory");
  const mark = view.escalated ? "ESCALATED " : view.finished ? "DONE " : "";
  return { text: `${mark}${view.status}`, color };
}

function hintRow(input: ScreenInput): ScreenRow {
  const { state, bindings } = input;
  if (state.filtering) {
    return { text: `filter: ${state.filter}_   enter to apply, escape to clear`, dim: true };
  }
  const shown: readonly KeyAction[] = state.evidenceOpen
    ? ["open-review", "open-bundle", "back", "detach"]
    : ["scroll-down", "expand", "next-pane", "filter", "evidence", "help", "detach", "cancel"];
  return { text: hintText(bindings, shown, input.layout.narrow), dim: true };
}

function hintText(bindings: KeyBindings, actions: readonly KeyAction[], narrow: boolean): string {
  return actions
    .map((action) => {
      const key = bindings.labelOf.get(action) ?? "?";
      return narrow ? key : `${key} ${shortDescription(action)}`;
    })
    .join(narrow ? " " : "  ");
}

/** The hint bar wants three words, the help overlay wants the sentence. */
const shortDescriptions: Partial<Record<KeyAction, string>> = {
  "scroll-down": "scroll",
  expand: "expand",
  "next-pane": "pane",
  filter: "filter",
  evidence: "evidence",
  help: "help",
  detach: "detach",
  cancel: "cancel run",
  "open-review": "open review page",
  "open-bundle": "open bundle",
  back: "back",
};

function shortDescription(action: KeyAction): string {
  return shortDescriptions[action] ?? keyActionDescriptions[action];
}

function helpRows(input: ScreenInput): readonly ScreenRow[] {
  const { bindings, layout } = input;
  const rows: ScreenRow[] = [{ text: "keys", bold: true }, { text: "" }];
  for (const [action, description] of Object.entries(keyActionDescriptions)) {
    const key = bindings.labelOf.get(action as KeyAction) ?? "(unbound)";
    rows.push({
      text: truncateToWidth(`  ${padToWidth(key, 10)} ${description}`, layout.contentColumns + 2),
    });
  }
  rows.push({ text: "" });
  rows.push({
    text: "  detach leaves the view and lets the run finish. cancel stops the run.",
    dim: true,
  });
  return rows;
}

function evidenceRows(input: ScreenInput, evidence: EvidenceSummary): readonly ScreenRow[] {
  return describeEvidence(evidence, input.layout.columns).map((text, index) => ({
    text,
    bold: index === 0,
  }));
}

function confirmationRows(input: ScreenInput, request: ConfirmationRequest): readonly ScreenRow[] {
  const { bindings, layout, theme } = input;
  const yes = bindings.labelOf.get("confirm-yes") ?? "y";
  const no = bindings.labelOf.get("confirm-no") ?? "n";
  return [
    { text: "the chokepoint is asking", bold: true, color: theme.color("advisory") },
    { text: "" },
    { text: `  ${truncateToWidth(request.explanation, layout.contentColumns)}` },
    { text: `  ${request.toolName}: ${truncateToWidth(request.detail, layout.contentColumns)}` },
    { text: "" },
    { text: `  ${yes} to run it, ${no} or escape to refuse. Refusing is recorded either way.` },
  ];
}

function label(text: string, input: ScreenInput): ScreenRow {
  return { text, dim: true, color: input.theme.color("muted") };
}

function actionsLabel(input: ScreenInput, rowCount: number): string {
  const { state } = input;
  const filter = state.filter.length === 0 ? "" : `  filter "${state.filter}" (${rowCount})`;
  const scrolled = state.scrollBack === 0 ? "" : `  ${state.scrollBack} back`;
  return `actions${filter}${scrolled}`;
}

export function filterActions(actions: readonly ActionRow[], filter: string): readonly ActionRow[] {
  if (filter.length === 0) {
    return actions;
  }
  const needle = filter.toLowerCase();
  return actions.filter(
    (action) =>
      action.summary.toLowerCase().includes(needle) || action.detail.toLowerCase().includes(needle),
  );
}

/** Which row the selection sits on, counted back from the newest. Null follows the tail. */
function selectedIndex(rowCount: number, state: ViewState): number | null {
  if (state.scrollBack === 0) {
    return rowCount === 0 ? null : rowCount - 1;
  }
  return Math.max(0, rowCount - state.scrollBack);
}
