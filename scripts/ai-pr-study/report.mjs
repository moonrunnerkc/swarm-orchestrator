#!/usr/bin/env node
/**
 * The study's report, from a run directory, a rows directory or a packed archive. Every count
 * comes from truth.mjs, the one definition the comparisons and ablations read too, and every
 * rate names its numerator's and denominator's sets.
 *
 *   node scripts/ai-pr-study/report.mjs <run | rows directory | rows.json.br> <frame.json> <out.md>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadRows, rowsDigest as rowsDigestOf } from "./rows.mjs";
import {
  evidenceOf,
  plainCiDecision,
  share,
  studySets,
  suiteOf,
  verifierDecision,
} from "./truth.mjs";

const [rowsSource, framePath, out] = process.argv.slice(2);
if (!rowsSource || !framePath || !out) {
  console.error("usage: report.mjs <run | rows directory | rows.json.br> <frame.json> <out.md>");
  process.exit(2);
}
const frame = JSON.parse(readFileSync(framePath, "utf8"));
const rows = loadRows(rowsSource);
const rowsDigest = rowsDigestOf(rowsSource);
const sets = studySets(rows);
const line = (label, k, n) => `| ${label} | ${share(k, n)} |`;

const selected = frame.selected.length;
const detected = sets.falseGreen.filter((row) => verifierDecision(row) === "refuse");
const goodAccepted = sets.met.filter((row) => verifierDecision(row) === "accept");
const goodRefused = sets.met.filter((row) => verifierDecision(row) === "refuse");
const goodUnmeasured = sets.met.filter((row) => verifierDecision(row) === "unmeasured");
const greenEvidenceInvalid = sets.suiteGreen.filter((row) => evidenceOf(row).valid === false);
const greenVerifierRefused = sets.suiteGreen.filter((row) => row.verdict?.refusal);
const wall = sets.verifierExecuted.map((row) => row.wallMs ?? 0).filter((ms) => ms > 0);
const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const legacy = sets.legacyTruth.length > 0 || rows.some((row) => row.originalSuite === undefined);

const byAuthor = {};
for (const row of rows) {
  const key = row.author ?? "unknown";
  byAuthor[key] ??= { rows: 0, executed: 0, green: 0, truth: 0, violated: 0, falseGreen: 0 };
  byAuthor[key].rows += 1;
  if (sets.verifierExecuted.includes(row)) byAuthor[key].executed += 1;
  if (sets.suiteGreen.includes(row)) byAuthor[key].green += 1;
  if (sets.behavioural.includes(row)) byAuthor[key].truth += 1;
  if (sets.violated.includes(row)) byAuthor[key].violated += 1;
  if (sets.falseGreen.includes(row)) byAuthor[key].falseGreen += 1;
}
const tallyReasons = (list, reasonOf) => {
  const counts = {};
  for (const row of list) {
    const key = String(reasonOf(row) ?? "")
      .split(":")[0]
      .split(";")[0]
      .slice(0, 90);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).sort();
};
const blockReasons = tallyReasons(sets.verifierBlocked, (row) => row.reason);
const unscoredReasons = tallyReasons(sets.unscored, (row) => sets.truth.get(row).reason);
const retried = rows.filter((row) =>
  Object.values(row.attempts ?? {}).some((history) => (history ?? []).length > 1),
);
const verifierVersions =
  [...new Set(sets.verifierExecuted.map((row) => row.verifier?.version))].join(", ") || "none yet";
const rowIds = (list) => (list.length === 0 ? "none" : list.map((row) => row.index).join(", "));

const page = `# AI-authored pull request study: report

Derived from ${rows.length} row(s) in \`${rowsSource}\` (digest ${rowsDigest}) under the
registered protocol \`${frame.protocol}\`, frame queried ${frame.queriedAt}, seed
\`${frame.seed}\`, window ${frame.window.since} to ${frame.window.until}. Verifier version(s) in
the executed rows: ${verifierVersions}. Every rate carries its numerator and denominator and a
Wilson 95% interval. This is an observational study of a convenience population; it makes no
claim about AI-written code in general and none about any tool that was not run.
${
  legacy
    ? `
These rows predate the 2026-09-29 amendment in part: rows without an independent plain-CI run
have no original-suite status here (the verifier's own report is not read as one), and
single-reviewer truth is classified by what its check executes and marked legacy.
`
    : ""
}
## Denominators

| Quantity | Share |
| --- | --- |
${line("Selected pull requests with a fetched row", sets.fetched.length, selected)}
${line("Independent plain-CI arm ran at the head", sets.suiteMeasured.length, selected)}
${line("Verifier executed: it ran to a verdict on the exact head in a fresh container", sets.verifierExecuted.length, selected)}
${line("Verifier blocked: it could not execute, reason recorded", sets.verifierBlocked.length, selected)}
${line("Verifier evidence checked by the bundle's own verifier", sets.evidenceChecked.length, sets.verifierExecuted.length)}
${line("Task truth: behavioural-executed, scored by both reviewers", sets.behavioural.length, selected)}
${line("Text-inspected: checks only read files; reported apart, not task truth", sets.textInspected.length, selected)}
${line("Unscored, each with its reason", sets.unscored.length, selected)}
${line("Not yet adjudicated", sets.notAdjudicated.length, selected)}

## Original suite (independent plain-CI arm, among rows where it ran)

| Status | Share |
| --- | --- |
${["passed", "failed", "not-collected", "setup-failed"].map((status) => line(status, sets.suiteByStatus[status].length, sets.suiteMeasured.length)).join("\n")}

Suite-green rows whose verifier evidence did not verify: ${share(greenEvidenceInvalid.length, sets.suiteGreen.length)}
(rows ${rowIds(greenEvidenceInvalid)}); suite-green rows the verifier refused:
${share(greenVerifierRefused.length, sets.suiteGreen.length)} (rows ${rowIds(greenVerifierRefused)}). Both stay
in every suite-green denominator: the suite's status is the independent arm's, not the verifier's.

## Primary outcome

| Quantity | Share |
| --- | --- |
${line("Original-suite green rows that carry task truth, among original-suite green rows", sets.greenWithTruth.length, sets.suiteGreen.length)}
${line("Observed false green: suite green and a violated requirement, among suite-green rows with task truth (the false-green fraction)", sets.falseGreen.length, sets.greenWithTruth.length)}
${line("Requirement violated, among rows with task truth", sets.violated.length, sets.behavioural.length)}
${line("Requirement met, among rows with task truth", sets.met.length, sets.behavioural.length)}

## Verifier detection and acceptance

| Quantity | Share |
| --- | --- |
${line("Observed false greens the verifier refused (a held-back finding is not a verifier catch)", detected.length, sets.falseGreen.length)}
${line("Requirement-met rows the verifier accepted", goodAccepted.length, sets.met.length)}
${line("Requirement-met rows the verifier refused", goodRefused.length, sets.met.length)}
${line("Requirement-met rows the verifier left unmeasured", goodUnmeasured.length, sets.met.length)}

## Practical cost

- Verifier wall time per executed pull request: median ${median(wall) === null ? "n/a" : `${(median(wall) / 1000).toFixed(0)} s`}, over ${wall.length} row(s).
- Manual interventions: none; every attempt was produced by the harness without a person acting.
- ${retried.length === 0 ? "No arm of any row needed a second attempt." : `Rows with more than one attempt of some arm, every attempt kept under the harness's written retry rule: ${rowIds(retried)}.`}

## Per author account

| Account | Rows | Verifier executed | Suite green | Task truth | Violated | False green |
| --- | --- | --- | --- | --- | --- | --- |
${Object.entries(byAuthor)
  .sort()
  .map(
    ([author, c]) =>
      `| ${author} | ${c.rows} | ${c.executed} | ${c.green} | ${c.truth} | ${c.violated} | ${c.falseGreen} |`,
  )
  .join("\n")}

## Why the verifier was blocked

${blockReasons.length === 0 ? "No blocked rows." : blockReasons.map(([reason, count]) => `- ${count}: ${reason}`).join("\n")}

## Why rows stayed unscored

${unscoredReasons.length === 0 ? "No unscored rows." : unscoredReasons.map(([reason, count]) => `- ${count}: ${reason}`).join("\n")}

## Rows

| # | Pull request | Suite (independent) | Verifier | Evidence | Truth class | Truth | A0 | A1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows
  .map((row) => {
    const truth = sets.truth.get(row);
    const evidence = evidenceOf(row).valid;
    return `| ${row.index} | [${row.repository}#${row.number}](${row.url}) | ${suiteOf(row).status ?? "none"} | ${row.outcome ?? "none"} | ${evidence === null ? "" : evidence ? "valid" : "invalid"} | ${truth.class}${truth.legacy ? " (legacy)" : ""} | ${truth.status ?? ""} | ${plainCiDecision(row)} | ${verifierDecision(row)} |`;
  })
  .join("\n")}
`;
writeFileSync(out, page);
console.log(
  `report written to ${out}: ${rows.length} rows, ${sets.verifierExecuted.length} verifier-executed, ${sets.behavioural.length} with task truth, ${sets.falseGreen.length} false green`,
);
