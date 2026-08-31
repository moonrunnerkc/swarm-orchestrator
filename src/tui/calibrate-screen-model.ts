import {
  type CalibrateView,
  type CalibrationOutcome,
  type CalibrationTally,
  plannedRuns,
} from "./calibrate-view.ts";
import { formatElapsed } from "./elapsed.ts";
import type { ScreenRow } from "./screen-model.ts";
import { padToWidth, truncateToWidth } from "./terminal-text.ts";
import type { Theme } from "./theme.ts";

/**
 * The sweep as a list of rows, in the same shape the single-run screen uses: every row already
 * truncated to the width it is drawn at, so the component that renders it holds no logic and
 * the whole thing is table-testable at any size without a renderer.
 *
 * A second view rather than the first one pointed somewhere else, which is what the tech-debt
 * note asked for. The single-run screen is built around one task, one plan and one gate strip,
 * and a sweep has none of those as a single thing: what it has is a grid, and the questions
 * worth answering are about the grid.
 *
 * A sweep has a denominator, which is the one thing this screen can say that the run screen
 * cannot. The elapsed counter beside it is still just elapsed: an estimate of what is left
 * would be arithmetic over run times that vary by model and by case, and a number presented as
 * a prediction is one people plan around.
 */

export interface CalibrateScreenInput {
  readonly view: CalibrateView;
  readonly columns: number;
  readonly rows: number;
  readonly theme: Theme;
  readonly elapsedMs: number;
  /** Where the bundle will be written, so the person watching knows where to look after. */
  readonly bundleDirectory: string;
}

/** Below this the optional columns come off, as they do on the run screen. */
const narrowColumns = 80;

export function buildCalibrateScreen(input: CalibrateScreenInput): readonly ScreenRow[] {
  const narrow = input.columns < narrowColumns;

  const rows: ScreenRow[] = [
    ...headerRows(input, narrow),
    ...progressRows(input),
    ...tableRows(input, narrow),
    ...recentRows(input, narrow),
    statusRow(input),
  ];

  return rows
    .slice(0, Math.max(1, input.rows))
    .map((row) => ({ ...row, text: truncateToWidth(row.text, input.columns) }));
}

function headerRows(input: CalibrateScreenInput, narrow: boolean): readonly ScreenRow[] {
  const { plan } = input.view;
  const rows: ScreenRow[] = [
    { text: "swarm calibrate", bold: true, color: input.theme.color("accent") },
  ];

  if (plan === null) {
    rows.push({ text: "  preparing the sweep", dim: true });
    return rows;
  }

  const facts = [
    `${plan.models.length} model(s)`,
    `${plan.cases} case(s)`,
    `${plan.repeats} repeat(s) each`,
    formatElapsed(input.elapsedMs),
  ];
  rows.push({ text: `  ${facts.join("  ")}`, dim: true });
  if (!narrow) {
    rows.push({ text: `  golden set ${plan.goldenSetVersion}`, dim: true });
  }
  return rows;
}

/**
 * How far through, as a count rather than a bar. A sweep's runs are not the same size, so a bar
 * drawn from the count would be a picture of a fraction that is not the fraction of the work.
 */
function progressRows(input: CalibrateScreenInput): readonly ScreenRow[] {
  const total = plannedRuns(input.view.plan);
  const done = input.view.finished;
  const progress =
    total === null ? `${done} run(s) finished` : `${done} of ${total} run(s) finished`;

  const rows: ScreenRow[] = [{ text: `  ${progress}` }];
  const current = input.view.current;
  rows.push({
    text:
      current === null
        ? "  waiting for the next run"
        : `  now: ${current.model}  ${current.caseId}  repeat ${current.repeat}`,
    dim: current === null,
    ...(current === null ? {} : { color: input.theme.color("accent") }),
  });
  return rows;
}

/**
 * One row per model. Green is counted over executed runs rather than over attempted ones,
 * which is the same denominator the report uses and for the same reason: a repeat that measured
 * nothing about a model is absence of evidence, not a case the model failed.
 */
function tableRows(input: CalibrateScreenInput, narrow: boolean): readonly ScreenRow[] {
  const { tallies } = input.view;
  if (tallies.length === 0) {
    return [];
  }

  const nameWidth = Math.max(...tallies.map((tally) => tally.model.length));
  return [
    { text: "  models", dim: true },
    ...tallies.map((tally) => ({
      text: `  ${padToWidth(tally.model, nameWidth)}  ${describeTally(tally, narrow)}`,
      ...styleFor(tally, input.theme),
    })),
  ];
}

function describeTally(tally: CalibrationTally, narrow: boolean): string {
  const green = `${tally.green}/${tally.executed} green`;
  if (narrow) {
    return green;
  }
  const abstained = Object.entries(tally.abstentions);
  const measured = `${tally.finished} run(s)`;
  return abstained.length === 0
    ? `${measured}  ${green}`
    : `${measured}  ${green}  (${abstained.map(([reason, count]) => `${count} ${reason}`).join(", ")})`;
}

/** Colour says whether anything is unmeasured, which is the thing worth stopping a sweep over. */
function styleFor(tally: CalibrationTally, theme: Theme): Partial<ScreenRow> {
  if (tally.finished === 0) {
    return { dim: true };
  }
  return Object.keys(tally.abstentions).length > 0 ? { color: theme.notApplicable.color } : {};
}

function recentRows(input: CalibrateScreenInput, narrow: boolean): readonly ScreenRow[] {
  const { recent } = input.view;
  if (recent.length === 0 || narrow) {
    return [];
  }
  return [
    { text: "  recent", dim: true },
    ...recent.map((outcome) => ({
      text: `  ${describeOutcome(outcome)}`,
      ...(outcome.executed ? {} : { color: input.theme.notApplicable.color }),
    })),
  ];
}

function describeOutcome(outcome: CalibrationOutcome): string {
  const verdict = !outcome.executed
    ? `not measured: ${outcome.abstentionReason ?? "unrecorded"}`
    : outcome.gatePassed
      ? "green"
      : "red";
  return `${outcome.model}  ${outcome.caseId} #${outcome.repeat}  ${verdict}`;
}

function statusRow(input: CalibrateScreenInput): ScreenRow {
  return {
    text: `  evidence will be written to ${input.bundleDirectory}`,
    dim: true,
  };
}
