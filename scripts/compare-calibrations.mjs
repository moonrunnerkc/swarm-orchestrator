#!/usr/bin/env node
/**
 * Reads calibration bundles and prints, per model and per dimension, the distribution of the
 * executed runs as quantiles, side by side across bundles, so two sweeps of one model are
 * compared as distribution against distribution and never as one number against another.
 * Every value comes from a `calibration-run` record; a repeat that did not execute is not a
 * measurement and is counted only as such, and a repeat the runtime cut short before its gate
 * carries no gate verdict and is counted apart.
 *
 *   node scripts/compare-calibrations.mjs [label=]<bundle directory> [[label=]<bundle directory> ...]
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export const dimensions = [
  { key: "gatePassed", label: "gate green (1 or 0)", read: (run) => (run.gatePassed === null ? null : run.gatePassed ? 1 : 0), digits: 2 },
  { key: "tokensPerSecond", label: "output tokens per second", read: (run) => run.tokensPerSecond, digits: 1 },
  { key: "firstTokenMs", label: "time to first token (ms)", read: (run) => run.firstTokenMs, digits: 0 },
  { key: "steps", label: "steps per run", read: (run) => run.steps, digits: 1 },
  { key: "responseTimeMs", label: "run wall time (ms)", read: (run) => run.responseTimeMs, digits: 0 },
];

function quantile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const position = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[position];
}

export function distribution(values) {
  const sorted = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  return {
    count: sorted.length,
    minimum: quantile(sorted, 0),
    quartile1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    quartile3: quantile(sorted, 0.75),
    maximum: quantile(sorted, 1),
  };
}

export function readCalibrationRuns(bundleDirectory) {
  const ledger = readFileSync(join(bundleDirectory, "ledger.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  const runs = [];
  for (const record of ledger) {
    if (record.type !== "calibration-run") continue;
    const path = join(bundleDirectory, "blobs", `${record.payloadDigest.replace("sha256:", "")}.json`);
    if (!existsSync(path)) continue;
    runs.push(JSON.parse(readFileSync(path, "utf8")));
  }
  return runs;
}

/** Per model: executed and attempted counts, a distribution per dimension, and green per case. */
export function summarize(runs) {
  const byModel = new Map();
  for (const run of runs) {
    const entry = byModel.get(run.model) ?? { attempted: 0, executed: 0, runs: [], cases: new Map() };
    entry.attempted += 1;
    if (run.executed) {
      entry.executed += 1;
      entry.runs.push(run);
      const perCase = entry.cases.get(run.caseId) ?? { taskClass: run.taskClass, green: 0, executed: 0, cutShort: 0 };
      perCase.executed += 1;
      if (run.gatePassed === null) perCase.cutShort += 1;
      else if (run.gatePassed) perCase.green += 1;
      entry.cases.set(run.caseId, perCase);
    }
    byModel.set(run.model, entry);
  }
  const summaries = {};
  for (const [model, entry] of byModel) {
    const perDimension = {};
    for (const dimension of dimensions) {
      perDimension[dimension.key] = distribution(entry.runs.map(dimension.read));
    }
    summaries[model] = { attempted: entry.attempted, executed: entry.executed, dimensions: perDimension, cases: Object.fromEntries(entry.cases) };
  }
  return summaries;
}

function format(value, digits) {
  return value === null ? "n/a" : value.toFixed(digits);
}

export function render(labelled) {
  const lines = [];
  const models = [...new Set(labelled.flatMap(({ summaries }) => Object.keys(summaries)))].sort();
  for (const model of models) {
    lines.push(`## ${model}`, "");
    lines.push(`| dimension | bundle | n | min | q1 | median | q3 | max |`);
    lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
    for (const dimension of dimensions) {
      for (const { label, summaries } of labelled) {
        const summary = summaries[model];
        if (summary === undefined) continue;
        const dist = summary.dimensions[dimension.key];
        lines.push(
          `| ${dimension.label} | ${label} | ${dist.count} | ${format(dist.minimum, dimension.digits)} | ${format(dist.quartile1, dimension.digits)} | ${format(dist.median, dimension.digits)} | ${format(dist.quartile3, dimension.digits)} | ${format(dist.maximum, dimension.digits)} |`,
        );
      }
    }
    lines.push("");
    for (const { label, summaries } of labelled) {
      const summary = summaries[model];
      if (summary === undefined) continue;
      lines.push(`${label}: ${summary.executed} of ${summary.attempted} repeats executed`);
    }
    lines.push("");
    const caseIds = [...new Set(labelled.flatMap(({ summaries }) => Object.keys(summaries[model]?.cases ?? {})))];
    lines.push(`| case | class | ${labelled.map(({ label }) => `${label} green`).join(" | ")} |`);
    lines.push(`| --- | --- | ${labelled.map(() => "---").join(" | ")} |`);
    for (const caseId of caseIds) {
      const cells = labelled.map(({ summaries }) => {
        const perCase = summaries[model]?.cases[caseId];
        if (perCase === undefined) return "not run";
        const measured = perCase.executed - perCase.cutShort;
        return perCase.cutShort === 0 ? `${perCase.green} of ${measured}` : `${perCase.green} of ${measured}, ${perCase.cutShort} cut short`;
      });
      const taskClass = labelled.map(({ summaries }) => summaries[model]?.cases[caseId]?.taskClass).find((value) => value !== undefined);
      lines.push(`| ${caseId} | ${taskClass} | ${cells.join(" | ")} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

if (import.meta.filename === process.argv[1]) {
  const directories = process.argv.slice(2);
  if (directories.length === 0) {
    console.error("usage: node scripts/compare-calibrations.mjs <bundle directory> [...]");
    process.exit(2);
  }
  // `label=directory` names a column; a bare directory is named by its last segment.
  const labelled = directories.map((argument) => {
    const at = argument.indexOf("=");
    const [label, directory] =
      at === -1 ? [basename(argument.replace(/\/+$/, "")), argument] : [argument.slice(0, at), argument.slice(at + 1)];
    return { label, summaries: summarize(readCalibrationRuns(directory)) };
  });
  process.stdout.write(render(labelled));
}
