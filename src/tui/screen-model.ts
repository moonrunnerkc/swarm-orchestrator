import type { ApprovalMode } from "../config/approval-mode.ts";
import type { ConfirmationRequest } from "../tools/chokepoint.ts";
import { formatClock, formatElapsed } from "./elapsed.ts";
import {
  describeRun,
  type EvidenceSummary,
  finishCardRows,
  formatTokens,
} from "./evidence-panel.ts";
import { type Glyphs, glyphsFor } from "./glyphs.ts";
import { hyperlink } from "./hyperlink.ts";
import { type KeyAction, type KeyBindings, keyActionDescriptions } from "./key-bindings.ts";
import { type Layout, visibleWindow } from "./layout.ts";
import type { ActionRow, GateLine, SessionView } from "./session-view.ts";
import { displayWidth, firstLineToWidth, padToWidth, truncateToWidth } from "./terminal-text.ts";
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
  /**
   * A URL the row's text stands for, given to a terminal that understands OSC 8. The text is
   * complete on its own, so a terminal that does not is handed nothing it cannot show.
   */
  readonly link?: string;
}

/**
 * What the terminal is given for a row: the text wrapped as a link where the row carries one
 * and the terminal is known to understand it, the text alone otherwise. Applied after the text
 * was neutralised, so a control sequence in tool output never reaches here as a sequence.
 */
export function renderRowText(row: ScreenRow, hyperlinks: boolean): string {
  return hyperlinks && row.link !== undefined ? hyperlink(row.text, row.link) : row.text;
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
  /** How long that question waits before refusing itself, so the panel can say so. */
  readonly confirmTimeoutMs?: number;
  /** Present once the run has finished and the bundle has been written. */
  readonly evidence: EvidenceSummary | null;
  /** How long the current activity has been going, for the line that says the run is alive. */
  readonly activityElapsedMs?: number;
  /**
   * Turns already finished this session, oldest first, one line each. A session that cleared
   * the screen between turns would be a screen that forgets, which is the opposite of what a
   * person keeps a session open for.
   */
  readonly transcript?: readonly TranscriptLine[];
  /** Which prompts the run answers itself, shown so nobody wonders why a step went unasked. */
  readonly approvalMode?: ApprovalMode;
  /** The status marks, chosen once at the composition root for the terminal's character set. */
  readonly glyphs?: Glyphs;
}

const defaultGlyphs = glyphsFor({ LANG: "C.UTF-8", TERM: "xterm" });

function glyphsOf(input: ScreenInput): Glyphs {
  return input.glyphs ?? defaultGlyphs;
}

export interface TranscriptLine {
  readonly text: string;
  readonly kind: "task" | "outcome" | "note";
}

export function buildScreen(input: ScreenInput): readonly ScreenRow[] {
  const { layout } = input;

  const transcript = (input.transcript ?? []).map((line) => ({
    text: line.kind === "task" ? `\u203a ${line.text}` : `  ${line.text}`,
    dim: line.kind === "outcome",
    ...(line.kind === "task" ? { color: input.theme.color("accent") } : {}),
  }));

  const activity = activityRow(input);

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
    ...transcript,
    ...body,
    ...(activity === null ? [] : [activity]),
    statusRow(input),
    ...(input.state.composing === null ? [] : [promptRow(input)]),
    ...(layout.showHint ? [hintRow(input)] : []),
  ].map((row) => ({ ...row, text: truncateToWidth(row.text, layout.columns) }));
}

/**
 * The line being typed, with the cursor drawn where the next character lands.
 *
 * The cursor is a character in the string rather than a terminal escape, because every row on
 * this screen is plain text truncated on grapheme boundaries by one function, and a real cursor
 * would be the one thing on the screen that width arithmetic could not see.
 */
function promptRow(input: ScreenInput): ScreenRow {
  const composing = input.state.composing;
  if (composing === null) {
    return { text: "" };
  }
  const { text, cursor } = composing;
  const drawn = `${text.slice(0, cursor)}\u2588${text.slice(cursor)}`;
  return { text: `\u203a ${drawn}`, color: input.theme.color("accent") };
}

function headerRows(input: ScreenInput): readonly ScreenRow[] {
  const { layout, view, state } = input;
  const paused = state.paused ? "  [paused]" : "";
  const rows: ScreenRow[] = [
    { text: `swarm  ${input.task}${paused}`, bold: true, color: input.theme.color("accent") },
  ];

  if (layout.showHeaderDetail) {
    const attempt =
      view.attempt === null ? [] : [`attempt ${view.attempt.current}/${view.attempt.cap}`];
    const approval = input.approvalMode === undefined ? [] : [`approval: ${input.approvalMode}`];
    // Narrow keeps what changes as the run goes and what a person might wonder about when a
    // step goes unasked; the workspace and the model are on the preflight card above the screen.
    const facts = layout.narrow
      ? [formatElapsed(state.elapsedMs), `step ${view.steps}`, ...attempt, ...approval]
      : [
          formatElapsed(state.elapsedMs),
          `step ${view.steps}`,
          view.tokensUsed === 0 ? "tokens at the end" : formatTokens(view.tokensUsed),
          ...attempt,
          ...(view.ratchetRejected === 0 && view.ratchetAccepted === 0
            ? []
            : [`ratchet +${view.ratchetAccepted}/-${view.ratchetRejected}`]),
          view.modelId ?? "no model call yet",
          ...approval,
          // Last, so a long path is what a narrow-ish window loses rather than the mode.
          input.workspace,
        ];
    rows.push({ text: `  ${facts.join(glyphsOf(input).separator)}`, dim: true });
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
  if (window.rows.length === 0 && layout.actionRows > 0) {
    rows.push({ text: "  (nothing yet)", dim: true });
  }
  window.rows.forEach((action, offset) => {
    const index = window.firstIndex + offset;
    const selected = state.focus === "actions" && index === selectedIndex(filtered.length, state);
    rows.push({
      text: `  ${describeAction(action, input)}`,
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

/**
 * One timeline row: what became of it, when, and the summary. A call is pending until its
 * outcome lands on the row below it; the outcome carries the mark that says how it went.
 */
function describeAction(action: ActionRow, input: ScreenInput): string {
  const { layout } = input;
  const glyphs = glyphsOf(input);
  const mark = action.failed
    ? glyphs.failed
    : action.kind === "tool-call"
      ? glyphs.pending
      : action.kind === "compacted"
        ? glyphs.bullet
        : glyphs.done;
  const when = layout.narrow ? "" : `${formatClock(action.at)}  `;
  const head = `${mark} ${when}`;
  return `${head}${firstLineToWidth(action.summary, Math.max(1, layout.contentColumns - displayWidth(head)))}`;
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
    const glyphs = glyphsOf(input);
    const attempt =
      view.attempt === null ? "" : `  attempt ${view.attempt.current}/${view.attempt.cap}`;
    const count = (status: GateLine["status"]): number =>
      view.gates.filter((gate) => gate.status === status).length;
    const counts = [
      `${glyphs.done} ${count("passed")} passed`,
      `${glyphs.failed} ${count("failed")} failed`,
      `${glyphs.pending} ${count("not-applicable")} n/a`,
    ].join("  ");
    rows.push(label(`gates${attempt}   ${counts}`, input));
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

function gateGlyph(gate: GateLine, glyphs: Glyphs): string {
  if (gate.status === "passed") {
    return glyphs.done;
  }
  return gate.status === "not-applicable" ? glyphs.pending : glyphs.failed;
}

function describeGate(gate: GateLine, input: ScreenInput): string {
  const { layout } = input;
  // The mark and the word both: the word is what the strip reads with colour off, and the
  // mark is what lines the strip up with the timeline above it.
  const mark = gateStyle(gate, input).label;
  const advisory = gate.blocking ? "" : " (advisory)";
  const head = `${gateGlyph(gate, glyphsOf(input))} ${padToWidth(mark, 4)} ${gate.gateId}${advisory}`;
  if (layout.narrow) {
    return truncateToWidth(head, layout.contentColumns);
  }
  return truncateToWidth(
    `${head}: ${firstLineToWidth(gate.detail, layout.contentColumns)}`,
    layout.contentColumns,
  );
}

/**
 * The outcome, which is not the same thing as having finished.
 *
 * A run that stopped on `model-error` at step 0 used to render `DONE gate diff-budget: passed`
 * in the accent colour: the gates run after the loop and each gate event rewrites `status`, so
 * the last gate to pass became the last word on a run that changed nothing. Gates passing over
 * an empty diff is not a result, and a person reading that reasonably concluded the tool had
 * built something.
 */
/**
 * The frames of the working indicator, and how fast they turn.
 *
 * There was nothing moving on this screen while a model thought or a shell command ran: the
 * status said "thinking (step 3)" and stayed there, and the only thing that changed was a
 * seconds counter that the layout hides below 80 columns or 12 rows. A person watching a run
 * that takes a minute could not tell it from a run that had hung.
 *
 * The frame is a pure function of the elapsed milliseconds the tick already provides, so
 * nothing here keeps time of its own and the screen stays a function of its inputs.
 */
const spinnerFrames = [
  "\u280b",
  "\u2819",
  "\u2839",
  "\u2838",
  "\u283c",
  "\u2834",
  "\u2826",
  "\u2827",
  "\u2807",
  "\u280f",
] as const;
const spinnerFrameMs = 120;

export function spinnerAt(elapsedMs: number): string {
  const index = Math.floor(Math.max(0, elapsedMs) / spinnerFrameMs) % spinnerFrames.length;
  return spinnerFrames[index] ?? spinnerFrames[0];
}

/**
 * One line saying the run is alive and what it is doing: the spinner, the activity, how long
 * that activity has been going, and, while the model is talking, the tail of what it is saying.
 *
 * Deliberately one line. The whole response is in the action stream when it lands and in the
 * ledger for ever; repeating it here as it arrives would be the same text three times and would
 * push everything else off a short screen.
 */
function activityRow(input: ScreenInput): ScreenRow | null {
  const { view, layout, state } = input;
  if (view.activity === null || view.finished) {
    return null;
  }

  // A pending confirmation is the run blocked on the reader, not the model still working. The
  // activity underneath it is whatever was dispatched last, and leaving that up reads as
  // progress: a run held on this question overnight still said "thinking, step 2" with the
  // counter climbing past twelve hours, which is indistinguishable from a hang. Name the block.
  const doing = input.confirmation === null ? view.activity : "waiting for you";

  const seconds = Math.floor((input.activityElapsedMs ?? 0) / 1000);
  const head = `${spinnerAt(state.elapsedMs)} ${doing}${seconds > 0 ? `  ${seconds}s` : ""}`;
  if (input.confirmation !== null || view.speaking.length === 0) {
    return { text: head, dim: true };
  }

  const room = layout.contentColumns - displayWidth(head) - 3;
  const said = room > 12 ? truncateToWidth(view.speaking, room) : "";
  return { text: said.length === 0 ? head : `${head}   ${said}`, dim: true };
}

/**
 * How the run ended, for the finish card's first line: the mark, the words and the colour
 * agree with the status row below, which carries the same rule in its older wording.
 */
function verdictRow(input: ScreenInput): ScreenRow {
  const { view, theme } = input;
  const glyphs = glyphsOf(input);
  const stoppedBadly = view.stopReason !== null && view.stopReason !== "completed";
  const took =
    input.evidence?.run === undefined
      ? ""
      : `   ${describeRun(input.evidence.run, glyphs.separator)}`;
  if (view.escalated) {
    return {
      text: `${glyphs.failed} ${view.status}${took}`,
      bold: true,
      color: theme.failed.color,
    };
  }
  if (stoppedBadly) {
    return {
      text: `${glyphs.failed} stopped: ${view.stopReason}, ${view.status}${took}`,
      bold: true,
      color: theme.failed.color,
    };
  }
  if (view.finished && view.changedFiles === 0) {
    // Not the assessment's words: gates over an unchanged workspace say nothing about work,
    // and a card that led with "work accepted" over an empty diff was read as the file existing.
    return {
      text: `${glyphs.pending} no files changed, so nothing was done${took}`,
      bold: true,
      color: theme.color("advisory"),
    };
  }
  return { text: `${glyphs.done} ${view.status}${took}`, bold: true, color: theme.color("accent") };
}

function statusRow(input: ScreenInput): ScreenRow {
  const { view, theme } = input;
  const stoppedBadly = view.stopReason !== null && view.stopReason !== "completed";

  if (view.escalated) {
    return { text: `ESCALATED ${view.status}`, color: theme.failed.color };
  }
  if (stoppedBadly) {
    return { text: `STOPPED ${view.stopReason}: ${view.status}`, color: theme.failed.color };
  }
  // A run that touched nothing is not a run that succeeded, however many gates passed over the
  // empty diff. This is the same defect as the one above wearing a different hat: there the
  // loop stopped badly, here it stopped for the honest reason "completed" having done nothing,
  // which is what a model answering in prose looks like from the harness's side.
  if (view.finished && view.changedFiles === 0) {
    return {
      text: `DONE, but no files changed: ${view.status}`,
      color: theme.color("advisory"),
    };
  }
  const mark = view.finished ? "DONE " : "";
  const color = view.finished ? theme.color("accent") : theme.color("advisory");
  return { text: `${mark}${view.status}`, color };
}

function hintRow(input: ScreenInput): ScreenRow {
  const { state, bindings } = input;
  if (state.composing !== null) {
    return {
      text: "enter to run it   up for an earlier task   /help for the rest   ctrl+c to leave",
      dim: true,
    };
  }
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
  const close = input.bindings.labelOf.get("back") ?? "escape";
  return [
    verdictRow(input),
    ...finishCardRows(evidence, input.layout.columns),
    { text: "" },
    // The panel is the last thing a finished run puts up, and it waits here until somebody
    // closes it. Saying neither that the run is over nor which key ends it left a person
    // watching a screen they had no reason to think was still theirs to answer.
    {
      text: `  the run has finished. ${close} or ${input.bindings.labelOf.get("cancel") ?? "ctrl+c"} closes this and exits.`,
      dim: true,
    },
  ];
}

function confirmationRows(input: ScreenInput, request: ConfirmationRequest): readonly ScreenRow[] {
  const { bindings, layout, theme } = input;
  const yes = bindings.labelOf.get("confirm-yes") ?? "y";
  const no = bindings.labelOf.get("confirm-no") ?? "n";
  const always = bindings.labelOf.get("confirm-always") ?? "a";
  const programs = request.programs ?? [];
  return [
    { text: "the chokepoint is asking", bold: true, color: theme.color("advisory") },
    { text: "" },
    { text: `  ${truncateToWidth(request.explanation, layout.contentColumns)}` },
    { text: `  ${request.toolName}: ${truncateToWidth(request.detail, layout.contentColumns)}` },
    { text: "" },
    { text: `  ${yes} to run it, ${no} or escape to refuse. Refusing is recorded either way.` },
    // Only an allowlist question has a program to allow; a derivation match is per call.
    ...(programs.length === 0
      ? []
      : [
          {
            text: truncateToWidth(
              `  ${always} to allow ${programs.join(", ")} for the rest of this run, recorded.`,
              layout.contentColumns,
            ),
          },
        ]),
    ...(input.confirmTimeoutMs === undefined || input.confirmTimeoutMs <= 0
      ? []
      : [
          {
            text: `  Unanswered, it refuses itself after ${describeMinutes(input.confirmTimeoutMs)}.`,
            dim: true,
          },
        ]),
  ];
}

/** Whole minutes, because the deadline is set in them and a second count would read as a timer. */
function describeMinutes(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function label(text: string, input: ScreenInput): ScreenRow {
  return {
    text: `${glyphsOf(input).bullet} ${text}`,
    dim: true,
    color: input.theme.color("muted"),
  };
}

function actionsLabel(input: ScreenInput, rowCount: number): string {
  const { state } = input;
  const filter = state.filter.length === 0 ? "" : `  filter "${state.filter}" (${rowCount})`;
  const scrolled = state.scrollBack === 0 ? "" : `  ${state.scrollBack} back`;
  return `timeline${filter}${scrolled}`;
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
