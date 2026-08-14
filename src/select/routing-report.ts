import { assignmentKinds, type RewardEntry, type RoutingLogContents } from "./routing-log.ts";
import { type TaskClass, taskClasses } from "./task-class.ts";
import { type Arm, armsFor, defaultRouterSettings, type RouterSettings } from "./ucb.ts";

export interface RoutingReportInput {
  readonly path: string;
  readonly contents: RoutingLogContents;
  readonly settings?: RouterSettings;
}

const labelWidth = 18;

/**
 * The routing table as it stands. Everything here is counted off the log, so a class that
 * looks dormant is dormant because it has too few rewards, not because something decided so.
 */
export function renderRoutingReport(input: RoutingReportInput): readonly string[] {
  const settings = input.settings ?? defaultRouterSettings;
  const { entries, unreadable } = input.contents;

  const lines = [
    "routing log",
    field("path", input.path),
    field("runs", String(entries.length)),
    field(
      "threshold",
      `${settings.minSamples} rewards per task class before the bandit takes over`,
    ),
    field("assignments", describeAssignments(entries)),
  ];

  if (unreadable > 0) {
    lines.push(
      field("unreadable", `${unreadable} line(s) in the log could not be read and were skipped`),
    );
  }

  if (entries.length === 0) {
    lines.push(
      "",
      "no rewards have been logged yet: every finished run appends one, and the calibration",
      "pick stands until a task class has enough of them to compare on.",
    );
    return lines;
  }

  for (const taskClass of taskClasses) {
    const forClass = entries.filter((entry) => entry.taskClass === taskClass);
    if (forClass.length === 0) {
      continue;
    }
    lines.push(
      "",
      describeClass(taskClass, forClass, settings),
      ...describeArms(forClass, settings),
    );
  }

  return lines;
}

function describeClass(
  taskClass: TaskClass,
  forClass: readonly RewardEntry[],
  settings: RouterSettings,
): string {
  const shortfall = settings.minSamples - forClass.length;
  const state =
    shortfall > 0
      ? `the calibration pick stands (${shortfall} more needed)`
      : "the bandit is routing";
  return `${taskClass}: ${forClass.length} runs, ${state}`;
}

const columns = [
  { header: "model", width: 34 },
  { header: "runs", width: 6 },
  { header: "mean", width: 8 },
  { header: "green", width: 7 },
  { header: "eroded", width: 8 },
  { header: "latency", width: 9 },
  { header: "bonus", width: 8 },
] as const;

function describeArms(
  forClass: readonly RewardEntry[],
  settings: RouterSettings,
): readonly string[] {
  const models = [...new Set(forClass.map((entry) => entry.model))].sort();
  const arms = new Map(armsFor(models, forClass, settings).map((arm) => [arm.model, arm]));

  const rows = models.map((model) => {
    const mine = forClass.filter((entry) => entry.model === model);
    return row([
      model,
      String(mine.length),
      mean(mine.map((entry) => entry.reward)).toFixed(3),
      String(mine.filter((entry) => entry.ratchet.settled === "green").length),
      String(mine.filter((entry) => entry.ratchet.erosions > 0).length),
      `${Math.round(mean(mine.map((entry) => entry.latencyMs)) / 1000)}s`,
      describeBonus(arms.get(model)),
    ]);
  });

  return [row(columns.map((column) => column.header)), ...rows].map((line) => `  ${line}`);
}

/** A dash rather than a zero: below the threshold no bound was computed to show. */
function describeBonus(arm: Arm | undefined): string {
  return arm?.bonus == null ? "-" : `+${arm.bonus.toFixed(3)}`;
}

function describeAssignments(entries: readonly RewardEntry[]): string {
  return assignmentKinds
    .map((kind) => ({
      kind,
      count: entries.filter((entry) => entry.assignment === kind).length,
    }))
    .filter((tally) => tally.count > 0)
    .map((tally) => `${tally.kind} ${tally.count}`)
    .join(", ");
}

function row(cells: readonly string[]): string {
  return cells
    .map((cell, index) => cell.padEnd(columns[index]?.width ?? cell.length + 2))
    .join("")
    .trimEnd();
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function field(label: string, value: string): string {
  return `  ${label.padEnd(labelWidth)}${value}`;
}
