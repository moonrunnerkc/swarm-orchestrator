#!/usr/bin/env node
/**
 * Ablations S0, S1, S2 over the rows with task truth (truth.mjs `hasTaskTruth`, the same set the
 * report and Comparison A use). S0 reads the independent plain-CI arm.
 *
 *   node scripts/ai-pr-study/ablations.mjs <run | rows directory | rows.json.br> <out.md>
 */
import { writeFileSync } from "node:fs";
import { loadRows, rowsDigest as rowsDigestOf } from "./rows.mjs";
import {
  hasTaskTruth,
  oracleDecision,
  plainCiDecision,
  rowTruth,
  share,
  tallyDecisions,
  verifierDecision,
} from "./truth.mjs";

const [rowsSource, out] = process.argv.slice(2);
if (!rowsSource || !out) {
  console.error("usage: ablations.mjs <run | rows directory | rows.json.br> <out.md>");
  process.exit(2);
}
const rows = loadRows(rowsSource);
const rowsDigest = rowsDigestOf(rowsSource);
const judged = rows.filter(hasTaskTruth);

const rungs = {
  S0: plainCiDecision,
  // The registered S1: the verifier's own regression-only decision (A1) with the coverage
  // dimension masked. Without a contract, coverage and mutation feed the unmeasured and reach
  // readings, never accept or refuse, so the masked decision is the recorded one.
  S1: verifierDecision,
  S2: (row) => {
    const oracle = oracleDecision(row);
    return oracle === "not-run" ? verifierDecision(row) : oracle;
  },
};
const page = `# Ablations S0, S1, S2

Derived from ${rows.length} row(s) in \`${rowsSource}\` (digest ${rowsDigest}) under the frozen
decision rule; ${judged.length} rows carry task truth and are the denominator of every count. Read as
what each addition changed, never as a ranking.

| Rung | What it adds | Agreement | False green | False red | Unmeasured |
| --- | --- | --- | --- | --- | --- |
${[
  ["S0", "the repository's own test command in the independent plain-CI arm, exit only"],
  [
    "S1",
    "the base control and the identity, isolation, install and output refusals, as the verifier version in these rows applies them",
  ],
  [
    "S2",
    "changed-line coverage and mutation witnesses, and the scored held-back checks as oracle where an A2 pass exists",
  ],
]
  .map(([rung, adds]) => {
    const t = tallyDecisions(rows, rungs[rung]);
    return `| ${rung} | ${adds} | ${share(t.agree, t.n)} | ${share(t.falseGreen, t.n)} | ${share(t.falseRed, t.n)} | ${share(t.unmeasured, t.n)} |`;
  })
  .join("\n")}

S2 differs from S1 only on rows with an A2 pass.

## Rows

| # | Pull request | Truth | S0 | S1 | S2 |
| --- | --- | --- | --- | --- | --- |
${judged.map((row) => `| ${row.index} | [${row.repository}#${row.number}](${row.url}) | ${rowTruth(row).status} | ${rungs.S0(row)} | ${rungs.S1(row)} | ${rungs.S2(row)} |`).join("\n")}
`;
writeFileSync(out, page);
console.log(`ablations written to ${out}: ${judged.length} rows with task truth`);
