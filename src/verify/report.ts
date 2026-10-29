import type { Predicate } from "./predicate.ts";

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

function lines(predicate: Predicate): readonly (readonly [string, string])[] {
  const rows: [string, string][] = [["verdict", predicate.verdict]];
  for (const reason of predicate.reasons) rows.push(["reason", reason]);
  rows.push(["base", predicate.base.commit]);
  rows.push([
    "change",
    `${predicate.change.files.length} file(s) from the ${predicate.change.source}`,
  ]);
  for (const check of predicate.checks)
    rows.push(["check", `${check.name}: ${check.result} (${check.command})`]);
  const baseline = predicate.baseline;
  const atBase = baseline.status === "measured" ? baseline.checks : [];
  rows.push([
    "baseline",
    baseline.status === "measured"
      ? `${atBase.filter((check) => check.result === "pass").length} of ${atBase.length} check(s) pass at the base commit${baseline.cached ? " (reused)" : ""}`
      : `unmeasured: ${baseline.reason}`,
  ]);
  const heldOut = predicate.heldOut;
  rows.push([
    "held-out",
    heldOut.status === "measured"
      ? `visible ${percent(heldOut.visiblePassRate)}, held-out ${percent(heldOut.heldOutPassRate)}, gap ${percent(heldOut.gap)}, judged in ${heldOut.judge.processes} process(es)`
      : `unmeasured: ${heldOut.reason}`,
  ]);
  const protectedPaths = predicate.protectedPaths;
  rows.push([
    "protected",
    protectedPaths.violations.length > 0
      ? `${protectedPaths.violations.length} violation(s): ${protectedPaths.violations.map((v) => v.path).join(", ")}`
      : `${protectedPaths.changed.length} protected path(s) changed, none together with source`,
  ]);
  const coverage = predicate.coverage;
  rows.push([
    "coverage",
    coverage.status === "measured"
      ? `${coverage.coveredLines} of ${coverage.changedLines} changed line(s) covered (${coverage.tool})`
      : `unmeasured: ${coverage.reason}`,
  ]);
  const mutation = predicate.mutation;
  rows.push([
    "mutation",
    mutation.status === "unmeasured"
      ? `unmeasured: ${mutation.reason}`
      : `${mutation.status}: ${mutation.operator} at ${mutation.path}:${mutation.line}`,
  ]);
  rows.push([
    "environment",
    `sha256:${predicate.environment.sha256} (dependencies ${predicate.environment.dependencies})`,
  ]);
  return rows;
}

export function renderText(predicate: Predicate): string {
  return lines(predicate)
    .map(([label, value]) => `${label.padEnd(12)} ${value}`)
    .join("\n");
}

export function renderMarkdown(predicate: Predicate): string {
  const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
  return [
    `### swarm-verify: ${predicate.verdict}`,
    "",
    "| | |",
    "| --- | --- |",
    ...lines(predicate).map(([label, value]) => `| ${label} | ${cell(value)} |`),
    "",
  ].join("\n");
}

export const verdictExitCode = { pass: 0, fail: 1, unmeasured: 4 } as const;
