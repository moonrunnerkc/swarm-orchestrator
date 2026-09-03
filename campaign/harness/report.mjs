/**
 * The per-arm summary, computed from the committed result records and nothing else. Every
 * count is over runs that executed, because a repeat that never got an answer is not a
 * measurement of anything, and the count of those is reported beside the rest rather than
 * folded into it. Distributions are reported as quantiles, never as one average.
 */

function quantile(sorted, fraction) {
  if (sorted.length === 0) {
    return null;
  }
  const position = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[position];
}

export function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    minimum: quantile(sorted, 0),
    quartile1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    quartile3: quantile(sorted, 0.75),
    maximum: quantile(sorted, 1),
  };
}

function tally(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export function summarizeArm(results) {
  const executed = results.filter((entry) => entry.executed);
  const withBundle = results.filter((entry) => entry.bundle !== null);
  return {
    runs: results.length,
    noBundle: results.filter((entry) => entry.bundle === null).length,
    timedOut: results.filter((entry) => entry.timedOut).length,
    killedBeforeBudget: results.filter((entry) => entry.killedBeforeBudget === true).length,
    notExecuted: withBundle.filter((entry) => !entry.executed).length,
    executed: executed.length,
    bundlesVerified: withBundle.filter((entry) => entry.bundle.verified).length,
    bundlesRefused: withBundle.filter((entry) => !entry.bundle.verified).length,
    outcomes: tally(executed.map((entry) => entry.outcome)),
    settledGreen: executed.filter((entry) => entry.bundle.settledGreen).length,
    escalated: executed.filter((entry) => entry.bundle.escalations.length > 0).length,
    ratchetRejections: executed.reduce((sum, entry) => sum + entry.bundle.ratchetRejections, 0),
    claims: {
      verified: executed.reduce((sum, entry) => sum + entry.bundle.claims.verified, 0),
      unverified: executed.reduce((sum, entry) => sum + entry.bundle.claims.unverified, 0),
    },
    durationMinutes: distribution(executed.map((entry) => entry.durationMs / 60000)),
    records: distribution(executed.map((entry) => entry.bundle.records)),
    byLanguage: tally(executed.map((entry) => `${entry.language}: ${entry.outcome}`)),
  };
}

function row(label, value) {
  return `| ${label} | ${value} |`;
}

function renderDistribution(name, dist, unit) {
  if (dist.count === 0) {
    return row(name, "not measured: no executed run");
  }
  const format = (value) => (unit === "min" ? value.toFixed(1) : String(value));
  return row(
    name,
    `min ${format(dist.minimum)}, q1 ${format(dist.quartile1)}, median ${format(dist.median)}, q3 ${format(dist.quartile3)}, max ${format(dist.maximum)} ${unit} over ${dist.count}`,
  );
}

export function renderReport(summaries, { generatedAt, notes = [] }) {
  const lines = ["# Campaign results", "", `Generated ${generatedAt} from the records in \`results/\`. Every number is over the runs recorded there; a run that produced no bundle or whose model never answered is counted where it says and nowhere else.`, ""];
  for (const [arm, summary] of Object.entries(summaries)) {
    lines.push(`## ${arm}`, "", "| Measure | Value |", "| --- | --- |");
    lines.push(row("runs recorded", summary.runs));
    lines.push(row("no bundle produced", summary.noBundle));
    lines.push(row("timed out", summary.timedOut));
    lines.push(row("killed before the budget", summary.killedBeforeBudget));
    lines.push(row("bundle but the model never answered (not executed)", summary.notExecuted));
    lines.push(row("executed", summary.executed));
    lines.push(row("bundles verified by their own verifier", `${summary.bundlesVerified} of ${summary.bundlesVerified + summary.bundlesRefused}`));
    lines.push(row("settled green (executed)", summary.settledGreen));
    lines.push(row("escalated (executed)", summary.escalated));
    lines.push(row("ratchet rejections (executed, total)", summary.ratchetRejections));
    lines.push(row("claims verified / refused (executed)", `${summary.claims.verified} / ${summary.claims.unverified}`));
    for (const [outcome, count] of Object.entries(summary.outcomes).sort()) {
      lines.push(row(`outcome: ${outcome}`, count));
    }
    lines.push(renderDistribution("duration", summary.durationMinutes, "min"));
    lines.push(renderDistribution("records per bundle", summary.records, "records"));
    for (const [key, count] of Object.entries(summary.byLanguage).sort()) {
      lines.push(row(key, count));
    }
    lines.push("");
  }
  if (notes.length > 0) {
    lines.push("## Notes", "");
    for (const note of notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
