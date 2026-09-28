#!/usr/bin/env node
/**
 * The study's report, derived from its rows and nothing else: every denominator the protocol
 * names, each count with its Wilson interval, per author account and per repository, and the
 * verifier's detection and acceptance against the adjudication arm. Reruns are idempotent:
 * the same rows give the same page, with the digest of the rows it was derived from.
 *
 *   node scripts/ai-pr-study/report.mjs <rows directory> <frame.json> <out.md>
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [rowsDirectory, framePath, out] = process.argv.slice(2);
if (!rowsDirectory || !framePath || !out) {
  console.error("usage: report.mjs <rows directory> <frame.json> <out.md>");
  process.exit(2);
}
const frame = JSON.parse(readFileSync(framePath, "utf8"));
const files = readdirSync(rowsDirectory)
  .filter((name) => /^\d+\.json$/.test(name))
  .sort();
const rows = files.map((name) => JSON.parse(readFileSync(join(rowsDirectory, name), "utf8")));
const digest = createHash("sha256");
for (const name of files) digest.update(readFileSync(join(rowsDirectory, name)));
const rowsDigest = `sha256:${digest.digest("hex")}`;

/** Wilson score interval, 95%, as percentages. */
function wilson(k, n) {
  if (n === 0) return null;
  const z = 1.959964;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { low: Math.max(0, centre - half) * 100, high: Math.min(1, centre + half) * 100 };
}
const pct = (k, n) => (n === 0 ? "n/a" : `${((100 * k) / n).toFixed(1)}%`);
const interval = (k, n) => {
  const w = wilson(k, n);
  return w === null ? "" : ` [${w.low.toFixed(1)}, ${w.high.toFixed(1)}]`;
};
const line = (label, k, n) => `| ${label} | ${k} / ${n} | ${pct(k, n)}${interval(k, n)} |`;

const selected = frame.selected.length;
const fetched = rows.filter((row) => row.outcome !== undefined);
const executed = rows.filter((row) => row.outcome === "executed");
const blocked = rows.filter((row) => row.outcome === "blocked");
const pending = rows.filter((row) => row.outcome === "fetched");
const green = executed.filter((row) => row.verdict?.originalSuiteGreen === true);
// A check that only inspects text (grep, test -f, cat, diff) executes no behaviour; it is
// reported apart and is not task truth under the protocol.
const textInspection = (row) => {
  const command = row.adjudication?.check?.command ?? "";
  const contents = row.adjudication?.check?.contents ?? "";
  const runs =
    /\b(pytest|vitest|jest|mocha|node\s|npm\s+(test|run)|pnpm\s+(test|run)|python[0-9.]*\s|uv\s+run|tsx\s|ts-node|deno\s|go\s+test|cargo\s+test|dotnet\s+test)\b/;
  return command.length > 0 && !runs.test(command) && !runs.test(contents);
};
const inspected = rows.filter(
  (row) =>
    ["requirement-met", "requirement-violated"].includes(row.adjudication?.status) &&
    textInspection(row),
);
const adjudicated = rows.filter(
  (row) =>
    ["requirement-met", "requirement-violated"].includes(row.adjudication?.status) &&
    !textInspection(row),
);
const violated = adjudicated.filter((row) => row.adjudication.status === "requirement-violated");
const met = adjudicated.filter((row) => row.adjudication.status === "requirement-met");
const unjudged = rows.filter((row) => row.adjudication?.status === "unjudged");
const notAdjudicated = rows.filter((row) => row.adjudication === undefined);
const greenAdjudicated = green.filter((row) => adjudicated.includes(row));
const falseGreen = greenAdjudicated.filter((row) => violated.includes(row));
const decision = (row) =>
  row.outcome !== "executed"
    ? "unmeasured"
    : row.verdict?.refusal
      ? "refuse"
      : row.verdict?.verified === true || row.verdict?.regression === "pass"
        ? "accept"
        : Object.values(row.verdict?.checks ?? {}).some((status) => status === "failed")
          ? "refuse"
          : "unmeasured";
const detected = falseGreen.filter((row) => decision(row) === "refuse");
const goodAccepted = met.filter((row) => decision(row) === "accept");
const goodRefused = met.filter((row) => decision(row) === "refuse");
const goodUnmeasured = met.filter((row) => decision(row) === "unmeasured");
const wall = executed.map((row) => row.wallMs ?? 0).filter((ms) => ms > 0);
const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const byAuthor = {};
for (const row of rows) {
  const key = row.author ?? "unknown";
  byAuthor[key] ??= { rows: 0, executed: 0, green: 0, adjudicated: 0, violated: 0, falseGreen: 0 };
  byAuthor[key].rows += 1;
  if (executed.includes(row)) byAuthor[key].executed += 1;
  if (green.includes(row)) byAuthor[key].green += 1;
  if (adjudicated.includes(row)) byAuthor[key].adjudicated += 1;
  if (violated.includes(row)) byAuthor[key].violated += 1;
  if (falseGreen.includes(row)) byAuthor[key].falseGreen += 1;
}
const blockReasons = {};
for (const row of blocked) {
  const key = (row.reason ?? "").split(":")[0].slice(0, 80);
  blockReasons[key] = (blockReasons[key] ?? 0) + 1;
}
const unjudgedReasons = {};
for (const row of unjudged) {
  const key = (row.adjudication.reason ?? "").split(":")[0].split(",")[0].slice(0, 90);
  unjudgedReasons[key] = (unjudgedReasons[key] ?? 0) + 1;
}
const verifierVersions =
  [...new Set(executed.map((row) => row.verifier?.version))].join(", ") || "none yet";

const page = `# AI-authored pull request study: report

Derived from ${rows.length} row(s) in \`${rowsDirectory}\` (digest ${rowsDigest}) under the
registered protocol \`${frame.protocol}\`, frame queried ${frame.queriedAt}, seed
\`${frame.seed}\`, window ${frame.window.since} to ${frame.window.until}. Verifier version(s) in
the executed rows: ${verifierVersions}. Every rate carries its denominator and a Wilson 95%
interval. This is an observational study of a convenience population; it makes no claim about
AI-written code in general and none about any tool that was not run.

## Denominators

| Quantity | Count | Share |
| --- | --- | --- |
${line("Selected pull requests with a fetched row", fetched.length, selected)}
${line("Executed: the verifier ran to a verdict on the exact head in a fresh container", executed.length, selected)}
${line("Blocked: the verifier could not execute, reason recorded", blocked.length, selected)}
${line("Not yet run through the verifier", pending.length, selected)}
${line("Original-suite green among executed", green.length, executed.length)}
${line("Adjudicated: task truth established by an executed held-back check", adjudicated.length, selected)}
${line("Text-inspection checks (grep, file presence): reported apart, not task truth", inspected.length, selected)}
${line("Unjudged: no executable check, or the check did not fail on the base, or an assertion beyond the requirement", unjudged.length, selected)}
${line("Not yet adjudicated", notAdjudicated.length, selected)}

## Primary outcome

| Quantity | Count | Share |
| --- | --- | --- |
${line("Original-suite green with adjudicated task truth (the false-green denominator)", greenAdjudicated.length, executed.length)}
${line("Observed false green: suite green and the held-back check demonstrates a violated requirement", falseGreen.length, greenAdjudicated.length)}
${line("Requirement violated among adjudicated", violated.length, adjudicated.length)}
${line("Requirement met among adjudicated", met.length, adjudicated.length)}

## Verifier detection and acceptance

| Quantity | Count | Share |
| --- | --- | --- |
${line("Observed false greens the verifier refused (a held-back finding is not a verifier catch)", detected.length, falseGreen.length)}
${line("Adjudicated-correct pull requests the verifier accepted", goodAccepted.length, met.length)}
${line("Adjudicated-correct pull requests the verifier refused", goodRefused.length, met.length)}
${line("Adjudicated-correct pull requests the verifier left unmeasured", goodUnmeasured.length, met.length)}

## Practical cost

- Wall time per executed pull request (clone, fetch, install, checks, base control):
  median ${median(wall) === null ? "n/a" : `${(median(wall) / 1000).toFixed(0)} s`}, over ${wall.length} row(s).
- Manual interventions: none; every row was produced by the runner without a person acting.

## Per author account

| Account | Rows | Executed | Suite green | Adjudicated | Violated | False green |
| --- | --- | --- | --- | --- | --- | --- |
${Object.entries(byAuthor)
  .sort()
  .map(
    ([author, c]) =>
      `| ${author} | ${c.rows} | ${c.executed} | ${c.green} | ${c.adjudicated} | ${c.violated} | ${c.falseGreen} |`,
  )
  .join("\n")}

## Why rows were blocked

${
  Object.entries(blockReasons).length === 0
    ? "No blocked rows."
    : Object.entries(blockReasons)
        .sort()
        .map(([reason, count]) => `- ${count}: ${reason}`)
        .join("\n")
}

## Why rows stayed unjudged

${
  Object.entries(unjudgedReasons).length === 0
    ? "No unjudged rows."
    : Object.entries(unjudgedReasons)
        .sort()
        .map(([reason, count]) => `- ${count}: ${reason}`)
        .join("\n")
}

## Rows

| # | Pull request | Verifier | Suite green | Truth | Decision |
| --- | --- | --- | --- | --- | --- |
${rows
  .map(
    (row) =>
      `| ${row.index} | [${row.repository}#${row.number}](${row.url}) | ${row.outcome ?? "none"}${row.outcome === "blocked" ? ` (${(row.reason ?? "").slice(0, 60)})` : ""} | ${row.verdict?.originalSuiteGreen === undefined ? "" : row.verdict.originalSuiteGreen ? "yes" : "no"} | ${row.adjudication?.status ?? ""}${inspected.includes(row) ? " (text inspection)" : ""} | ${row.outcome === "executed" ? decision(row) : ""} |`,
  )
  .join("\n")}
`;
writeFileSync(out, page);
console.log(
  `report written to ${out}: ${rows.length} rows, ${executed.length} executed, ${adjudicated.length} adjudicated, ${falseGreen.length} false green`,
);
