import type { ModelSummary } from "./calibration-summary.ts";
import {
  type CalibrationDimension,
  type DimensionSpec,
  dimensionSpecs,
  statisticOf,
} from "./dimensions.ts";

interface RejectedModel {
  readonly model: string;
  readonly reason: string;
}

export interface CalibrationPick {
  /** Null when nothing measured was usable, which is a result rather than an error. */
  readonly model: string | null;
  readonly reasoning: readonly string[];
  readonly rejected: readonly RejectedModel[];
}

/**
 * The order the pick compares on. Not weights: each comparison is decided on its own numbers
 * and only moves to the next when the current one ties, so nothing here needs an exchange rate
 * between solving a case and answering quickly (section 3.9).
 */
const rankingOrder: readonly CalibrationDimension[] = [
  "gate-pass",
  "tokens-per-second",
  "time-to-first-token",
];

export function pickFromCalibration(models: readonly ModelSummary[]): CalibrationPick {
  const rejected: RejectedModel[] = [];
  const viable = models.filter((model) => {
    const shortfall = viabilityShortfall(model);
    if (shortfall !== null) {
      rejected.push({ model: model.model, reason: shortfall });
      return false;
    }
    return true;
  });

  if (viable.length === 0) {
    return {
      model: null,
      reasoning: [
        "no model cleared the floors every dimension sets, so calibration recommends none of them.",
      ],
      rejected,
    };
  }

  const reasoning: string[] = [];
  let field: readonly ModelSummary[] = viable;

  for (const dimension of rankingOrder) {
    if (field.length === 1) {
      break;
    }
    const spec = specFor(dimension);
    const ranked = rankOn(field, spec);
    if (ranked.leaders.length === field.length) {
      continue;
    }
    reasoning.push(describeComparison(spec, ranked, field, reasoning.length === 0));
    field = ranked.leaders;
  }

  const winner = field[0];
  if (winner === undefined) {
    return { model: null, reasoning, rejected };
  }

  reasoning.push(describePick(winner, models));
  return { model: winner.model, reasoning, rejected };
}

/** The first floor this model failed, or null when it cleared every one that was measured. */
function viabilityShortfall(model: ModelSummary): string | null {
  for (const spec of dimensionSpecs) {
    if (spec.viableAt === null) {
      continue;
    }
    const measured = statisticOf(model.dimensions[spec.id], spec);
    if (measured === null) {
      continue;
    }
    if (measured < spec.viableAt) {
      return (
        `${spec.label} came out at ${formatValue(measured, spec)} ${spec.unit}, under the ` +
        `${formatValue(spec.viableAt, spec)} a model needs to be usable at all`
      );
    }
  }
  return null;
}

interface Ranked {
  readonly leaders: readonly ModelSummary[];
  readonly best: number | null;
  readonly rest: readonly ModelSummary[];
}

function rankOn(models: readonly ModelSummary[], spec: DimensionSpec): Ranked {
  const measured = models.filter((model) => statisticOf(model.dimensions[spec.id], spec) !== null);
  if (measured.length === 0) {
    return { leaders: models, best: null, rest: [] };
  }

  const values = measured.map((model) => statisticOf(model.dimensions[spec.id], spec) ?? 0);
  const best = spec.better === "higher" ? Math.max(...values) : Math.min(...values);
  const leaders = measured.filter(
    (model) => (statisticOf(model.dimensions[spec.id], spec) ?? 0) === best,
  );

  return {
    leaders,
    best,
    rest: models.filter((model) => !leaders.includes(model)),
  };
}

function describeComparison(
  spec: DimensionSpec,
  ranked: Ranked,
  field: readonly ModelSummary[],
  first: boolean,
): string {
  const leader = ranked.leaders[0];
  const runnerUp = ranked.rest[0];
  const runs = field.reduce((sum, model) => sum + model.repeats, 0);

  if (leader === undefined || runnerUp === undefined) {
    return `${spec.label} separated the field at ${formatValue(ranked.best ?? 0, spec)} ${spec.unit}`;
  }

  const leaderValue = formatValue(statisticOf(leader.dimensions[spec.id], spec) ?? 0, spec);
  const runnerValue = formatValue(statisticOf(runnerUp.dimensions[spec.id], spec) ?? 0, spec);

  if (spec.id === "gate-pass" && first) {
    return `${leader.model} solved ${leaderValue} of the set against ${runnerUp.model}'s ${runnerValue}, on the same ${runs} runs`;
  }
  if (spec.id === "gate-pass") {
    return `${leader.model} solved ${leaderValue} of the set against ${runnerUp.model}'s ${runnerValue}`;
  }
  return (
    `they solved the same share of the set, so the ${spec.label} decided it: ` +
    `${leader.model} at ${leaderValue} ${spec.unit} against ${runnerUp.model} at ${runnerValue}`
  );
}

function describePick(winner: ModelSummary, models: readonly ModelSummary[]): string {
  return (
    `${winner.model} is the pick over ${models.length - 1} other model(s), measured on ` +
    `${winner.repeats} run(s) of the golden set.`
  );
}

export interface ShortlistComparison {
  readonly staticPick: string | null;
  readonly agrees: boolean;
  readonly statement: string;
}

/**
 * Section 3.9's closing obligation. Agreement is worth stating out loud, because a shortlist
 * that survives measurement is a shortlist that has been checked rather than merely trusted.
 */
export function compareWithShortlist(
  pick: CalibrationPick,
  staticPick: string | null,
  models: readonly ModelSummary[],
): ShortlistComparison {
  if (staticPick === null) {
    return {
      staticPick: null,
      agrees: false,
      statement: "there was no static recommendation to compare against.",
    };
  }
  if (pick.model === staticPick) {
    return {
      staticPick,
      agrees: true,
      statement: `the measurements agree with the static pick, which corroborates the shortlist: ${staticPick} was recommended on hardware fit alone and is what calibration measured as best.`,
    };
  }

  const measured = models.find((model) => model.model === staticPick);
  if (measured === undefined) {
    return {
      staticPick,
      agrees: false,
      statement: `the static pick ${staticPick} was not among the models calibrated, so nothing here corroborates or contradicts it.`,
    };
  }

  const chosen = models.find((model) => model.model === pick.model);
  const spec = chosen === undefined ? null : decidingDimension(chosen, measured);
  if (chosen === undefined || spec === null) {
    return {
      staticPick,
      agrees: false,
      statement: `calibration diverges from the static pick ${staticPick}, and no single dimension separated them.`,
    };
  }

  return {
    staticPick,
    agrees: false,
    statement:
      `calibration diverges from the static pick: ${chosen.model} reached ` +
      `${formatValue(statisticOf(chosen.dimensions[spec.id], spec) ?? 0, spec)} ${spec.unit} on ${spec.label} ` +
      `where ${staticPick} reached ${formatValue(statisticOf(measured.dimensions[spec.id], spec) ?? 0, spec)}.`,
  };
}

/** The first ranked dimension on which the two actually differ. */
function decidingDimension(chosen: ModelSummary, other: ModelSummary): DimensionSpec | null {
  for (const dimension of rankingOrder) {
    const spec = specFor(dimension);
    const mine = statisticOf(chosen.dimensions[dimension], spec);
    const theirs = statisticOf(other.dimensions[dimension], spec);
    if (mine !== null && theirs !== null && mine !== theirs) {
      return spec;
    }
  }
  return null;
}

interface CalibrationReportInput {
  readonly goldenSetVersion: string;
  readonly cases: number;
  readonly repeats: number;
  readonly models: readonly ModelSummary[];
  readonly pick: CalibrationPick;
  readonly comparison: ShortlistComparison;
  readonly bundleDirectory: string | null;
}

const labelWidth = 18;
const dimensionWidth = 40;
const numberWidth = 11;

export function renderCalibrationReport(input: CalibrationReportInput): readonly string[] {
  const lines = [
    "calibration",
    field("golden set", input.goldenSetVersion),
    field("cases", String(input.cases)),
    field("repeats", `${input.repeats} per case per model`),
    field("models", input.models.map((model) => model.model).join(", ")),
  ];

  for (const model of input.models) {
    lines.push("", `${model.model}: ${model.repeats} run(s)`, ...describeModel(model));
  }

  lines.push(
    "",
    "pick",
    field("pick", input.pick.model ?? "none"),
    ...bullets(input.pick.reasoning),
  );

  if (input.pick.rejected.length > 0) {
    lines.push(
      "",
      "not usable",
      ...bullets(input.pick.rejected.map((one) => `${one.model}: ${one.reason}`)),
    );
  }

  lines.push("", "against the shortlist", `  ${input.comparison.statement}`);

  if (input.bundleDirectory !== null) {
    lines.push(
      "",
      "every number above resolves to the records of the runs that produced it:",
      `  ${input.bundleDirectory}`,
    );
  }
  return lines;
}

function describeModel(model: ModelSummary): readonly string[] {
  const header = `  ${"dimension".padEnd(dimensionWidth)}${[
    "min",
    "median",
    "max",
    "runs",
    "spread",
  ]
    .map((name) => name.padStart(numberWidth))
    .join("")}`;

  const rows = dimensionSpecs.map((spec) => {
    const distribution = model.dimensions[spec.id];
    if (distribution.samples === 0) {
      return `  ${spec.label.padEnd(dimensionWidth)}${"not measured".padStart(numberWidth)}`;
    }
    return (
      `  ${spec.label.padEnd(dimensionWidth)}` +
      [
        formatValue(distribution.min ?? 0, spec),
        formatValue(distribution.median ?? 0, spec),
        formatValue(distribution.max ?? 0, spec),
        String(distribution.samples),
        formatValue(distribution.deviation ?? 0, spec),
      ]
        .map((cell) => cell.padStart(numberWidth))
        .join("")
    );
  });

  const cases = model.byCase.map(
    (one) => `  ${one.caseId} (${one.taskClass}): ${one.gatePassed} of ${one.repeats} green`,
  );

  return [header, ...rows, "", ...cases];
}

function bullets(lines: readonly string[]): readonly string[] {
  return lines.map((line) => `  - ${line}`);
}

function field(label: string, value: string): string {
  return `  ${label.padEnd(labelWidth)}${value}`;
}

function specFor(dimension: CalibrationDimension): DimensionSpec {
  const spec = dimensionSpecs.find((candidate) => candidate.id === dimension);
  if (spec === undefined) {
    throw new Error(`no spec for the ${dimension} dimension`);
  }
  return spec;
}

/**
 * Each unit at the precision it is read at. A share to three decimals says something a
 * megabyte to three decimals does not, and a table where one column overflows is a table
 * nobody checks the numbers in.
 */
function formatValue(value: number, spec: DimensionSpec): string {
  switch (spec.unit) {
    case "bytes":
      return value >= 1_000_000_000
        ? `${(value / 1_000_000_000).toFixed(1)}G`
        : `${(value / 1_000_000).toFixed(1)}M`;
    case "ms":
      return String(Math.round(value));
    case "tokens/s":
      return value.toFixed(1);
    default:
      return value.toFixed(3);
  }
}
