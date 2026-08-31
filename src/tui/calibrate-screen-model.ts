import type { CalibrateModelTally, CalibrateView } from "./calibrate-view.ts";
import { plannedRepeats } from "./calibrate-view.ts";
import { formatElapsed } from "./elapsed.ts";
import { type ScreenRow, spinnerAt } from "./screen-model.ts";
import { padToWidth, truncateToWidth } from "./terminal-text.ts";
import type { Theme } from "./theme.ts";

/**
 * The calibrate sweep as a list of rows, built the way the session screen is built: every row
 * truncated to the width it will be drawn at, so the component that renders this maps a row to
 * one Ink `Text` and holds nothing.
 *
 * No keys, no panes, no filter. The debt list asked for a screen for a run that has none of
 * the things the session screen navigates, and a sweep is something a person watches rather
 * than steers: the interaction pattern is that there is not one.
 */

export interface CalibrateScreenInput {
  readonly view: CalibrateView;
  readonly columns: number;
  readonly rows: number;
  readonly theme: Theme;
  /** How long the sweep has been going, from the injected clock. */
  readonly elapsedMs: number;
}

export function buildCalibrateScreen(input: CalibrateScreenInput): readonly ScreenRow[] {
  const rows: ScreenRow[] = [
    ...headerRows(input),
    ...progressRows(input),
    ...modelRows(input),
    ...inFlightRows(input),
    statusRow(input),
  ];

  return rows
    .slice(0, Math.max(1, input.rows))
    .map((row) => ({ ...row, text: truncateToWidth(row.text, input.columns) }));
}

function headerRows(input: CalibrateScreenInput): readonly ScreenRow[] {
  const { plan } = input.view;
  const facts = [
    `${plan.models.length} model(s)`,
    `${plan.cases} case(s)`,
    `${plan.repeats} repeat(s) each`,
    plan.goldenSetVersion.length === 0
      ? "golden set unnamed"
      : `golden set ${plan.goldenSetVersion}`,
    ...(plan.backend === null ? [] : [plan.backend]),
    formatElapsed(input.elapsedMs),
  ];

  return [
    { text: "swarm  calibrate", bold: true, color: input.theme.color("accent") },
    { text: `  ${facts.join("  ")}`, dim: true },
  ];
}

/** How far along the sweep is, against a denominator it knew before it started. */
function progressRows(input: CalibrateScreenInput): readonly ScreenRow[] {
  const planned = plannedRepeats(input.view.plan);
  const done = input.view.finished;
  if (planned === 0) {
    return [{ text: "", dim: true }];
  }

  const width = Math.max(10, Math.min(40, input.columns - 24));
  const filled = Math.min(width, Math.round((done / planned) * width));
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;

  return [{ text: "" }, { text: `${bar}  ${done} of ${planned} repeat(s)` }];
}

/**
 * One row per model: what it was asked to do, what it answered, and what it solved.
 *
 * Executed apart from attempted, and green counted only over executed, because those are the
 * two numbers a sweep is easiest to misread: a backend that served nothing and a model that
 * solved nothing both produce "0 green", and the difference is the whole of what the run
 * measured. The abstention reasons are printed beside them for the same reason.
 */
function modelRows(input: CalibrateScreenInput): readonly ScreenRow[] {
  const { byModel, plan } = input.view;
  if (byModel.length === 0) {
    return [];
  }

  const perModel = plan.cases * plan.repeats;
  const nameWidth = Math.min(
    Math.max(...byModel.map((tally) => tally.model.length), 5),
    Math.max(12, input.columns - 40),
  );

  return [
    { text: "" },
    { text: "model", dim: true },
    ...byModel.map((tally) => ({
      text: `  ${padToWidth(truncateToWidth(tally.model, nameWidth), nameWidth)}  ${describeTally(tally, perModel)}`,
      ...(tally.executed === 0 && tally.attempted > 0
        ? { color: input.theme.color("advisory") }
        : {}),
    })),
  ];
}

function describeTally(tally: CalibrateModelTally, perModel: number): string {
  const parts = [
    `${tally.attempted}/${perModel} run`,
    `${tally.executed} executed`,
    `${tally.green} green`,
  ];
  const abstained = Object.entries(tally.abstentions)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([reason, count]) => `${count} ${reason}`);

  return abstained.length === 0
    ? parts.join("  ")
    : `${parts.join("  ")}  (${abstained.join(", ")})`;
}

function inFlightRows(input: CalibrateScreenInput): readonly ScreenRow[] {
  const { inFlight } = input.view;
  if (inFlight === null) {
    return [];
  }

  return [
    { text: "" },
    {
      text: `${spinnerAt(input.elapsedMs)} ${inFlight.model}  ${inFlight.caseId}  repeat ${inFlight.repeat}`,
      dim: true,
    },
  ];
}

function statusRow(input: CalibrateScreenInput): ScreenRow {
  const { view, theme } = input;
  if (!view.settled) {
    const planned = plannedRepeats(view.plan);
    return {
      text: planned === 0 ? "planning" : `running  ${view.finished} of ${planned}`,
      color: theme.color("advisory"),
    };
  }
  // An abstain is the honest outcome of a sweep that measured nothing worth picking from, and
  // it renders as itself rather than as a pick nobody made.
  return view.pick === null
    ? {
        text: "DONE  calibration abstained: no model was both executed and usable",
        color: theme.color("advisory"),
      }
    : { text: `DONE  ${view.pick}`, color: theme.color("accent") };
}
