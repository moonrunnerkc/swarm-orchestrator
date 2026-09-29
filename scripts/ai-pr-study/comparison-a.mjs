#!/usr/bin/env node
/**
 * Comparison A over the rows with task truth (truth.mjs `hasTaskTruth`, the same set the report
 * and the ablations use). A0 reads the independent plain-CI arm, never the verifier's report.
 *
 *   node scripts/ai-pr-study/comparison-a.mjs <run | rows directory | rows.json.br> <out.md>
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
  verifierDecisionAsFirstCoded,
} from "./truth.mjs";

const [rowsSource, out] = process.argv.slice(2);
if (!rowsSource || !out) {
  console.error("usage: comparison-a.mjs <run | rows directory | rows.json.br> <out.md>");
  process.exit(2);
}
const rows = loadRows(rowsSource);
const rowsDigest = rowsDigestOf(rowsSource);
const decisions = { A0: plainCiDecision, A1: verifierDecision, A2: oracleDecision };
const judged = rows.filter(hasTaskTruth);
const arms = Object.entries(decisions).map(([arm, decide]) => [arm, tallyDecisions(rows, decide)]);
const discordant = judged.filter((row) => {
  const violated = rowTruth(row).status === "requirement-violated";
  return (
    (plainCiDecision(row) === "accept" && violated) !==
    (verifierDecision(row) === "accept" && violated)
  );
});
const rule = (t) =>
  `| ${share(t.agree, t.n)} | ${share(t.falseGreen, t.n)} | ${share(t.falseRed, t.n)} | ${share(t.unmeasured, t.n)}${t.notRun ? ` (not run ${t.notRun})` : ""} |`;

const page = `# Comparison A: identical-patch verifier decisions

Derived from ${rows.length} row(s) in \`${rowsSource}\` (digest ${rowsDigest}) under the frozen
decision rule of \`docs/verifier-first/comparison-protocol.md\`, as amended 2026-09-29. Rows with
task truth (behavioural-executed and scored): ${judged.length} of ${rows.length}; text-inspected and
unscored rows are outside every denominator here, as they are in the report.
${judged.length < 10 ? "Fewer than ten rows with task truth: no difference below is called meaningful, as the rule requires.\n" : ""}
| Arm | Agreement | False green | False red | Unmeasured |
| --- | --- | --- | --- | --- |
${arms.map(([arm, t]) => `| ${arm} ${rule(t)}`).join("\n")}

Paired false-green difference A0 minus A1: ${arms[0][1].falseGreen - arms[1][1].falseGreen}, over
${discordant.length} discordant row(s)${discordant.length < 10 ? " (below the ten the rule requires before a difference is called meaningful)" : ""}.

A0 is the repository's own declared test command in the independent plain-CI arm, exit only; a
row without that arm (a legacy row) is unmeasured for A0. A1 is swarm-verify's regression-only
verdict as its report states it. A2 is swarm-verify with the scored held-back checks as its
oracle; rows without an A2 pass read "not run".

A1 as the analysis first coded it (any failed check refuses, whatever the verdict attributed):
${rule(tallyDecisions(rows, verifierDecisionAsFirstCoded)).slice(2, -2)}.

## Rows

| # | Pull request | Truth | A0 | A1 | A2 |
| --- | --- | --- | --- | --- | --- |
${judged.map((row) => `| ${row.index} | [${row.repository}#${row.number}](${row.url}) | ${rowTruth(row).status}${rowTruth(row).legacy ? " (legacy)" : ""} | ${plainCiDecision(row)} | ${verifierDecision(row)} | ${oracleDecision(row)} |`).join("\n")}
`;
writeFileSync(out, page);
console.log(
  `comparison A written to ${out}: ${judged.length} rows with task truth, ${discordant.length} discordant`,
);
